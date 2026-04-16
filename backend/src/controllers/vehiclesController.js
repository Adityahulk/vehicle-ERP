const { query, getClient } = require('../config/db');
const { ROLE_HIERARCHY } = require('../middleware/role');
const { logAudit } = require('../middleware/auditLog');
const { generateBarcodeBuffer, generateQRCodeBuffer, generateVehicleLabelHTML, generateBatchLabelsHTML } = require('../services/barcodeService');
const { htmlToPdfBuffer } = require('../services/pdfService');

async function listVehicles(req, res) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  const { branch_id, status, search, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['v.company_id = $1', 'v.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  // staff and branch_manager scoped to their branch
  if (role === 'staff' || role === 'branch_manager') {
    conditions.push(`v.branch_id = $${idx++}`);
    params.push(userBranch);
  } else if (branch_id) {
    conditions.push(`v.branch_id = $${idx++}`);
    params.push(branch_id);
  }

  if (status) {
    conditions.push(`v.status = $${idx++}`);
    params.push(status);
  }

  if (search) {
    conditions.push(
      `(v.chassis_number ILIKE $${idx} OR v.engine_number ILIKE $${idx} OR v.make ILIKE $${idx} OR v.model ILIKE $${idx})`,
    );
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM vehicles v WHERE ${where}`,
    params,
  );

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT v.*, b.name AS branch_name
     FROM vehicles v
     LEFT JOIN branches b ON b.id = v.branch_id
     WHERE ${where}
     ORDER BY v.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  res.json({
    vehicles: rows,
    total: parseInt(countResult.rows[0].count, 10),
    page: Number(page),
    limit: Number(limit),
  });
}

async function createVehicle(req, res) {
  const company_id = req.user.company_id;
  const data = req.validated;

  // staff can only add to their own branch
  const callerLevel = ROLE_HIERARCHY[req.user.role] || 0;
  let branch_id = data.branch_id;
  if (callerLevel < ROLE_HIERARCHY.branch_manager) {
    branch_id = req.user.branch_id;
  }
  if (!branch_id) {
    return res.status(400).json({ error: 'branch_id is required' });
  }

  // validate branch belongs to company
  const branchCheck = await query(
    `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [branch_id, company_id],
  );
  if (branchCheck.rows.length === 0) {
    return res.status(400).json({ error: 'Invalid branch' });
  }

  // chassis uniqueness within company
  const dup = await query(
    `SELECT id FROM vehicles WHERE chassis_number = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [data.chassis_number, company_id],
  );
  if (dup.rows.length > 0) {
    return res.status(409).json({ error: 'A vehicle with this chassis number already exists' });
  }

  const { rows } = await query(
    `INSERT INTO vehicles
       (company_id, branch_id, chassis_number, engine_number, make, model, variant,
        color, year, purchase_price, selling_price, status,
        rto_number, rto_date, insurance_company, insurance_expiry, insurance_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      company_id, branch_id, data.chassis_number, data.engine_number,
      data.make || null, data.model || null, data.variant || null,
      data.color || null, data.year || null,
      data.purchase_price || 0, data.selling_price || 0,
      data.status || 'in_stock',
      data.rto_number || null, data.rto_date || null,
      data.insurance_company || null, data.insurance_expiry || null,
      data.insurance_number || null,
    ],
  );

  logAudit({ companyId: company_id, userId: req.user.id, action: 'create', entity: 'vehicle', entityId: rows[0].id, newValue: rows[0], req });
  res.status(201).json({ vehicle: rows[0] });
}

async function getVehicle(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    const { rows } = await query(
      `SELECT v.*, b.name AS branch_name
       FROM vehicles v
       LEFT JOIN branches b ON b.id = v.branch_id
       WHERE v.id = $1 AND v.company_id = $2 AND v.is_deleted = FALSE`,
      [id, company_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // transfer history
    const transfers = await query(
      `SELECT vt.id, vt.transferred_at, vt.notes,
              fb.name AS from_branch_name, tb.name AS to_branch_name,
              u.name AS transferred_by_name
       FROM vehicle_transfers vt
       LEFT JOIN branches fb ON fb.id = vt.from_branch_id
       LEFT JOIN branches tb ON tb.id = vt.to_branch_id
       LEFT JOIN users u ON u.id = vt.transferred_by
       WHERE vt.vehicle_id = $1 AND vt.company_id = $2 AND vt.is_deleted = FALSE
       ORDER BY vt.transferred_at DESC`,
      [id, company_id],
    );

    // loan info via invoices
    const loans = await query(
      `SELECT l.id, l.bank_name, l.loan_amount, l.emi_amount, l.due_date,
              l.status, l.total_penalty_accrued, l.penalty_waived, l.interest_rate, l.tenure_months,
              l.penalty_per_day, l.grace_period_days, l.last_reminder_sent, l.invoice_id,
              c.name AS customer_name, c.phone AS customer_phone
       FROM loans l
       INNER JOIN invoices i ON i.id = l.invoice_id AND i.company_id = l.company_id
       LEFT JOIN customers c ON c.id = l.customer_id AND c.company_id = l.company_id
       WHERE i.vehicle_id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE
       ORDER BY l.created_at DESC`,
      [id, company_id],
    );

    // invoice info for the vehicle
    const invoices = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total, i.status,
              c.name AS customer_name
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.vehicle_id = $1 AND i.company_id = $2 AND i.is_deleted = FALSE
       ORDER BY i.created_at DESC`,
      [id, company_id],
    );

    res.json({
      vehicle: rows[0],
      transfers: transfers.rows,
      loans: loans.rows,
      invoices: invoices.rows,
    });
  } catch (err) {
    console.error('getVehicle error:', err.message);
    res.status(500).json({ error: 'Failed to fetch vehicle' });
  }
}

async function searchVehicles(req, res) {
  try {
    const company_id = req.user.company_id;
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({ vehicles: [] });
    }

    const { rows } = await query(
      `SELECT id, chassis_number, engine_number, make, model, variant, color, year, status,
              selling_price, branch_id
       FROM vehicles
       WHERE company_id = $1 AND is_deleted = FALSE
         AND (chassis_number ILIKE $2 OR engine_number ILIKE $2 OR make ILIKE $2 OR model ILIKE $2)
       ORDER BY created_at DESC
       LIMIT 20`,
      [company_id, `%${q}%`],
    );

    res.json({ vehicles: rows });
  } catch (err) {
    console.error('searchVehicles error:', err.message);
    res.status(500).json({ error: 'Failed to search vehicles' });
  }
}

async function expiringInsurance(req, res) {
  try {
    const company_id = req.user.company_id;
    const days = parseInt(req.query.days, 10) || 30;

    const { rows } = await query(
      `SELECT v.id, v.chassis_number, v.make, v.model, v.variant, v.color,
              v.insurance_company, v.insurance_number, v.insurance_expiry,
              v.status, b.name AS branch_name
       FROM vehicles v
       LEFT JOIN branches b ON b.id = v.branch_id
       WHERE v.company_id = $1 AND v.is_deleted = FALSE
         AND v.insurance_expiry IS NOT NULL
         AND v.insurance_expiry <= CURRENT_DATE + ($2 || ' days')::interval
       ORDER BY v.insurance_expiry ASC`,
      [company_id, String(days)],
    );

    res.json({ vehicles: rows, days });
  } catch (err) {
    console.error('expiringInsurance error:', err.message);
    res.status(500).json({ error: 'Failed to fetch expiring insurance' });
  }
}

async function updateVehicle(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const updates = req.validated;

  const existing = await query(
    `SELECT id FROM vehicles WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  if (updates.chassis_number) {
    const dup = await query(
      `SELECT id FROM vehicles WHERE chassis_number = $1 AND company_id = $2 AND id != $3 AND is_deleted = FALSE`,
      [updates.chassis_number, company_id, id],
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'A vehicle with this chassis number already exists' });
    }
  }

  if (updates.branch_id) {
    const branchCheck = await query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [updates.branch_id, company_id],
    );
    if (branchCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid branch' });
    }
  }

  const allowed = [
    'chassis_number', 'engine_number', 'make', 'model', 'variant', 'color', 'year',
    'purchase_price', 'selling_price', 'status', 'rto_number', 'rto_date',
    'insurance_company', 'insurance_expiry', 'insurance_number', 'branch_id',
  ];

  const setClauses = [];
  const params = [];
  let idx = 1;

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      setClauses.push(`${key} = $${idx++}`);
      params.push(updates[key]);
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  params.push(id, company_id);
  const { rows } = await query(
    `UPDATE vehicles SET ${setClauses.join(', ')}
     WHERE id = $${idx++} AND company_id = $${idx} AND is_deleted = FALSE
     RETURNING *`,
    params,
  );

  logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'vehicle', entityId: id, oldValue: { id }, newValue: rows[0], req });
  res.json({ vehicle: rows[0] });
}

async function transferVehicle(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const { to_branch_id, notes } = req.validated;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: vehicles } = await client.query(
      `SELECT id, branch_id, status FROM vehicles
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
       FOR UPDATE`,
      [id, company_id],
    );

    if (vehicles.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const vehicle = vehicles[0];

    if (vehicle.status !== 'in_stock') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only in_stock vehicles can be transferred' });
    }

    if (vehicle.branch_id === to_branch_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Vehicle is already at the target branch' });
    }

    // validate target branch
    const branchCheck = await client.query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [to_branch_id, company_id],
    );
    if (branchCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid target branch' });
    }

    // create transfer record
    const { rows: transfers } = await client.query(
      `INSERT INTO vehicle_transfers
         (company_id, vehicle_id, from_branch_id, to_branch_id, transferred_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [company_id, id, vehicle.branch_id, to_branch_id, req.user.id, notes || null],
    );

    // update vehicle branch
    await client.query(
      `UPDATE vehicles SET branch_id = $1, status = 'in_stock' WHERE id = $2`,
      [to_branch_id, id],
    );

    await client.query('COMMIT');

    logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'vehicle', entityId: id, oldValue: { branch_id: vehicle.branch_id }, newValue: { branch_id: to_branch_id, transfer_id: transfers[0].id }, req });
    res.json({ transfer: transfers[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function inventorySummary(req, res) {
  const company_id = req.user.company_id;

  const { rows } = await query(
    `SELECT b.id AS branch_id, b.name AS branch_name, v.status, COUNT(*)::int AS count
     FROM vehicles v
     JOIN branches b ON b.id = v.branch_id
     WHERE v.company_id = $1 AND v.is_deleted = FALSE AND b.is_deleted = FALSE
     GROUP BY b.id, b.name, v.status
     ORDER BY b.name, v.status`,
    [company_id],
  );

  // reshape into { branch_id, branch_name, in_stock, sold, transferred, scrapped, total }
  const branchMap = {};
  for (const row of rows) {
    if (!branchMap[row.branch_id]) {
      branchMap[row.branch_id] = {
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        in_stock: 0, sold: 0, transferred: 0, scrapped: 0, total: 0,
      };
    }
    branchMap[row.branch_id][row.status] = row.count;
    branchMap[row.branch_id].total += row.count;
  }

  res.json({ summary: Object.values(branchMap) });
}

async function branchInventory(req, res) {
  const company_id = req.user.company_id;
  const { branchId } = req.params;

  const branchCheck = await query(
    `SELECT id, name FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [branchId, company_id],
  );
  if (branchCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Branch not found' });
  }

  const { rows } = await query(
    `SELECT v.*, b.name AS branch_name
     FROM vehicles v
     LEFT JOIN branches b ON b.id = v.branch_id
     WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status = 'in_stock' AND v.is_deleted = FALSE
     ORDER BY v.created_at DESC`,
    [branchId, company_id],
  );

  res.json({ branch: branchCheck.rows[0], vehicles: rows });
}

async function checkChassisAvailable(req, res) {
  const chassis = String(req.query.chassis_number || '').trim();
  if (!chassis) return res.status(400).json({ error: 'chassis_number query parameter is required' });
  const { rows } = await query(
    `SELECT id FROM vehicles WHERE chassis_number = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [chassis, req.user.company_id],
  );
  res.json({ available: rows.length === 0 });
}

async function getBarcode(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    const { rows } = await query(`SELECT chassis_number FROM vehicles WHERE id = $1 AND company_id = $2`, [id, company_id]);
    if (!rows.length) return res.status(404).send('Not found');
    const buf = await generateBarcodeBuffer(rows[0].chassis_number);
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Error');
  }
}

async function getQRCode(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    const { rows } = await query(`SELECT chassis_number, make, model FROM vehicles WHERE id = $1 AND company_id = $2`, [id, company_id]);
    if (!rows.length) return res.status(404).send('Not found');
    const buf = await generateQRCodeBuffer(rows[0].chassis_number, rows[0].make, rows[0].model);
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Error');
  }
}

async function getVehicleLabelPdf(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    const { rows } = await query(`
      SELECT v.*, b.name as branch_name 
      FROM vehicles v 
      LEFT JOIN branches b ON b.id = v.branch_id 
      WHERE v.id = $1 AND v.company_id = $2`, [id, company_id]);
    if (!rows.length) return res.status(404).send('Not found');
    
    const { rows: co } = await query(`SELECT name FROM companies WHERE id = $1`, [company_id]);
    
    // We cannot use localhost links for images inside puppeteer reliably, 
    // it's better to render barcode to base64 and inject it for offline rendering.
    const barcodeBuf = await generateBarcodeBuffer(rows[0].chassis_number);
    const qrcodeBuf = await generateQRCodeBuffer(rows[0].chassis_number, rows[0].make, rows[0].model);
    
    const html = generateVehicleLabelHTML(rows[0], co[0], { name: rows[0].branch_name })
      .replace(`http://localhost:4000/api/vehicles/${id}/barcode`, `data:image/png;base64,${barcodeBuf.toString('base64')}`)
      .replace(`http://localhost:4000/api/vehicles/${id}/qrcode`, `data:image/png;base64,${qrcodeBuf.toString('base64')}`);
      
    const pdf = await htmlToPdfBuffer(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="label-${rows[0].chassis_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
}

async function batchBarcodesPdf(req, res) {
  try {
    const { ids } = req.query;
    if (!ids) return res.status(400).send('No ids provided');
    const idArray = ids.split(',');
    if (!idArray.length) return res.status(400).send('No ids provided');

    const company_id = req.user.company_id;
    const { rows } = await query(`
      SELECT v.*, b.name as branch_name 
      FROM vehicles v 
      LEFT JOIN branches b ON b.id = v.branch_id 
      WHERE v.id = ANY($1) AND v.company_id = $2`, [idArray, company_id]);
      
    if (!rows.length) return res.status(404).send('Not found');
    
    const { rows: co } = await query(`SELECT name FROM companies WHERE id = $1`, [company_id]);
    
    const htmls = [];
    for (const v of rows) {
      const barcodeBuf = await generateBarcodeBuffer(v.chassis_number);
      const qrcodeBuf = await generateQRCodeBuffer(v.chassis_number, v.make, v.model);
      
      const html = generateVehicleLabelHTML(v, co[0], { name: v.branch_name })
        .replace(`http://localhost:4000/api/vehicles/${v.id}/barcode`, `data:image/png;base64,${barcodeBuf.toString('base64')}`)
        .replace(`http://localhost:4000/api/vehicles/${v.id}/qrcode`, `data:image/png;base64,${qrcodeBuf.toString('base64')}`);
      htmls.push(html);
    }
    
    const batchHtml = generateBatchLabelsHTML(htmls);
    const pdf = await htmlToPdfBuffer(batchHtml);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="labels-batch.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
}

module.exports = {
  listVehicles, createVehicle, getVehicle, updateVehicle,
  transferVehicle, inventorySummary, branchInventory,
  searchVehicles, expiringInsurance, checkChassisAvailable,
  getBarcode,
  getQRCode,
  getVehicleLabelPdf,
  batchBarcodesPdf,
};
