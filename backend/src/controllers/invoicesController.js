const { query, getClient } = require('../config/db');

/** @returns {Promise<{ status: number, error: string } | null>} null if allowed */
async function invoiceBranchAccessError(req, invoiceId) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  if (role !== 'staff' && role !== 'branch_manager') return null;

  const { rows } = await query(
    `SELECT branch_id FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [invoiceId, company_id],
  );
  if (!rows.length) return { status: 404, error: 'Invoice not found' };
  if (String(rows[0].branch_id || '') !== String(userBranch || '')) {
    return { status: 403, error: 'Not allowed for this branch' };
  }
  return null;
}
const { isInterstate, calculateGst, getGstRateForHsn } = require('../services/gstService');
const { logAudit } = require('../middleware/auditLog');
const { insertLoanForInvoiceInTransaction } = require('./loansController');

async function generateInvoiceNumber(client, companyId, branchId) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  // IRN-safe compact number: I + YYMMDD + branch(2) + seq(4), max 13 chars.
  const { rows: brRows } = await client.query(
    `SELECT name FROM branches WHERE id = $1`,
    [branchId],
  );
  const rawBranch = (brRows[0]?.name || 'GN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const branchCode = (rawBranch || 'GN').slice(0, 2).padEnd(2, 'X');
  const prefix = `I${yy}${mm}${dd}${branchCode}`;

  // Get next sequence for this company + daily prefix.
  const { rows: seqRows } = await client.query(
    `SELECT COUNT(*)::int + 1 AS seq FROM invoices
     WHERE company_id = $1 AND invoice_number LIKE $2`,
    [companyId, `${prefix}%`],
  );
  const seq = String(seqRows[0].seq).padStart(4, '0');

  return `${prefix}${seq}`;
}

function computeInvoiceItems(items, interstate) {
  let subtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  const processedItems = [];

  for (const item of items) {
    const unitPrice = item.unit_price;
    const qty = item.quantity || 1;
    const lineTotal = unitPrice * qty;
    const hsnCode = item.hsn_code || '8703';
    const gstRate = item.gst_rate !== undefined ? item.gst_rate : getGstRateForHsn(hsnCode);

    const mode = item.tax_mode || 'auto';
    const effectiveInterstate = mode === 'igst' ? true : mode === 'cgst_sgst' ? false : interstate;
    const gst = calculateGst(lineTotal, gstRate, effectiveInterstate);
    const amount = lineTotal + gst.cgst_amount + gst.sgst_amount + gst.igst_amount;

    processedItems.push({
      description: item.description,
      hsn_code: hsnCode,
      quantity: qty,
      unit_price: unitPrice,
      ...gst,
      amount,
      tax_mode: mode,
    });

    subtotal += lineTotal;
    totalCgst += gst.cgst_amount;
    totalSgst += gst.sgst_amount;
    totalIgst += gst.igst_amount;
  }

  return {
    processedItems,
    subtotal,
    totalCgst,
    totalSgst,
    totalIgst,
  };
}

/**
 * Insert invoice + line items inside an open transaction.
 * @param {import('pg').PoolClient} client
 * @param {string} company_id
 * @param {string} branch_id - branch for invoice numbering and FK
 * @param {object} data - same shape as validated create invoice body
 * @returns {Promise<object>} invoice row
 */
async function insertInvoiceWithItems(client, company_id, branch_id, data) {
  let customerId = data.customer_id;
  if (!customerId && data.customer) {
    const { rows: newCust } = await client.query(
      `INSERT INTO customers (company_id, name, phone, email, address, gstin)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, gstin`,
      [company_id, data.customer.name, data.customer.phone || null,
        data.customer.email || null, data.customer.address || null,
        data.customer.gstin || null],
    );
    customerId = newCust[0].id;
  }
  if (!customerId) {
    const err = new Error('Customer required');
    err.statusCode = 400;
    throw err;
  }

  const { rows: custRows } = await client.query(
    `SELECT name, phone, email, address, gstin FROM customers WHERE id = $1 AND company_id = $2`,
    [customerId, company_id],
  );
  const customer = custRows[0] || {};
  const customerGstin = customer.gstin;

  const { rows: compRows } = await client.query(
    `SELECT name, gstin, address, phone, email FROM companies WHERE id = $1`,
    [company_id],
  );
  const company = compRows[0] || {};
  const companyGstin = company.gstin;

  const seller = data.seller_details || {
    name: company.name,
    gstin: company.gstin,
    address: company.address,
    phone: company.phone,
    email: company.email,
  };
  const billing = data.billing_details || {
    name: customer.name,
    gstin: customer.gstin,
    address: customer.address,
    phone: customer.phone,
    email: customer.email,
  };
  const shipToSame = data.ship_to_same_as_billing !== false;
  const shipping = shipToSame ? { ...billing } : (data.shipping_details || { ...billing });

  const interstate = isInterstate(seller.gstin || companyGstin, billing.gstin || customerGstin);

  let vehicleId = data.vehicle_id || null;
  if (vehicleId) {
    const { rows: vRows } = await client.query(
      `SELECT id, selling_price, status FROM vehicles
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [vehicleId, company_id],
    );
    if (vRows.length === 0) {
      const err = new Error('Vehicle not found');
      err.statusCode = 404;
      throw err;
    }
    if (vRows[0].status !== 'in_stock') {
      const err = new Error('Vehicle is not available for sale');
      err.statusCode = 400;
      throw err;
    }
  }

  const invoiceNumber = await generateInvoiceNumber(client, company_id, branch_id);

  const {
    processedItems,
    subtotal,
    totalCgst,
    totalSgst,
    totalIgst,
  } = computeInvoiceItems(data.items, interstate);

  const discount = data.discount || 0;
  const total = subtotal - discount + totalCgst + totalSgst + totalIgst;

  const { rows: invRows } = await client.query(
    `INSERT INTO invoices
       (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
        subtotal, discount, cgst_amount, sgst_amount, igst_amount, total, status, notes, payment_type,
        seller_name, seller_gstin, seller_address, seller_phone, seller_email,
        bill_to_name, bill_to_gstin, bill_to_address, bill_to_phone, bill_to_email,
        ship_to_name, ship_to_gstin, ship_to_address, ship_to_phone, ship_to_email, ship_to_same_as_billing)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
     RETURNING *`,
    [
      company_id, branch_id, invoiceNumber, data.invoice_date || new Date().toISOString().split('T')[0],
      customerId, vehicleId,
      subtotal, discount, totalCgst, totalSgst, totalIgst, total,
      data.status || 'draft', data.notes || null, data.payment_type || 'Cash',
      seller.name || null, seller.gstin || null, seller.address || null, seller.phone || null, seller.email || null,
      billing.name || null, billing.gstin || null, billing.address || null, billing.phone || null, billing.email || null,
      shipping.name || null, shipping.gstin || null, shipping.address || null, shipping.phone || null, shipping.email || null,
      shipToSame,
    ],
  );

  const invoice = invRows[0];

  for (const item of processedItems) {
    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, company_id, description, hsn_code, quantity, unit_price,
            cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount, tax_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        invoice.id, company_id, item.description, item.hsn_code, item.quantity,
        item.unit_price, item.cgst_rate, item.sgst_rate, item.igst_rate,
          item.cgst_amount, item.sgst_amount, item.igst_amount, item.amount, item.tax_mode || 'auto',
      ],
    );
  }

  if (data.status === 'confirmed' && vehicleId) {
    await client.query(
      `UPDATE vehicles SET status = 'sold' WHERE id = $1 AND company_id = $2`,
      [vehicleId, company_id],
    );
  }

  return invoice;
}

async function createInvoice(req, res) {
  const company_id = req.user.company_id;
  const branch_id = req.user.branch_id;
  const data = req.validated;

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const invoice = await insertInvoiceWithItems(client, company_id, branch_id, data);

    let loanRow = null;
    if (data.loan && data.status === 'confirmed') {
      loanRow = await insertLoanForInvoiceInTransaction(client, {
        company_id,
        invoice_id: invoice.id,
        customer_id: invoice.customer_id,
        loan: data.loan,
      });
    }

    await client.query('COMMIT');

    const result = await fetchFullInvoice(invoice.id, company_id);
    logAudit({
      companyId: company_id, userId: req.user.id, action: 'create', entity: 'invoice',
      entityId: invoice.id, newValue: { invoice_number: invoice.invoice_number, total: invoice.total }, req,
    });
    if (loanRow) {
      logAudit({
        companyId: company_id, userId: req.user.id, action: 'create', entity: 'loan',
        entityId: loanRow.id, newValue: { invoice_id: invoice.id, bank_name: loanRow.bank_name }, req,
      });
    }
    res.status(201).json(loanRow ? { ...result, loan: loanRow } : result);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function listInvoices(req, res) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  const { branch_id, status, customer_search, date_from, date_to, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['i.company_id = $1', 'i.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  if (role === 'staff' || role === 'branch_manager') {
    conditions.push(`i.branch_id = $${idx++}`);
    params.push(userBranch);
  } else if (branch_id) {
    conditions.push(`i.branch_id = $${idx++}`);
    params.push(branch_id);
  }

  if (status) {
    conditions.push(`i.status = $${idx++}`);
    params.push(status);
  }

  if (date_from) {
    conditions.push(`i.invoice_date >= $${idx++}`);
    params.push(date_from);
  }

  if (date_to) {
    conditions.push(`i.invoice_date <= $${idx++}`);
    params.push(date_to);
  }

  if (customer_search) {
    conditions.push(`(c.name ILIKE $${idx} OR c.phone ILIKE $${idx})`);
    params.push(`%${customer_search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE ${where}`,
    params,
  );

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone,
            b.name AS branch_name,
            v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN branches b ON b.id = i.branch_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
     WHERE ${where}
     ORDER BY i.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  res.json({
    invoices: rows,
    total: parseInt(countResult.rows[0].count, 10),
    page: Number(page),
    limit: Number(limit),
  });
}

async function getInvoice(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const denied = await invoiceBranchAccessError(req, id);
  if (denied) return res.status(denied.status).json({ error: denied.error });
  const result = await fetchFullInvoice(id, company_id);
  if (!result) return res.status(404).json({ error: 'Invoice not found' });
  res.json(result);
}

async function updateInvoice(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const denied = await invoiceBranchAccessError(req, id);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const data = req.validated;
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: invRows } = await client.query(
      `SELECT id, status, customer_id, branch_id, vehicle_id,
              seller_name, seller_gstin, seller_address, seller_phone, seller_email,
              bill_to_name, bill_to_gstin, bill_to_address, bill_to_phone, bill_to_email,
              ship_to_name, ship_to_gstin, ship_to_address, ship_to_phone, ship_to_email, ship_to_same_as_billing
       FROM invoices
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
       FOR UPDATE`,
      [id, company_id],
    );
    if (invRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const current = invRows[0];
    if (current.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cancelled invoices cannot be edited' });
    }

    let customerId = current.customer_id;
    if (data.customer_id) {
      const { rows: c } = await client.query(
        `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [data.customer_id, company_id],
      );
      if (c.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selected customer not found for this company' });
      }
      customerId = data.customer_id;
    } else if (data.customer) {
      const { rows: newCust } = await client.query(
        `INSERT INTO customers (company_id, name, phone, email, address, gstin)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          company_id,
          data.customer.name,
          data.customer.phone || null,
          data.customer.email || null,
          data.customer.address || null,
          data.customer.gstin || null,
        ],
      );
      customerId = newCust[0].id;
    }

    const { rows: custRows } = await client.query(
      `SELECT name, phone, email, address, gstin FROM customers WHERE id = $1 AND company_id = $2`,
      [customerId, company_id],
    );
    const customer = custRows[0] || {};
    const customerGstin = customer.gstin;

    const { rows: compRows } = await client.query(
      `SELECT name, gstin, address, phone, email FROM companies WHERE id = $1`,
      [company_id],
    );
    const company = compRows[0] || {};
    const companyGstin = company.gstin;

    const seller = data.seller_details || {
      name: current.seller_name || company.name,
      gstin: current.seller_gstin || company.gstin,
      address: current.seller_address || company.address,
      phone: current.seller_phone || company.phone,
      email: current.seller_email || company.email,
    };
    const billing = data.billing_details || {
      name: current.bill_to_name || customer.name,
      gstin: current.bill_to_gstin || customer.gstin,
      address: current.bill_to_address || customer.address,
      phone: current.bill_to_phone || customer.phone,
      email: current.bill_to_email || customer.email,
    };
    const shipToSame = data.ship_to_same_as_billing !== undefined
      ? data.ship_to_same_as_billing
      : current.ship_to_same_as_billing !== false;
    const shipping = shipToSame
      ? { ...billing }
      : (data.shipping_details || {
        name: current.ship_to_name || billing.name,
        gstin: current.ship_to_gstin || billing.gstin,
        address: current.ship_to_address || billing.address,
        phone: current.ship_to_phone || billing.phone,
        email: current.ship_to_email || billing.email,
      });

    const interstate = isInterstate(seller.gstin || companyGstin, billing.gstin || customerGstin);
    const {
      processedItems,
      subtotal,
      totalCgst,
      totalSgst,
      totalIgst,
    } = computeInvoiceItems(data.items, interstate);

    const discount = data.discount || 0;
    const total = subtotal - discount + totalCgst + totalSgst + totalIgst;

    await client.query(
      `UPDATE invoices
       SET invoice_date = $1,
           customer_id = $2,
           subtotal = $3,
           discount = $4,
           cgst_amount = $5,
           sgst_amount = $6,
           igst_amount = $7,
           total = $8,
           notes = $9,
           payment_type = $10,
           seller_name = $11,
           seller_gstin = $12,
           seller_address = $13,
           seller_phone = $14,
           seller_email = $15,
           bill_to_name = $16,
           bill_to_gstin = $17,
           bill_to_address = $18,
           bill_to_phone = $19,
           bill_to_email = $20,
           ship_to_name = $21,
           ship_to_gstin = $22,
           ship_to_address = $23,
           ship_to_phone = $24,
           ship_to_email = $25,
           ship_to_same_as_billing = $26,
           updated_at = NOW()
       WHERE id = $27 AND company_id = $28`,
      [
        data.invoice_date || new Date().toISOString().split('T')[0],
        customerId,
        subtotal,
        discount,
        totalCgst,
        totalSgst,
        totalIgst,
        total,
        data.notes || null,
        data.payment_type || 'Cash',
        seller.name || null,
        seller.gstin || null,
        seller.address || null,
        seller.phone || null,
        seller.email || null,
        billing.name || null,
        billing.gstin || null,
        billing.address || null,
        billing.phone || null,
        billing.email || null,
        shipping.name || null,
        shipping.gstin || null,
        shipping.address || null,
        shipping.phone || null,
        shipping.email || null,
        shipToSame,
        id,
        company_id,
      ],
    );

    await client.query(
      `UPDATE invoice_items
       SET is_deleted = TRUE, updated_at = NOW()
       WHERE invoice_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [id, company_id],
    );

    for (const item of processedItems) {
      await client.query(
        `INSERT INTO invoice_items
           (invoice_id, company_id, description, hsn_code, quantity, unit_price,
            cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount, tax_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          company_id,
          item.description,
          item.hsn_code,
          item.quantity,
          item.unit_price,
          item.cgst_rate,
          item.sgst_rate,
          item.igst_rate,
          item.cgst_amount,
          item.sgst_amount,
          item.igst_amount,
          item.amount,
          item.tax_mode || 'auto',
        ],
      );
    }

    await client.query('COMMIT');
    const result = await fetchFullInvoice(id, company_id);
    logAudit({
      companyId: company_id,
      userId: req.user.id,
      action: 'update',
      entity: 'invoice',
      entityId: id,
      req,
    });
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cancelInvoice(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const denied = await invoiceBranchAccessError(req, id);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, status, vehicle_id FROM invoices
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [id, company_id],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const inv = rows[0];
    if (inv.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invoice is already cancelled' });
    }

    // Revert vehicle to in_stock if it was sold via this invoice
    if (inv.vehicle_id && inv.status === 'confirmed') {
      await client.query(
        `UPDATE vehicles SET status = 'in_stock' WHERE id = $1 AND company_id = $2`,
        [inv.vehicle_id, company_id],
      );
    }

    await client.query(
      `UPDATE invoices SET status = 'cancelled' WHERE id = $1`,
      [id],
    );

    await client.query('COMMIT');
    logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'invoice', entityId: id, oldValue: { status: 'confirmed' }, newValue: { status: 'cancelled' }, req });
    res.json({ message: 'Invoice cancelled', invoice_id: id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function confirmInvoice(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const denied = await invoiceBranchAccessError(req, id);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, status, vehicle_id FROM invoices
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [id, company_id],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only draft invoices can be confirmed' });
    }

    if (rows[0].vehicle_id) {
      const { rows: vRows } = await client.query(
        `SELECT status FROM vehicles WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [rows[0].vehicle_id, company_id],
      );
      if (vRows[0]?.status !== 'in_stock') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Vehicle is no longer available' });
      }
      await client.query(
        `UPDATE vehicles SET status = 'sold' WHERE id = $1`,
        [rows[0].vehicle_id],
      );
    }

    await client.query(
      `UPDATE invoices SET status = 'confirmed' WHERE id = $1`,
      [id],
    );

    await client.query('COMMIT');

    const result = await fetchFullInvoice(id, company_id);
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Shared helper
async function fetchFullInvoice(invoiceId, companyId) {
  const { rows } = await query(
    `SELECT i.*,
            COALESCE(i.bill_to_name, c.name) AS customer_name, COALESCE(i.bill_to_phone, c.phone) AS customer_phone, COALESCE(i.bill_to_email, c.email) AS customer_email,
            COALESCE(i.bill_to_address, c.address) AS customer_address, COALESCE(i.bill_to_gstin, c.gstin) AS customer_gstin,
            i.ship_to_name, i.ship_to_phone, i.ship_to_email, i.ship_to_address, i.ship_to_gstin, i.ship_to_same_as_billing,
            b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone,
            COALESCE(i.seller_name, co.name) AS company_name, COALESCE(i.seller_gstin, co.gstin) AS company_gstin, COALESCE(i.seller_address, co.address) AS company_address,
            COALESCE(i.seller_phone, co.phone) AS company_phone, COALESCE(i.seller_email, co.email) AS company_email,
            co.logo_url, co.signature_url,
            v.chassis_number, v.engine_number, v.rto_number AS rto_number,
            v.make AS vehicle_make, v.model AS vehicle_model,
            v.variant AS vehicle_variant, v.color AS vehicle_color, v.year AS vehicle_year,
            lo.bank_name AS loan_bank_name, lo.loan_amount AS loan_amount,
            lo.emi_amount AS loan_emi_amount, lo.tenure_months AS loan_tenure_months,
            lo.disbursement_date AS loan_disbursement_date, lo.due_date AS loan_due_date
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN branches b ON b.id = i.branch_id
     LEFT JOIN companies co ON co.id = i.company_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN LATERAL (
       SELECT l2.bank_name, l2.loan_amount, l2.emi_amount, l2.tenure_months, l2.disbursement_date, l2.due_date
       FROM loans l2
       WHERE l2.invoice_id = i.id AND l2.company_id = i.company_id AND l2.is_deleted = FALSE
       ORDER BY l2.created_at DESC
       LIMIT 1
     ) lo ON TRUE
     WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = FALSE`,
    [invoiceId, companyId],
  );

  if (rows.length === 0) return null;

  const { rows: items } = await query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 AND is_deleted = FALSE ORDER BY created_at`,
    [invoiceId],
  );

  return { invoice: rows[0], items };
}

module.exports = {
  createInvoice,
  updateInvoice,
  insertInvoiceWithItems,
  listInvoices,
  getInvoice,
  cancelInvoice,
  confirmInvoice,
  fetchFullInvoice,
  invoiceBranchAccessError,
};
