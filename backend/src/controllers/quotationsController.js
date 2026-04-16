const { query, getClient } = require('../config/db');
const { logAudit } = require('../middleware/auditLog');
const { computeQuotationTotals, resolveInterstate } = require('../services/quotationCalculator');
const { buildQuotationHtml, DEFAULT_TERMS } = require('../services/quotationRenderService');
const { htmlToPdfBuffer } = require('../services/pdfService');
const { insertInvoiceWithItems, fetchFullInvoice } = require('./invoicesController');

function financialYearFromDate(dateStr) {
  const d = (dateStr || new Date().toISOString()).split('T')[0];
  const [Y, M] = d.split('-').map(Number);
  if (M >= 4) return `${Y}-${String(Y + 1).slice(-2)}`;
  return `${Y - 1}-${String(Y).slice(-2)}`;
}

async function generateQuotationNumber(client, companyId, branchId, quotationDateStr) {
  const fy = financialYearFromDate(quotationDateStr);
  const { rows: br } = await client.query(
    `SELECT code, name FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [branchId, companyId],
  );
  if (!br.length) throw new Error('Invalid branch');
  const raw = (br[0].code || br[0].name || 'BR').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const branchCode = (raw || 'BR').slice(0, 10);
  const prefix = `QT/${branchCode}/${fy}/`;
  const { rows } = await client.query(
    `SELECT quotation_number FROM quotations
     WHERE company_id = $1 AND branch_id = $2 AND is_deleted = FALSE AND quotation_number LIKE $3`,
    [companyId, branchId, `${prefix}%`],
  );
  let max = 0;
  for (const r of rows) {
    const suf = r.quotation_number.slice(prefix.length);
    const n = parseInt(suf, 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

async function fetchCustomerGstin(customerId, companyId) {
  if (!customerId) return null;
  const { rows } = await query(
    `SELECT gstin FROM customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [customerId, companyId],
  );
  return rows[0]?.gstin || null;
}

async function fetchCompanyRow(companyId) {
  const { rows } = await query(
    `SELECT name, gstin, address, phone, email, logo_url, signature_url FROM companies WHERE id = $1`,
    [companyId],
  );
  return rows[0] || {};
}

async function loadQuotationBundle(quotationId, companyId) {
  const { rows: qrows } = await query(
    `SELECT q.*,
            c.name AS cust_name, c.phone AS cust_phone, c.email AS cust_email,
            c.address AS cust_address, c.gstin AS cust_gstin,
            v.make AS v_make, v.model AS v_model, v.variant AS v_variant,
            v.color AS v_color, v.year AS v_year, v.chassis_number AS v_chassis,
            v.selling_price AS v_selling_price,
            b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone,
            u.name AS prepared_by_name,
            co.name AS company_name, co.gstin AS company_gstin, co.address AS company_address,
            co.phone AS company_phone, co.email AS company_email, co.logo_url, co.signature_url
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN vehicles v ON v.id = q.vehicle_id
     LEFT JOIN branches b ON b.id = q.branch_id
     LEFT JOIN users u ON u.id = q.prepared_by
     LEFT JOIN companies co ON co.id = q.company_id
     WHERE q.id = $1 AND q.company_id = $2 AND q.is_deleted = FALSE`,
    [quotationId, companyId],
  );
  if (!qrows.length) return null;
  const q = qrows[0];
  const { rows: items } = await query(
    `SELECT * FROM quotation_items
     WHERE quotation_id = $1 AND company_id = $2 AND is_deleted = FALSE
     ORDER BY sort_order ASC, created_at ASC`,
    [quotationId, companyId],
  );
  const customer = q.customer_id
    ? {
      name: q.cust_name,
      phone: q.cust_phone,
      email: q.cust_email,
      address: q.cust_address,
      gstin: q.cust_gstin,
    }
    : null;
  const vehicle = q.vehicle_id
    ? {
      make: q.v_make,
      model: q.v_model,
      variant: q.v_variant,
      color: q.v_color,
      year: q.v_year,
      chassis_number: q.v_chassis,
      selling_price: q.v_selling_price,
    }
    : null;
  const vehicleOverride = q.vehicle_details_override && typeof q.vehicle_details_override === 'object'
    ? q.vehicle_details_override
    : {};
  const company = {
    name: q.company_name,
    gstin: q.company_gstin,
    address: q.company_address,
    phone: q.company_phone,
    email: q.company_email,
    logo_url: q.logo_url,
    signature_url: q.signature_url,
  };
  const branch = {
    name: q.branch_name,
    address: q.branch_address,
    phone: q.branch_phone,
  };
  return {
    quotation: q,
    items,
    customer,
    vehicle,
    vehicleOverride,
    company,
    branch,
    preparedByName: q.prepared_by_name,
    logo_url: q.logo_url,
    signature_url: q.signature_url,
  };
}

function stripBundleForJson(bundle) {
  const q = { ...bundle.quotation };
  delete q.cust_name;
  delete q.cust_phone;
  delete q.cust_email;
  delete q.cust_address;
  delete q.cust_gstin;
  delete q.v_make;
  delete q.v_model;
  delete q.v_variant;
  delete q.v_color;
  delete q.v_year;
  delete q.v_chassis;
  delete q.v_selling_price;
  delete q.branch_name;
  delete q.branch_address;
  delete q.branch_phone;
  delete q.prepared_by_name;
  delete q.company_name;
  delete q.company_gstin;
  delete q.company_address;
  delete q.company_phone;
  delete q.company_email;
  delete q.logo_url;
  delete q.signature_url;
  return {
    quotation: q,
    items: bundle.items,
    customer: bundle.customer,
    vehicle: bundle.vehicle,
    vehicle_override: bundle.vehicleOverride,
    prepared_by_name: bundle.preparedByName,
  };
}

async function persistQuotation(client, {
  company_id,
  branch_id,
  user_id,
  quotationId,
  body,
  totals,
  processedLines,
}) {
  const qd = body.quotation_date || new Date().toISOString().split('T')[0];
  const qnum = quotationId
    ? (await client.query(`SELECT quotation_number FROM quotations WHERE id = $1`, [quotationId])).rows[0]?.quotation_number
    : await generateQuotationNumber(client, company_id, branch_id, qd);

  const fields = {
    company_id,
    branch_id,
    quotation_number: qnum,
    quotation_date: qd,
    valid_until_date: body.valid_until_date || null,
    customer_id: body.customer_id || null,
    customer_name_override: body.customer_name_override || null,
    customer_phone_override: body.customer_phone_override || null,
    customer_email_override: body.customer_email_override || null,
    customer_address_override: body.customer_address_override || null,
    vehicle_id: body.vehicle_id || null,
    vehicle_details_override: body.vehicle_details_override
      ? JSON.stringify(body.vehicle_details_override)
      : null,
    status: body.status || 'draft',
    subtotal: totals.subtotal,
    discount_type: body.discount_type || 'flat',
    discount_value: Number(body.discount_value) || 0,
    discount_amount: totals.discount_amount,
    cgst_amount: totals.cgst_amount,
    sgst_amount: totals.sgst_amount,
    igst_amount: totals.igst_amount,
    total: totals.total,
    notes: body.notes ?? null,
    customer_notes: body.customer_notes ?? null,
    terms_and_conditions: body.terms_and_conditions ?? DEFAULT_TERMS,
    prepared_by: user_id,
  };

  let qrow;
  if (quotationId) {
    const { rows } = await client.query(
      `UPDATE quotations SET
         branch_id = $2,
         quotation_date = $3,
         valid_until_date = $4,
         customer_id = $5,
         customer_name_override = $6,
         customer_phone_override = $7,
         customer_email_override = $8,
         customer_address_override = $9,
         vehicle_id = $10,
         vehicle_details_override = $11::jsonb,
         subtotal = $12,
         discount_type = $13,
         discount_value = $14,
         discount_amount = $15,
         cgst_amount = $16,
         sgst_amount = $17,
         igst_amount = $18,
         total = $19,
         notes = $20,
         customer_notes = $21,
         terms_and_conditions = $22,
         updated_at = NOW()
       WHERE id = $1 AND company_id = $23 AND is_deleted = FALSE
         AND status IN ('draft','sent')
       RETURNING *`,
      [
        quotationId, branch_id,
        fields.quotation_date, fields.valid_until_date,
        fields.customer_id, fields.customer_name_override,
        fields.customer_phone_override, fields.customer_email_override,
        fields.customer_address_override, fields.vehicle_id,
        fields.vehicle_details_override,
        fields.subtotal, fields.discount_type, fields.discount_value,
        fields.discount_amount, fields.cgst_amount, fields.sgst_amount,
        fields.igst_amount, fields.total,
        fields.notes, fields.customer_notes, fields.terms_and_conditions,
        company_id,
      ],
    );
    if (!rows.length) return null;
    qrow = rows[0];
    await client.query(
      `DELETE FROM quotation_items WHERE quotation_id = $1 AND company_id = $2`,
      [quotationId, company_id],
    );
  } else {
    const { rows } = await client.query(
      `INSERT INTO quotations (
         company_id, branch_id, quotation_number, quotation_date, valid_until_date,
         customer_id, customer_name_override, customer_phone_override, customer_email_override,
         customer_address_override, vehicle_id, vehicle_details_override, status,
         subtotal, discount_type, discount_value, discount_amount,
         cgst_amount, sgst_amount, igst_amount, total,
         notes, customer_notes, terms_and_conditions, prepared_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,
         $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
       ) RETURNING *`,
      [
        company_id, branch_id, fields.quotation_number, fields.quotation_date,
        fields.valid_until_date, fields.customer_id, fields.customer_name_override,
        fields.customer_phone_override, fields.customer_email_override,
        fields.customer_address_override, fields.vehicle_id,
        body.vehicle_details_override ? JSON.stringify(body.vehicle_details_override) : null,
        fields.status,
        fields.subtotal, fields.discount_type, fields.discount_value, fields.discount_amount,
        fields.cgst_amount, fields.sgst_amount, fields.igst_amount, fields.total,
        fields.notes, fields.customer_notes, fields.terms_and_conditions, user_id,
      ],
    );
    qrow = rows[0];
  }

  for (let i = 0; i < processedLines.length; i += 1) {
    const li = processedLines[i];
    await client.query(
      `INSERT INTO quotation_items (
         quotation_id, company_id, item_type, description, hsn_code, quantity, unit_price,
         discount_type, discount_value, discount_amount,
         cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount, sort_order
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
       )`,
      [
        qrow.id, company_id, li.item_type, li.description, li.hsn_code || null, li.quantity,
        li.unit_price, li.discount_type, li.discount_value, li.discount_amount,
        li.cgst_rate, li.sgst_rate, li.igst_rate,
        li.cgst_amount, li.sgst_amount, li.igst_amount, li.amount,
        li.sort_order !== undefined ? li.sort_order : i,
      ],
    );
  }

  return qrow;
}

function buildLinesFromBody(items) {
  return items.map((it, i) => ({
    item_type: it.item_type || 'other',
    description: it.description,
    hsn_code: it.hsn_code,
    quantity: it.quantity,
    unit_price: it.unit_price,
    discount_type: it.discount_type || 'none',
    discount_value: it.discount_value ?? 0,
    gst_rate: it.gst_rate ?? 0,
    sort_order: it.sort_order ?? i,
  }));
}

async function createQuotation(req, res) {
  const company_id = req.user.company_id;
  const user_id = req.user.id;
  const body = req.validated;
  let branch_id = body.branch_id || req.user.branch_id;
  if (req.user.role === 'branch_manager') {
    branch_id = req.user.branch_id;
  }
  if (!branch_id) return res.status(400).json({ error: 'branch_id required' });

  const comp = await fetchCompanyRow(company_id);
  const custGst = await fetchCustomerGstin(body.customer_id, company_id);
  const interstate = resolveInterstate(comp.gstin, custGst);

  const linesIn = buildLinesFromBody(body.items);
  const totals = computeQuotationTotals(
    linesIn,
    interstate,
    body.discount_type || 'flat',
    Number(body.discount_value) || 0,
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const qrow = await persistQuotation(client, {
      company_id,
      branch_id,
      user_id,
      quotationId: null,
      body,
      totals,
      processedLines: totals.lines,
    });
    await client.query('COMMIT');
    logAudit({
      companyId: company_id, userId: user_id, action: 'create', entity: 'quotation',
      entityId: qrow.id, newValue: { quotation_number: qrow.quotation_number }, req,
    });
    const bundle = await loadQuotationBundle(qrow.id, company_id);
    res.status(201).json(stripBundleForJson(bundle));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function listQuotations(req, res) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  const {
    status, branch_id, customer_search, date_from, date_to, page = 1, limit = 50,
  } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['q.company_id = $1', 'q.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  if (role === 'staff' || role === 'branch_manager') {
    conditions.push(`q.branch_id = $${idx++}`);
    params.push(userBranch);
  } else if (branch_id) {
    conditions.push(`q.branch_id = $${idx++}`);
    params.push(branch_id);
  }

  if (status) {
    conditions.push(`q.status = $${idx++}`);
    params.push(status);
  }
  if (date_from) {
    conditions.push(`q.quotation_date >= $${idx++}`);
    params.push(date_from);
  }
  if (date_to) {
    conditions.push(`q.quotation_date <= $${idx++}`);
    params.push(date_to);
  }
  if (customer_search) {
    const p = `%${customer_search}%`;
    conditions.push(`(
      (c.name ILIKE $${idx} OR c.phone ILIKE $${idx})
      OR q.customer_name_override ILIKE $${idx}
      OR q.customer_phone_override ILIKE $${idx}
    )`);
    params.push(p);
    idx += 1;
  }

  const where = conditions.join(' AND ');
  const countResult = await query(
    `SELECT COUNT(*) FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     WHERE ${where}`,
    params,
  );

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT q.*,
            COALESCE(c.name, q.customer_name_override) AS customer_display_name,
            COALESCE(c.phone, q.customer_phone_override) AS customer_display_phone,
            v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number,
            b.name AS branch_name
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN vehicles v ON v.id = q.vehicle_id
     LEFT JOIN branches b ON b.id = q.branch_id
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
  const bundle = await loadQuotationBundle(req.params.id, req.user.company_id);
  if (!bundle) return res.status(404).json({ error: 'Quotation not found' });
  res.json(stripBundleForJson(bundle));
}

async function updateQuotation(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const user_id = req.user.id;
  const body = req.validated;

  const { rows: cur } = await query(
    `SELECT id, status, branch_id FROM quotations WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );
  if (!cur.length) return res.status(404).json({ error: 'Quotation not found' });
  if (!['draft', 'sent'].includes(cur[0].status)) {
    return res.status(400).json({ error: 'Only draft or sent quotations can be updated' });
  }

  let branch_id = body.branch_id != null ? body.branch_id : cur[0].branch_id;
  if (req.user.role === 'branch_manager') {
    branch_id = cur[0].branch_id;
    if (body.branch_id != null && String(body.branch_id) !== String(cur[0].branch_id)) {
      return res.status(403).json({ error: 'Cannot change branch' });
    }
  }
  const comp = await fetchCompanyRow(company_id);
  const custGst = await fetchCustomerGstin(body.customer_id, company_id);
  const interstate = resolveInterstate(comp.gstin, custGst);
  const linesIn = buildLinesFromBody(body.items);
  const totals = computeQuotationTotals(
    linesIn,
    interstate,
    body.discount_type || 'flat',
    Number(body.discount_value) || 0,
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const qrow = await persistQuotation(client, {
      company_id,
      branch_id,
      user_id,
      quotationId: id,
      body: { ...body, status: cur[0].status },
      totals,
      processedLines: totals.lines,
    });
    await client.query('COMMIT');
    if (!qrow) {
      return res.status(400).json({ error: 'Update failed' });
    }
    logAudit({
      companyId: company_id, userId: user_id, action: 'update', entity: 'quotation',
      entityId: id, req,
    });
    const bundle = await loadQuotationBundle(id, company_id);
    res.json(stripBundleForJson(bundle));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function sendQuotation(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const { rows } = await query(
    `UPDATE quotations SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status IN ('draft','sent')
     RETURNING *`,
    [id, company_id],
  );
  if (!rows.length) return res.status(400).json({ error: 'Cannot mark as sent' });
  logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'quotation', entityId: id, newValue: { status: 'sent' }, req });
  res.json({ quotation: rows[0] });
}

async function acceptQuotation(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const { rows } = await query(
    `UPDATE quotations SET status = 'accepted', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'sent'
     RETURNING *`,
    [id, company_id],
  );
  if (!rows.length) return res.status(400).json({ error: 'Only sent quotations can be accepted' });
  logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'quotation', entityId: id, newValue: { status: 'accepted' }, req });
  res.json({ quotation: rows[0] });
}

async function rejectQuotation(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const { rows } = await query(
    `UPDATE quotations SET status = 'rejected', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status IN ('sent','draft')
     RETURNING *`,
    [id, company_id],
  );
  if (!rows.length) return res.status(400).json({ error: 'Cannot reject this quotation' });
  logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'quotation', entityId: id, newValue: { status: 'rejected' }, req });
  res.json({ quotation: rows[0] });
}

async function deleteQuotation(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const { rows } = await query(
    `UPDATE quotations SET is_deleted = TRUE, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'draft'
     RETURNING id`,
    [id, company_id],
  );
  if (!rows.length) return res.status(400).json({ error: 'Only draft quotations can be deleted' });
  logAudit({ companyId: company_id, userId: req.user.id, action: 'delete', entity: 'quotation', entityId: id, req });
  res.json({ success: true });
}

async function duplicateQuotation(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const user_id = req.user.id;
  const bundle = await loadQuotationBundle(id, company_id);
  if (!bundle) return res.status(404).json({ error: 'Quotation not found' });

  const q = bundle.quotation;
  const body = {
    branch_id: q.branch_id,
    quotation_date: new Date().toISOString().split('T')[0],
    valid_until_date: q.valid_until_date,
    customer_id: q.customer_id,
    customer_name_override: q.customer_name_override,
    customer_phone_override: q.customer_phone_override,
    customer_email_override: q.customer_email_override,
    customer_address_override: q.customer_address_override,
    vehicle_id: q.vehicle_id,
    vehicle_details_override: q.vehicle_details_override,
    discount_type: q.discount_type,
    discount_value: q.discount_value,
    notes: q.notes,
    customer_notes: q.customer_notes,
    terms_and_conditions: q.terms_and_conditions || DEFAULT_TERMS,
    status: 'draft',
    items: bundle.items.map((it) => ({
      item_type: it.item_type,
      description: it.description,
      hsn_code: it.hsn_code,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount_type: it.discount_type,
      discount_value: it.discount_value,
      gst_rate: Number(it.igst_rate) > 0
        ? Number(it.igst_rate)
        : Number(it.cgst_rate) + Number(it.sgst_rate),
      sort_order: it.sort_order,
    })),
  };

  const comp = await fetchCompanyRow(company_id);
  const custGst = await fetchCustomerGstin(body.customer_id, company_id);
  const interstate = resolveInterstate(comp.gstin, custGst);
  const linesIn = buildLinesFromBody(body.items);
  const totals = computeQuotationTotals(
    linesIn,
    interstate,
    body.discount_type || 'flat',
    Number(body.discount_value) || 0,
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const qrow = await persistQuotation(client, {
      company_id,
      branch_id: q.branch_id,
      user_id,
      quotationId: null,
      body,
      totals,
      processedLines: totals.lines,
    });
    await client.query('COMMIT');
    logAudit({
      companyId: company_id, userId: user_id, action: 'create', entity: 'quotation',
      entityId: qrow.id, newValue: { duplicated_from: id }, req,
    });
    const nb = await loadQuotationBundle(qrow.id, company_id);
    res.status(201).json(stripBundleForJson(nb));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function convertToInvoice(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const user_id = req.user.id;

  const bundle = await loadQuotationBundle(id, company_id);
  if (!bundle) return res.status(404).json({ error: 'Quotation not found' });
  const q = bundle.quotation;

  if (!['sent', 'accepted'].includes(q.status)) {
    return res.status(400).json({ error: 'Only sent or accepted quotations can be converted' });
  }

  const voRaw = q.vehicle_details_override;
  const hasVehicleOverride = voRaw && typeof voRaw === 'object' && !Array.isArray(voRaw) && Object.keys(voRaw).length > 0;
  if (!q.vehicle_id && hasVehicleOverride) {
    return res.json({ requiresVehicleSelection: true, quotation_id: q.id });
  }

  let customerId = q.customer_id;
  if (!customerId) {
    if (!q.customer_name_override || !q.customer_phone_override) {
      return res.status(400).json({ error: 'Customer name and phone are required to convert (walk-in)' });
    }
  }

  const items = bundle.items.map((it) => {
    const qty = it.quantity || 1;
    const lineTaxable = Number(it.amount) - Number(it.cgst_amount) - Number(it.sgst_amount) - Number(it.igst_amount);
    const effUnit = qty > 0 ? Math.round(lineTaxable / qty) : 0;
    const gstRate = Number(it.igst_rate) > 0
      ? Number(it.igst_rate)
      : Number(it.cgst_rate) + Number(it.sgst_rate);
    return {
      description: it.description,
      hsn_code: it.hsn_code || '8703',
      quantity: qty,
      unit_price: effUnit,
      gst_rate: gstRate,
    };
  });

  const invoicePayload = {
    customer_id: customerId || undefined,
    customer: !customerId
      ? {
        name: q.customer_name_override,
        phone: q.customer_phone_override,
        email: q.customer_email_override || undefined,
        address: q.customer_address_override || undefined,
      }
      : undefined,
    vehicle_id: q.vehicle_id || undefined,
    items,
    discount: Number(q.discount_amount) || 0,
    status: 'draft',
    notes: `Converted from quotation ${q.quotation_number}`,
    invoice_date: new Date().toISOString().split('T')[0],
  };

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const invoice = await insertInvoiceWithItems(client, company_id, q.branch_id, invoicePayload);
    await client.query(
      `UPDATE quotations SET status = 'converted', converted_to_invoice_id = $1, converted_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND company_id = $3`,
      [invoice.id, id, company_id],
    );
    await client.query('COMMIT');
    logAudit({
      companyId: company_id, userId: user_id, action: 'create', entity: 'invoice',
      entityId: invoice.id, newValue: { from_quotation: q.quotation_number }, req,
    });
    logAudit({
      companyId: company_id, userId: user_id, action: 'update', entity: 'quotation',
      entityId: id, newValue: { converted_to_invoice_id: invoice.id }, req,
    });
    const invFull = await fetchFullInvoice(invoice.id, company_id);
    res.status(201).json({
      invoice_id: invoice.id,
      invoice: invFull,
      requiresVehicleSelection: false,
    });
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

async function getQuotationPdf(req, res) {
  try {
    const bundle = await loadQuotationBundle(req.params.id, req.user.company_id);
    if (!bundle) return res.status(404).json({ error: 'Quotation not found' });
    const html = buildQuotationHtml(bundle);
    const pdf = await htmlToPdfBuffer(html);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${bundle.quotation.quotation_number}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (err) {
    console.error('getQuotationPdf:', err.message);
    res.status(500).json({
      error:
        'PDF generation failed. Ensure Google Chrome or Chromium is installed on the server and try again.',
    });
  }
}

async function getQuotationPreviewHtml(req, res) {
  try {
    const bundle = await loadQuotationBundle(req.params.id, req.user.company_id);
    if (!bundle) return res.status(404).json({ error: 'Quotation not found' });
    const html = buildQuotationHtml(bundle);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('getQuotationPreviewHtml:', err);
    res.status(500).json({
      error: 'Quotation preview could not be generated.',
      details: process.env.NODE_ENV === 'development' ? String(err.message) : undefined,
    });
  }
}

async function previewQuotationHtmlFromBody(req, res) {
  try {
    const company_id = req.user.company_id;
    const body = req.validated;
    const comp = await fetchCompanyRow(company_id);
    const custGst = await fetchCustomerGstin(body.customer_id, company_id);
    const interstate = resolveInterstate(comp.gstin, custGst);
    const linesIn = buildLinesFromBody(body.items);
    const totals = computeQuotationTotals(
      linesIn,
      interstate,
      body.discount_type || 'flat',
      Number(body.discount_value) || 0,
    );

    const q = {
      ...body,
      company_id,
      quotation_number: 'PREVIEW',
      quotation_date: body.quotation_date || new Date().toISOString().split('T')[0],
      valid_until_date: body.valid_until_date,
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      cgst_amount: totals.cgst_amount,
      sgst_amount: totals.sgst_amount,
      igst_amount: totals.igst_amount,
      total: totals.total,
      customer_notes: body.customer_notes,
      terms_and_conditions: body.terms_and_conditions || DEFAULT_TERMS,
    };

    const previewBranchId =
      req.user.role === 'branch_manager' ? req.user.branch_id : (body.branch_id || req.user.branch_id);
    const { rows: br } = await query(
      `SELECT name, address, phone FROM branches WHERE id = $1 AND company_id = $2`,
      [previewBranchId, company_id],
    );

    const customer = body.customer_id
      ? (await query(
        `SELECT name, phone, email, address FROM customers WHERE id = $1 AND company_id = $2`,
        [body.customer_id, company_id],
      )).rows[0]
      : {
        name: body.customer_name_override,
        phone: body.customer_phone_override,
        email: body.customer_email_override,
        address: body.customer_address_override,
      };

    let vehicle = null;
    if (body.vehicle_id) {
      const { rows: v } = await query(
        `SELECT make, model, variant, color, year, chassis_number, selling_price
         FROM vehicles WHERE id = $1 AND company_id = $2`,
        [body.vehicle_id, company_id],
      );
      vehicle = v[0] || null;
    }

    const bundle = {
      quotation: q,
      items: totals.lines.map((li, i) => ({ ...li, id: `tmp-${i}` })),
      customer,
      vehicle,
      vehicleOverride: body.vehicle_details_override || {},
      company: comp,
      branch: br[0] || {},
      preparedByName: req.user.name || req.user.email,
      logo_url: comp.logo_url,
      signature_url: comp.signature_url,
    };

    const html = buildQuotationHtml(bundle);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('previewQuotationHtmlFromBody:', err);
    res.status(500).json({
      error: 'Quotation preview could not be generated.',
      details: process.env.NODE_ENV === 'development' ? String(err.message) : undefined,
    });
  }
}

module.exports = {
  createQuotation,
  listQuotations,
  getQuotation,
  updateQuotation,
  sendQuotation,
  acceptQuotation,
  rejectQuotation,
  deleteQuotation,
  duplicateQuotation,
  convertToInvoice,
  getQuotationPdf,
  getQuotationPreviewHtml,
  previewQuotationHtmlFromBody,
  loadQuotationBundle,
  buildQuotationHtml,
};
