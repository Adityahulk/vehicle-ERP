const { query, getClient } = require('../config/db');
const { isInterstate, calculateGst, getGstRateForHsn } = require('../services/gstService');

async function generateQuotationNumber(client, companyId, branchId) {
  const year = new Date().getFullYear();
  const { rows: brRows } = await client.query(
    `SELECT name FROM branches WHERE id = $1`, [branchId],
  );
  const branchCode = (brRows[0]?.name || 'GEN').substring(0, 3).toUpperCase();

  const { rows: seqRows } = await client.query(
    `SELECT COUNT(*)::int + 1 AS seq FROM quotations
     WHERE company_id = $1 AND quotation_number LIKE $2`,
    [companyId, `QTN-${year}-${branchCode}-%`],
  );
  const seq = String(seqRows[0].seq).padStart(4, '0');
  return `QTN-${year}-${branchCode}-${seq}`;
}

async function createQuotation(req, res) {
  const company_id = req.user.company_id;
  const branch_id = req.user.branch_id;
  const data = req.validated;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let customerId = data.customer_id;
    if (!customerId && data.customer) {
      const { rows: newCust } = await client.query(
        `INSERT INTO customers (company_id, name, phone, email, address, gstin)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [company_id, data.customer.name, data.customer.phone || null,
         data.customer.email || null, data.customer.address || null,
         data.customer.gstin || null],
      );
      customerId = newCust[0].id;
    }

    const { rows: custRows } = await client.query(
      `SELECT gstin FROM customers WHERE id = $1`, [customerId],
    );
    const { rows: compRows } = await client.query(
      `SELECT gstin FROM companies WHERE id = $1`, [company_id],
    );
    const interstate = isInterstate(compRows[0]?.gstin, custRows[0]?.gstin);

    // Process items with GST for the JSONB column
    let total = 0;
    const processedItems = [];

    for (const item of data.items) {
      const unitPrice = item.unit_price;
      const qty = item.quantity || 1;
      const lineTotal = unitPrice * qty;
      const hsnCode = item.hsn_code || '8703';
      const gstRate = item.gst_rate !== undefined ? item.gst_rate : getGstRateForHsn(hsnCode);
      const gst = calculateGst(lineTotal, gstRate, interstate);
      const amount = lineTotal + gst.cgst_amount + gst.sgst_amount + gst.igst_amount;

      processedItems.push({
        description: item.description, hsn_code: hsnCode, quantity: qty,
        unit_price: unitPrice, ...gst, amount,
      });
      total += amount;
    }

    total -= (data.discount || 0);

    const quotationNumber = await generateQuotationNumber(client, company_id, branch_id);

    const { rows } = await client.query(
      `INSERT INTO quotations
         (company_id, branch_id, quotation_number, customer_id, vehicle_id,
          valid_until, items, total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft')
       RETURNING *`,
      [
        company_id, branch_id, quotationNumber, customerId,
        data.vehicle_id || null, data.valid_until || null,
        JSON.stringify(processedItems), total,
      ],
    );

    await client.query('COMMIT');
    res.status(201).json({ quotation: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listQuotations(req, res) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  const { status, customer_search, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['q.company_id = $1', 'q.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  if (role === 'staff' || role === 'branch_manager') {
    conditions.push(`q.branch_id = $${idx++}`);
    params.push(userBranch);
  }

  if (status) { conditions.push(`q.status = $${idx++}`); params.push(status); }

  if (customer_search) {
    conditions.push(`(c.name ILIKE $${idx} OR c.phone ILIKE $${idx})`);
    params.push(`%${customer_search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await query(
    `SELECT COUNT(*) FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE ${where}`, params,
  );

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT q.*, c.name AS customer_name, c.phone AS customer_phone,
            v.make AS vehicle_make, v.model AS vehicle_model
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN vehicles v ON v.id = q.vehicle_id
     WHERE ${where}
     ORDER BY q.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  res.json({
    quotations: rows,
    total: parseInt(countResult.rows[0].count, 10),
    page: Number(page),
    limit: Number(limit),
  });
}

async function getQuotation(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const { rows } = await query(
    `SELECT q.*, c.name AS customer_name, c.phone AS customer_phone,
            c.gstin AS customer_gstin, c.address AS customer_address,
            v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN vehicles v ON v.id = q.vehicle_id
     WHERE q.id = $1 AND q.company_id = $2 AND q.is_deleted = FALSE`,
    [id, company_id],
  );

  if (rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
  res.json({ quotation: rows[0] });
}

async function convertToInvoice(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;

  const { rows } = await query(
    `SELECT * FROM quotations WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );

  if (rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
  const q = rows[0];

  if (q.status === 'rejected') {
    return res.status(400).json({ error: 'Cannot convert a rejected quotation' });
  }

  // Build an invoice creation payload from the quotation
  req.validated = {
    customer_id: q.customer_id,
    vehicle_id: q.vehicle_id,
    items: (q.items || []).map((item) => ({
      description: item.description,
      hsn_code: item.hsn_code,
      quantity: item.quantity,
      unit_price: item.unit_price,
      gst_rate: item.cgst_rate ? item.cgst_rate * 2 : item.igst_rate,
    })),
    discount: 0,
    status: 'draft',
    notes: `Converted from quotation ${q.quotation_number}`,
  };

  // Reuse the invoice creation logic
  const invoicesController = require('./invoicesController');
  await invoicesController.createInvoice(req, res);

  // Mark quotation as accepted
  await query(
    `UPDATE quotations SET status = 'accepted' WHERE id = $1`,
    [id],
  );
}

module.exports = { createQuotation, listQuotations, getQuotation, convertToInvoice };
