const { query, getClient } = require('../config/db');
const { isInterstate, calculateGst, getGstRateForHsn } = require('../services/gstService');
const { logAudit } = require('../middleware/auditLog');

async function generateInvoiceNumber(client, companyId, branchId) {
  const year = new Date().getFullYear();

  // Get branch code (first 3 chars uppercase)
  const { rows: brRows } = await client.query(
    `SELECT name FROM branches WHERE id = $1`,
    [branchId],
  );
  const branchCode = (brRows[0]?.name || 'GEN').substring(0, 3).toUpperCase();

  // Get next sequence for this company+year
  const { rows: seqRows } = await client.query(
    `SELECT COUNT(*)::int + 1 AS seq FROM invoices
     WHERE company_id = $1 AND invoice_number LIKE $2`,
    [companyId, `INV-${year}-${branchCode}-%`],
  );
  const seq = String(seqRows[0].seq).padStart(4, '0');

  return `INV-${year}-${branchCode}-${seq}`;
}

async function createInvoice(req, res) {
  const company_id = req.user.company_id;
  const branch_id = req.user.branch_id;
  const data = req.validated;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Resolve or create customer
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

    // Fetch customer GSTIN for interstate check
    const { rows: custRows } = await client.query(
      `SELECT gstin FROM customers WHERE id = $1 AND company_id = $2`,
      [customerId, company_id],
    );
    const customerGstin = custRows[0]?.gstin;

    // Fetch company GSTIN
    const { rows: compRows } = await client.query(
      `SELECT gstin FROM companies WHERE id = $1`,
      [company_id],
    );
    const companyGstin = compRows[0]?.gstin;

    const interstate = isInterstate(companyGstin, customerGstin);

    // Validate vehicle if provided
    let vehicleId = data.vehicle_id || null;
    if (vehicleId) {
      const { rows: vRows } = await client.query(
        `SELECT id, selling_price, status FROM vehicles
         WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
        [vehicleId, company_id],
      );
      if (vRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Vehicle not found' });
      }
      if (vRows[0].status !== 'in_stock') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Vehicle is not available for sale' });
      }
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(client, company_id, branch_id);

    // Process items and calculate GST
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    const processedItems = [];

    for (const item of data.items) {
      const unitPrice = item.unit_price; // already in paise
      const qty = item.quantity || 1;
      const lineTotal = unitPrice * qty;
      const hsnCode = item.hsn_code || '8703';
      const gstRate = item.gst_rate !== undefined ? item.gst_rate : getGstRateForHsn(hsnCode);

      const gst = calculateGst(lineTotal, gstRate, interstate);

      const amount = lineTotal + gst.cgst_amount + gst.sgst_amount + gst.igst_amount;

      processedItems.push({
        description: item.description,
        hsn_code: hsnCode,
        quantity: qty,
        unit_price: unitPrice,
        ...gst,
        amount,
      });

      subtotal += lineTotal;
      totalCgst += gst.cgst_amount;
      totalSgst += gst.sgst_amount;
      totalIgst += gst.igst_amount;
    }

    const discount = data.discount || 0;
    const total = subtotal - discount + totalCgst + totalSgst + totalIgst;

    // Create invoice
    const { rows: invRows } = await client.query(
      `INSERT INTO invoices
         (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
          subtotal, discount, cgst_amount, sgst_amount, igst_amount, total, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        company_id, branch_id, invoiceNumber, data.invoice_date || new Date().toISOString().split('T')[0],
        customerId, vehicleId,
        subtotal, discount, totalCgst, totalSgst, totalIgst, total,
        data.status || 'draft', data.notes || null,
      ],
    );

    const invoice = invRows[0];

    // Insert invoice items
    for (const item of processedItems) {
      await client.query(
        `INSERT INTO invoice_items
           (invoice_id, company_id, description, hsn_code, quantity, unit_price,
            cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          invoice.id, company_id, item.description, item.hsn_code, item.quantity,
          item.unit_price, item.cgst_rate, item.sgst_rate, item.igst_rate,
          item.cgst_amount, item.sgst_amount, item.igst_amount, item.amount,
        ],
      );
    }

    // If confirmed, mark vehicle as sold
    if (data.status === 'confirmed' && vehicleId) {
      await client.query(
        `UPDATE vehicles SET status = 'sold' WHERE id = $1 AND company_id = $2`,
        [vehicleId, company_id],
      );
    }

    await client.query('COMMIT');

    // Fetch complete invoice with items
    const result = await fetchFullInvoice(invoice.id, company_id);
    logAudit({ companyId: company_id, userId: req.user.id, action: 'create', entity: 'invoice', entityId: invoice.id, newValue: { invoice_number: invoice.invoice_number, total: invoice.total }, req });
    res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK');
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
  const result = await fetchFullInvoice(id, company_id);
  if (!result) return res.status(404).json({ error: 'Invoice not found' });
  res.json(result);
}

async function cancelInvoice(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;

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
            c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
            c.address AS customer_address, c.gstin AS customer_gstin,
            b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone,
            co.name AS company_name, co.gstin AS company_gstin, co.address AS company_address,
            co.phone AS company_phone, co.email AS company_email,
            co.logo_url, co.signature_url,
            v.chassis_number, v.engine_number, v.make AS vehicle_make, v.model AS vehicle_model,
            v.variant AS vehicle_variant, v.color AS vehicle_color, v.year AS vehicle_year
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN branches b ON b.id = i.branch_id
     LEFT JOIN companies co ON co.id = i.company_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
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
  createInvoice, listInvoices, getInvoice, cancelInvoice, confirmInvoice, fetchFullInvoice,
};
