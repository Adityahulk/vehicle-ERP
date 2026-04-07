const { query } = require('../config/db');

async function createCustomer(req, res) {
  const company_id = req.user.company_id;
  const { name, phone, email, address, gstin } = req.validated;

  if (phone) {
    const dup = await query(
      `SELECT id FROM customers WHERE phone = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [phone, company_id],
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'A customer with this phone number already exists' });
    }
  }

  const { rows } = await query(
    `INSERT INTO customers (company_id, name, phone, email, address, gstin)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [company_id, name, phone || null, email || null, address || null, gstin || null],
  );

  res.status(201).json({ customer: rows[0] });
}

async function listCustomers(req, res) {
  const company_id = req.user.company_id;
  const { search, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['company_id = $1', 'is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  if (search) {
    conditions.push(`(name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await query(`SELECT COUNT(*) FROM customers WHERE ${where}`, params);

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT * FROM customers WHERE ${where} ORDER BY name LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  res.json({
    customers: rows,
    total: parseInt(countResult.rows[0].count, 10),
    page: Number(page),
    limit: Number(limit),
  });
}

async function getCustomer(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;

  const { rows } = await query(
    `SELECT * FROM customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json({ customer: rows[0] });
}

module.exports = { createCustomer, listCustomers, getCustomer };
