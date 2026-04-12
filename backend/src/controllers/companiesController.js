const { query } = require('../config/db');
const { seedDefaultInvoiceTemplates } = require('./invoiceTemplateController');
const { seedDefaultLeaveTypes } = require('../services/leaveTypesService');
const { seedWhatsappTemplates } = require('../services/whatsappTemplatesSeed');

async function getCompany(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    if (id !== company_id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot view another company' });
    }

    const { rows } = await query(
      `SELECT id, name, gstin, address, phone, email, logo_url, signature_url,
              state_code, default_hsn_code, default_gst_rate,
              created_at, updated_at
       FROM companies WHERE id = $1 AND is_deleted = FALSE`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ company: rows[0] });
  } catch (err) {
    console.error('getCompany error:', err.message);
    res.status(500).json({ error: 'Failed to fetch company' });
  }
}

async function updateCompany(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    if (id !== company_id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot update another company' });
    }

    const allowed = [
      'name', 'gstin', 'address', 'phone', 'email',
      'state_code', 'default_hsn_code', 'default_gst_rate',
    ];

    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        setClauses.push(`${key} = $${idx++}`);
        params.push(req.body[key]);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    const { rows } = await query(
      `UPDATE companies SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, name, gstin, address, phone, email, logo_url, signature_url,
                 state_code, default_hsn_code, default_gst_rate, created_at, updated_at`,
      params,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ company: rows[0] });
  } catch (err) {
    console.error('updateCompany error:', err.message);
    res.status(500).json({ error: 'Failed to update company' });
  }
}

async function uploadLogo(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    if (id !== company_id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot update another company' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const logo_url = `/uploads/logos/${id}/${req.file.filename}`;
    const { rows } = await query(
      `UPDATE companies SET logo_url = $1 WHERE id = $2 AND is_deleted = FALSE
       RETURNING id, logo_url`,
      [logo_url, id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ logo_url: rows[0].logo_url });
  } catch (err) {
    console.error('uploadLogo error:', err.message);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
}

async function uploadSignature(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    if (id !== company_id && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot update another company' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const signature_url = `/uploads/signatures/${id}/${req.file.filename}`;
    const { rows } = await query(
      `UPDATE companies SET signature_url = $1 WHERE id = $2 AND is_deleted = FALSE
       RETURNING id, signature_url`,
      [signature_url, id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ signature_url: rows[0].signature_url });
  } catch (err) {
    console.error('uploadSignature error:', err.message);
    res.status(500).json({ error: 'Failed to upload signature' });
  }
}

async function createCompany(req, res) {
  try {
    const { name, gstin, address, phone, email } = req.body;

    const { rows } = await query(
      `INSERT INTO companies (name, gstin, address, phone, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, gstin, address, phone, email, created_at`,
      [name, gstin || null, address || null, phone || null, email || null],
    );

    const newId = rows[0].id;
    await seedDefaultInvoiceTemplates(newId);
    await seedDefaultLeaveTypes(newId);
    await seedWhatsappTemplates(newId);

    res.status(201).json({ company: rows[0] });
  } catch (err) {
    console.error('createCompany error:', err.message);
    res.status(500).json({ error: 'Failed to create company' });
  }
}

module.exports = { getCompany, updateCompany, uploadLogo, uploadSignature, createCompany };
