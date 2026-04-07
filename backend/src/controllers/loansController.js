const { query, getClient } = require('../config/db');
const { logAudit } = require('../middleware/auditLog');

/**
 * Standard EMI formula: EMI = P × r × (1+r)^n / ((1+r)^n - 1)
 * P = principal, r = monthly interest rate, n = tenure months
 * Returns amount in paise
 */
function calculateEmi(principalPaise, annualRate, tenureMonths) {
  if (tenureMonths <= 0 || annualRate <= 0) return principalPaise;
  const principal = principalPaise;
  const r = annualRate / 12 / 100;
  const n = tenureMonths;
  const emi = Math.round(principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  return emi;
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

async function createLoan(req, res) {
  const company_id = req.user.company_id;
  const data = req.validated;

  // Verify invoice exists and belongs to company
  const invCheck = await query(
    `SELECT id, customer_id FROM invoices
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'confirmed'`,
    [data.invoice_id, company_id],
  );
  if (invCheck.rows.length === 0) {
    return res.status(400).json({ error: 'Confirmed invoice not found' });
  }

  const customerId = invCheck.rows[0].customer_id;
  const emiAmount = calculateEmi(data.loan_amount, data.interest_rate, data.tenure_months);
  const dueDate = addMonths(data.disbursement_date, data.tenure_months);

  const { rows } = await query(
    `INSERT INTO loans
       (company_id, invoice_id, customer_id, bank_name, loan_amount, interest_rate,
        tenure_months, emi_amount, disbursement_date, due_date, penalty_per_day, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')
     RETURNING *`,
    [
      company_id, data.invoice_id, customerId, data.bank_name,
      data.loan_amount, data.interest_rate, data.tenure_months,
      emiAmount, data.disbursement_date, dueDate,
      data.penalty_per_day || 0,
    ],
  );

  logAudit({ companyId: company_id, userId: req.user.id, action: 'create', entity: 'loan', entityId: rows[0].id, newValue: { bank_name: data.bank_name, loan_amount: data.loan_amount }, req });
  res.status(201).json({ loan: rows[0] });
}

async function listLoans(req, res) {
  const company_id = req.user.company_id;
  const { role, branch_id: userBranch } = req.user;
  const { status, overdue, branch_id, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['l.company_id = $1', 'l.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  // Branch scoping for lower roles
  if (role === 'staff' || role === 'branch_manager') {
    conditions.push(`i.branch_id = $${idx++}`);
    params.push(userBranch);
  } else if (branch_id) {
    conditions.push(`i.branch_id = $${idx++}`);
    params.push(branch_id);
  }

  if (status) {
    conditions.push(`l.status = $${idx++}`);
    params.push(status);
  }

  if (overdue === 'true') {
    conditions.push(`l.due_date < CURRENT_DATE AND l.status = 'active'`);
  }

  const where = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM loans l
     LEFT JOIN invoices i ON i.id = l.invoice_id
     WHERE ${where}`,
    params,
  );

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT l.*,
            c.name AS customer_name, c.phone AS customer_phone,
            v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number,
            i.invoice_number, b.name AS branch_name
     FROM loans l
     LEFT JOIN customers c ON c.id = l.customer_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN branches b ON b.id = i.branch_id
     WHERE ${where}
     ORDER BY l.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  res.json({
    loans: rows,
    total: parseInt(countResult.rows[0].count, 10),
    page: Number(page),
    limit: Number(limit),
  });
}

async function getLoan(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;

  const { rows } = await query(
    `SELECT l.*,
            c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
            v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number, v.engine_number,
            i.invoice_number, i.total AS invoice_total,
            b.name AS branch_name
     FROM loans l
     LEFT JOIN customers c ON c.id = l.customer_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN branches b ON b.id = i.branch_id
     WHERE l.id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE`,
    [id, company_id],
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Loan not found' });
  }

  res.json({ loan: rows[0] });
}

async function closeLoan(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;

  const { rows } = await query(
    `UPDATE loans SET status = 'closed'
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status != 'closed'
     RETURNING *`,
    [id, company_id],
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Loan not found or already closed' });
  }

  logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'loan', entityId: id, oldValue: { status: 'active' }, newValue: { status: 'closed' }, req });
  res.json({ loan: rows[0] });
}

async function listOverdue(req, res) {
  const company_id = req.user.company_id;

  const { rows } = await query(
    `SELECT l.*,
            c.name AS customer_name, c.phone AS customer_phone,
            v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number,
            i.invoice_number, b.name AS branch_name,
            (CURRENT_DATE - l.due_date) AS overdue_days
     FROM loans l
     LEFT JOIN customers c ON c.id = l.customer_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN branches b ON b.id = i.branch_id
     WHERE l.company_id = $1 AND l.is_deleted = FALSE
       AND l.status = 'active' AND l.due_date < CURRENT_DATE
     ORDER BY l.due_date ASC`,
    [company_id],
  );

  res.json({ loans: rows });
}

module.exports = { createLoan, listLoans, getLoan, closeLoan, listOverdue, calculateEmi };
