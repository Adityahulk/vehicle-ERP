const { query } = require('../config/db');

const CATEGORIES = [
  'Tea/Coffee', 'Electricity', 'Salary', 'Rent', 'Maintenance', 'Transport', 'Other',
];

async function createExpense(req, res) {
  const company_id = req.user.company_id;
  const branch_id = req.user.branch_id;
  const { category, description, amount, expense_date } = req.validated;

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Allowed: ${CATEGORIES.join(', ')}` });
  }

  const { rows } = await query(
    `INSERT INTO expenses (company_id, branch_id, category, description, amount, expense_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [company_id, branch_id, category, description || null, amount, expense_date, req.user.id],
  );

  res.status(201).json({ expense: rows[0] });
}

async function listExpenses(req, res) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  const { branch_id, category, date_from, date_to, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['e.company_id = $1', 'e.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  if (role === 'staff' || role === 'branch_manager') {
    conditions.push(`e.branch_id = $${idx++}`);
    params.push(userBranch);
  } else if (branch_id) {
    conditions.push(`e.branch_id = $${idx++}`);
    params.push(branch_id);
  }

  if (category) {
    conditions.push(`e.category = $${idx++}`);
    params.push(category);
  }

  if (date_from) {
    conditions.push(`e.expense_date >= $${idx++}`);
    params.push(date_from);
  }

  if (date_to) {
    conditions.push(`e.expense_date <= $${idx++}`);
    params.push(date_to);
  }

  const where = conditions.join(' AND ');

  const countResult = await query(`SELECT COUNT(*) FROM expenses e WHERE ${where}`, params);

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT e.*, u.name AS created_by_name, b.name AS branch_name
     FROM expenses e
     LEFT JOIN users u ON u.id = e.created_by
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE ${where}
     ORDER BY e.expense_date DESC, e.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  res.json({
    expenses: rows,
    total: parseInt(countResult.rows[0].count, 10),
    page: Number(page),
    limit: Number(limit),
  });
}

async function expenseSummary(req, res) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  const { date_from, date_to, branch_id } = req.query;

  const conditions = ['e.company_id = $1', 'e.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  if (role === 'staff' || role === 'branch_manager') {
    conditions.push(`e.branch_id = $${idx++}`);
    params.push(userBranch);
  } else if (branch_id) {
    conditions.push(`e.branch_id = $${idx++}`);
    params.push(branch_id);
  }

  if (date_from) {
    conditions.push(`e.expense_date >= $${idx++}`);
    params.push(date_from);
  }

  if (date_to) {
    conditions.push(`e.expense_date <= $${idx++}`);
    params.push(date_to);
  }

  const where = conditions.join(' AND ');

  const { rows } = await query(
    `SELECT e.category, SUM(e.amount)::bigint AS total, COUNT(*)::int AS count
     FROM expenses e
     WHERE ${where}
     GROUP BY e.category
     ORDER BY total DESC`,
    params,
  );

  const grandTotal = rows.reduce((s, r) => s + Number(r.total), 0);

  res.json({ summary: rows, grand_total: grandTotal, categories: CATEGORIES });
}

module.exports = { createExpense, listExpenses, expenseSummary, CATEGORIES };
