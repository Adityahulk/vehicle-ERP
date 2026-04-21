const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const redis = require('../config/redis');
const { query, getClient } = require('../config/db');
const { isInterstate, calculateGst, getGstRateForHsn } = require('../services/gstService');
const {
  parseUploadedFile,
  validateVehicleImportRow,
  validateSaleImportRow,
  validatePurchaseImportRow,
  buildTemplateSheet,
} = require('../services/importService');
const {
  generatePoNumber,
  processItemsForPo,
  insertPoItems,
} = require('../controllers/purchaseController');
const { logAudit } = require('../middleware/auditLog');

const REDIS_PREFIX = 'import:';
const TTL_SEC = 600;

async function generateInvoiceNumber(client, companyId, branchId) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const { rows: brRows } = await client.query(
    `SELECT name FROM branches WHERE id = $1`,
    [branchId],
  );
  const rawBranch = (brRows[0]?.name || 'GN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const branchCode = (rawBranch || 'GN').slice(0, 2).padEnd(2, 'X');
  const prefix = `I${yy}${mm}${dd}${branchCode}`;
  const { rows: seqRows } = await client.query(
    `SELECT COUNT(*)::int + 1 AS seq FROM invoices
     WHERE company_id = $1 AND invoice_number LIKE $2`,
    [companyId, `${prefix}%`],
  );
  const seq = String(seqRows[0].seq).padStart(4, '0');
  return `${prefix}${seq}`;
}

async function preview(req, res) {
  const company_id = req.user.company_id;
  const user_id = req.user.id;
  const importType = req.body?.type;
  if (!['vehicles', 'sales', 'purchases', 'quotations'].includes(importType)) {
    return res.status(400).json({ error: 'type must be vehicles, sales, purchases, or quotations' });
  }
  if (importType === 'quotations') {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Quotation bulk import is not available yet.' });
  }
  if (!req.file?.path) return res.status(400).json({ error: 'file is required' });

  const sessionId = path.basename(req.file.filename, path.extname(req.file.filename || '')) || uuidv4();
  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  let parsed;
  try {
    parsed = parseUploadedFile(filePath, mimeType);
  } catch (e) {
    fs.unlink(filePath, () => {});
    return res.status(400).json({ error: e.message || 'Failed to parse file' });
  }

  const allErrors = [];
  const validatedRows = [];
  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const displayRow = i + 2;
    let result;
    if (importType === 'vehicles') {
      result = validateVehicleImportRow(row, i);
    } else if (importType === 'sales') {
      result = await validateSaleImportRow(row, i, query, company_id);
    } else {
      result = validatePurchaseImportRow(row, i);
    }

    if (result.valid) {
      validCount++;
      validatedRows.push({ rowIndex: i, data: result.data, displayRow });
    } else {
      invalidCount++;
      result.errors.forEach((msg) => {
        allErrors.push({ row: displayRow, field: '—', message: msg });
      });
    }
  }

  await redis.setex(
    REDIS_PREFIX + sessionId,
    TTL_SEC,
    JSON.stringify({
      filePath,
      mimeType,
      type: importType,
      company_id,
      user_id,
    }),
  );

  const previewData = validatedRows.slice(0, 5).map((r) => r.data);

  res.json({
    importSessionId: sessionId,
    totalRows: parsed.totalRows,
    validRows: validCount,
    invalidRows: invalidCount,
    errors: allErrors,
    previewData,
  });
}

async function getOrCreateSupplier(client, companyId, name) {
  const n = String(name).trim();
  const { rows } = await client.query(
    `SELECT id, gstin, tcs_applicable FROM suppliers
     WHERE company_id = $1 AND LOWER(TRIM(name)) = LOWER($2) AND is_deleted = FALSE`,
    [companyId, n],
  );
  if (rows.length) return rows[0];
  const ins = await client.query(
    `INSERT INTO suppliers (company_id, name, is_active) VALUES ($1, $2, TRUE) RETURNING id, gstin, tcs_applicable`,
    [companyId, n],
  );
  return ins.rows[0];
}

async function confirmImport(req, res) {
  const { importSessionId, type, branchId } = req.validated;
  const company_id = req.user.company_id;
  const user_id = req.user.id;

  const raw = await redis.get(REDIS_PREFIX + importSessionId);
  if (!raw) {
    return res.status(400).json({ error: 'Import session expired or invalid. Upload again.' });
  }
  const meta = JSON.parse(raw);
  if (meta.company_id !== company_id || meta.user_id !== user_id || meta.type !== type) {
    return res.status(403).json({ error: 'Invalid import session' });
  }

  const { rows: br } = await query(
    `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [branchId, company_id],
  );
  if (br.length === 0) return res.status(400).json({ error: 'Invalid branch' });

  if (!fs.existsSync(meta.filePath)) {
    return res.status(400).json({ error: 'Cached file missing. Upload again.' });
  }

  let parsed;
  try {
    parsed = parseUploadedFile(meta.filePath, meta.mimeType);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Failed to re-parse file' });
  }

  const toSave = [];
  const skipErrors = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const displayRow = i + 2;
    let result;
    if (type === 'vehicles') {
      result = validateVehicleImportRow(row, i);
    } else if (type === 'sales') {
      result = await validateSaleImportRow(row, i, query, company_id);
    } else {
      result = validatePurchaseImportRow(row, i);
    }
    if (result.valid) toSave.push({ displayRow, data: result.data });
    else {
      result.errors.forEach((msg) => skipErrors.push({ row: displayRow, reason: msg }));
    }
  }

  let imported = 0;

  if (type === 'vehicles') {
      for (const { displayRow, data } of toSave) {
        const cx = await getClient();
        try {
          await cx.query('BEGIN');
          const dup = await cx.query(
            `SELECT id FROM vehicles WHERE chassis_number = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [data.chassis_number, company_id],
          );
          if (dup.rows.length > 0) {
            await cx.query('ROLLBACK');
            skipErrors.push({ row: displayRow, reason: 'Duplicate chassis in database' });
            continue;
          }
          await cx.query(
            `INSERT INTO vehicles
               (company_id, branch_id, chassis_number, engine_number, make, model, variant, color, year,
                purchase_price, selling_price, status, rto_number, rto_date, insurance_company, insurance_expiry, insurance_number)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'in_stock',$12,$13,$14,$15,$16)`,
            [
              company_id, branchId, data.chassis_number, data.engine_number,
              data.make, data.model, data.variant, data.color, data.year,
              data.purchase_price, data.selling_price,
              data.rto_number, data.rto_date, data.insurance_company, data.insurance_expiry, data.insurance_number,
            ],
          );
          await cx.query('COMMIT');
          imported++;
        } catch (e) {
          await cx.query('ROLLBACK');
          skipErrors.push({ row: displayRow, reason: e.message || 'Insert failed' });
        } finally {
          cx.release();
        }
      }
    } else if (type === 'sales') {
      const { rows: comp } = await query(`SELECT gstin FROM companies WHERE id = $1`, [company_id]);
      const companyGstin = comp[0]?.gstin;

      for (const { displayRow, data } of toSave) {
        const cx = await getClient();
        try {
          await cx.query('BEGIN');
          const { rows: cust } = await cx.query(
            `INSERT INTO customers (company_id, name, phone, address, gstin)
             VALUES ($1,$2,$3,$4,$5) RETURNING id, gstin`,
            [
              company_id, data.customer_name, data.customer_phone,
              data.customer_address, data.customer_gstin,
            ],
          );
          const customerId = cust[0].id;
          const customerGstin = cust[0].gstin;
          const interstate = isInterstate(companyGstin, customerGstin);
          const taxable = data.total_amount;
          const hsnCode = '8703';
          const gstRate = getGstRateForHsn(hsnCode);
          const gst = calculateGst(taxable, gstRate, interstate);
          const amount = taxable + gst.cgst_amount + gst.sgst_amount + gst.igst_amount;
          const invoiceNumber = await generateInvoiceNumber(cx, company_id, branchId);
          const noteParts = [
            data.notes,
            data.bank_name && `Bank: ${data.bank_name}`,
            data.loan_amount != null && `Loan (paise): ${data.loan_amount}`,
          ].filter(Boolean);
          const { rows: invRows } = await cx.query(
            `INSERT INTO invoices
               (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
                subtotal, discount, cgst_amount, sgst_amount, igst_amount, total, status, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,'confirmed',$12)
             RETURNING id`,
            [
              company_id, branchId, invoiceNumber, data.sale_date, customerId, data.vehicle_id,
              taxable, gst.cgst_amount, gst.sgst_amount, gst.igst_amount, amount,
              noteParts.length ? noteParts.join(' | ') : null,
            ],
          );
          const invoiceId = invRows[0].id;
          const desc = `Vehicle sale (${data.chassis_number})`;
          await cx.query(
            `INSERT INTO invoice_items
               (invoice_id, company_id, description, hsn_code, quantity, unit_price,
                cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount)
             VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              invoiceId, company_id, desc, hsnCode,
              taxable, gst.cgst_rate, gst.sgst_rate, gst.igst_rate,
              gst.cgst_amount, gst.sgst_amount, gst.igst_amount, amount,
            ],
          );
          await cx.query(
            `UPDATE vehicles SET status = 'sold' WHERE id = $1 AND company_id = $2`,
            [data.vehicle_id, company_id],
          );
          await cx.query('COMMIT');
          imported++;
        } catch (e) {
          await cx.query('ROLLBACK');
          skipErrors.push({ row: displayRow, reason: e.message || 'Insert failed' });
        } finally {
          cx.release();
        }
      }
    } else {
      const groups = new Map();
      for (const { displayRow, data } of toSave) {
        const k = data.supplier_name.toLowerCase();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ displayRow, data });
      }

      const { rows: compRows } = await query(`SELECT gstin FROM companies WHERE id = $1`, [company_id]);
      const companyGstin = compRows[0]?.gstin;

      for (const [, groupRows] of groups) {
        const c = await getClient();
        try {
          await c.query('BEGIN');
          const supplier = await getOrCreateSupplier(c, company_id, groupRows[0].data.supplier_name);
          const orderDate = groupRows.reduce(
            (min, r) => (r.data.received_date < min ? r.data.received_date : min),
            groupRows[0].data.received_date,
          );
          const items = groupRows.map(({ data }) => ({
            description: `${data.make} ${data.model} ${data.variant || ''}`.trim(),
            hsn_code: '8703',
            quantity: 1,
            unit_price: data.purchase_price,
            gst_rate: 28,
            vehicle_data: null,
          }));
          const totals = processItemsForPo(items, companyGstin, supplier.gstin, 0, supplier.tcs_applicable === true);
          const poNumber = await generatePoNumber(c, company_id, branchId, orderDate);
          const { rows: poIns } = await c.query(
            `INSERT INTO purchase_orders
               (company_id, branch_id, po_number, supplier_id, order_date, expected_delivery_date,
                status, subtotal, discount, cgst_amount, sgst_amount, igst_amount, tcs_amount, total, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'received',$7,0,$8,$9,$10,$11,$12,$13,$14)
             RETURNING id`,
            [
              company_id, branchId, poNumber, supplier.id, orderDate, orderDate,
              totals.subtotal, totals.cgst_amount, totals.sgst_amount, totals.igst_amount,
              totals.tcs_amount, totals.total, 'Imported via bulk import', user_id,
            ],
          );
          const poId = poIns[0].id;
          await insertPoItems(c, poId, totals.processed);
          const { rows: poItems } = await c.query(
            `SELECT id FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY created_at ASC`,
            [poId],
          );
          const { rows: recRows } = await c.query(
            `INSERT INTO purchase_receipts
               (company_id, purchase_order_id, branch_id, received_date, received_by, status, notes)
             VALUES ($1,$2,$3,$4,$5,'complete',$6)
             RETURNING id`,
            [company_id, poId, branchId, orderDate, user_id, 'Bulk import'],
          );
          const receiptId = recRows[0].id;

          for (let j = 0; j < groupRows.length; j++) {
            const { data, displayRow } = groupRows[j];
            const poiId = poItems[j].id;
            const dup = await c.query(
              `SELECT id FROM vehicles WHERE chassis_number = $1 AND company_id = $2 AND is_deleted = FALSE`,
              [data.chassis_number, company_id],
            );
            if (dup.rows.length > 0) {
              throw new Error(`ROW_${displayRow}_DUP_CHASSIS`);
            }
            const vehicleData = {
              chassis_number: data.chassis_number,
              engine_number: data.engine_number,
              make: data.make,
              model: data.model,
              variant: data.variant,
              color: data.color,
              year: data.year,
              purchase_price: data.purchase_price,
              selling_price: data.selling_price || undefined,
              rto_number: data.rto_number || undefined,
              insurance_company: data.insurance_company || undefined,
              insurance_expiry: data.insurance_expiry || undefined,
              insurance_number: data.insurance_number || undefined,
            };
            await c.query(
              `INSERT INTO purchase_receipt_items
                 (purchase_receipt_id, purchase_order_item_id, quantity_received, vehicle_data)
               VALUES ($1,$2,1,$3)`,
              [receiptId, poiId, vehicleData],
            );
            await c.query(
              `INSERT INTO vehicles
                 (company_id, branch_id, chassis_number, engine_number, make, model, variant, color, year,
                  purchase_price, selling_price, status, purchase_order_id,
                  rto_number, insurance_company, insurance_expiry, insurance_number)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'in_stock',$12,$13,$14,$15,$16)`,
              [
                company_id, branchId, data.chassis_number, data.engine_number,
                data.make, data.model, data.variant, data.color, data.year,
                data.purchase_price, data.selling_price || 0, poId,
                data.rto_number, data.insurance_company, data.insurance_expiry, data.insurance_number,
              ],
            );
            imported++;
          }
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          const msg = String(e.message || '');
          if (msg.startsWith('ROW_')) {
            const dr = parseInt(msg.split('_')[1], 10);
            skipErrors.push({ row: dr, reason: 'Duplicate chassis in database' });
          } else {
            groupRows.forEach(({ displayRow }) => {
              skipErrors.push({ row: displayRow, reason: msg || 'Import failed for supplier group' });
            });
          }
        } finally {
          c.release();
        }
      }
    }

  fs.unlink(meta.filePath, () => {});
  await redis.del(REDIS_PREFIX + importSessionId);

  logAudit({
    companyId: company_id, userId: user_id, action: 'create', entity: 'import',
    entityId: importSessionId, newValue: { type, imported }, req,
  });

  res.json({
    imported,
    skipped: skipErrors.length,
    errors: skipErrors,
  });
}

function downloadTemplate(req, res) {
  const { type } = req.params;
  if (type === 'quotations') {
    return res.status(400).json({ error: 'Quotation import template is not available yet.' });
  }
  if (!['vehicles', 'sales', 'purchases'].includes(type)) {
    return res.status(400).json({ error: 'Invalid template type' });
  }
  const buf = buildTemplateSheet(type);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${type}_import_template.xlsx"`,
    'Content-Length': buf.length,
  });
  res.send(buf);
}

module.exports = { preview, confirmImport, downloadTemplate };
