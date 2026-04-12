const { query, getClient } = require('../config/db');
const { logAudit } = require('../middleware/auditLog');
const { calculatePenalty, waivePenalty } = require('../services/penaltyService');

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
        tenure_months, emi_amount, disbursement_date, due_date, penalty_per_day,
        grace_period_days, penalty_cap, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active')
     RETURNING *`,
    [
      company_id, data.invoice_id, customerId, data.bank_name,
      data.loan_amount, data.interest_rate, data.tenure_months,
      emiAmount, data.disbursement_date, dueDate,
      data.penalty_per_day,
      data.grace_period_days,
      data.penalty_cap ?? 0,
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

async function getLoanPenalty(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    const { role, branch_id: userBranch } = req.user;

    const { rows } = await query(
      `SELECT l.*,
              c.name AS customer_name, c.phone AS customer_phone,
              i.branch_id
       FROM loans l
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN invoices i ON i.id = l.invoice_id
       WHERE l.id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE`,
      [id, company_id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Loan not found' });
    const loan = rows[0];
    if (role === 'staff' || role === 'branch_manager') {
      if (String(loan.branch_id) !== String(userBranch)) {
        return res.status(403).json({ error: 'Not allowed for this branch' });
      }
    }

    const calc = calculatePenalty(loan, new Date());
    const { rows: hist } = await query(
      `SELECT calc_date, overdue_days, penalty_per_day, penalty_added, running_total
       FROM loan_penalty_log
       WHERE loan_id = $1
       ORDER BY calc_date DESC, created_at DESC
       LIMIT 30`,
      [id],
    );

    let waiver = null;
    if (Number(loan.penalty_waived || 0) > 0) {
      let waivedByName = null;
      if (loan.penalty_waived_by) {
        const u = await query(`SELECT name FROM users WHERE id = $1`, [loan.penalty_waived_by]);
        waivedByName = u.rows[0]?.name || null;
      }
      waiver = {
        waived_amount: Number(loan.penalty_waived),
        waived_by: waivedByName,
        waived_at: loan.penalty_waived_at,
        note: loan.penalty_waive_note,
      };
    }

    res.json({
      current: {
        overdueDays: calc.overdueDays,
        penaltyPerDay: calc.penaltyPerDay,
        totalPenalty: calc.totalPenalty,
        cappedPenalty: calc.cappedPenalty,
        netPenalty: calc.netPenalty,
        isOverdue: calc.isOverdue,
        gracePeriodActive: calc.gracePeriodActive,
        calendarDaysPastDue: calc.calendarDaysPastDue,
        penaltyStartDate: calc.penaltyStartDate,
        penaltyFirstAccrualDate: calc.penaltyFirstAccrualDate,
      },
      history: hist,
      waiver,
    });
  } catch (err) {
    console.error('getLoanPenalty:', err.message);
    res.status(500).json({ error: 'Failed to load penalty details' });
  }
}

async function waiveLoanPenalty(req, res) {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    const { amount, note } = req.body;

    if (!note || String(note).trim().length < 10) {
      return res.status(400).json({ error: 'Note is required (at least 10 characters)' });
    }
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive integer (paise)' });
    }

    let loanRow;
    try {
      loanRow = await waivePenalty(id, amt, String(note).trim(), req.user.id, company_id);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code !== 500) return res.status(code).json({ error: e.message });
      throw e;
    }

    logAudit({
      companyId: company_id,
      userId: req.user.id,
      action: 'update',
      entity: 'loan_penalty_waiver',
      entityId: id,
      newValue: { amount_paise: amt, note: String(note).trim() },
      req,
    });

    const { rows: full } = await query(
      `SELECT l.*,
              c.name AS customer_name, c.phone AS customer_phone,
              i.invoice_number, b.name AS branch_name
       FROM loans l
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE l.id = $1`,
      [id],
    );

    res.json({ loan: full[0] || loanRow });
  } catch (err) {
    console.error('waiveLoanPenalty:', err.message);
    res.status(500).json({ error: 'Failed to waive penalty' });
  }
}

async function penaltySummary(req, res) {
  try {
    const company_id = req.user.company_id;

    const { rows: aggOverdue } = await query(
      `SELECT
         COUNT(*)::int AS total_overdue_loans,
         COALESCE(SUM(GREATEST(l.total_penalty_accrued - COALESCE(l.penalty_waived, 0), 0)), 0)::bigint AS total_penalty_outstanding
       FROM loans l
       WHERE l.company_id = $1 AND l.is_deleted = FALSE
         AND l.due_date IS NOT NULL AND l.due_date < CURRENT_DATE
         AND l.status IN ('active', 'overdue')`,
      [company_id],
    );

    const { rows: aggWaived } = await query(
      `SELECT COALESCE(SUM(COALESCE(l.penalty_waived, 0)), 0)::bigint AS total_waived
       FROM loans l
       WHERE l.company_id = $1 AND l.is_deleted = FALSE`,
      [company_id],
    );

    const { rows: byBranch } = await query(
      `SELECT b.name AS branch_name,
              COUNT(*)::int AS overdue_count,
              COALESCE(SUM(GREATEST(l.total_penalty_accrued - COALESCE(l.penalty_waived, 0), 0)), 0)::bigint AS total_penalty
       FROM loans l
       LEFT JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE l.company_id = $1 AND l.is_deleted = FALSE
         AND l.due_date IS NOT NULL AND l.due_date < CURRENT_DATE
         AND l.status IN ('active', 'overdue')
       GROUP BY b.id, b.name
       ORDER BY b.name NULLS LAST`,
      [company_id],
    );

    res.json({
      total_overdue_loans: aggOverdue[0]?.total_overdue_loans ?? 0,
      total_penalty_outstanding: Number(aggOverdue[0]?.total_penalty_outstanding ?? 0),
      total_waived: Number(aggWaived[0]?.total_waived ?? 0),
      by_branch: byBranch.map((r) => ({
        branch_name: r.branch_name || '—',
        overdue_count: r.overdue_count,
        total_penalty: Number(r.total_penalty),
      })),
    });
  } catch (err) {
    console.error('penaltySummary:', err.message);
    res.status(500).json({ error: 'Failed to load penalty summary' });
  }
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

module.exports = {
  createLoan,
  listLoans,
  getLoan,
  closeLoan,
  listOverdue,
  calculateEmi,
  getLoanPenalty,
  waiveLoanPenalty,
  penaltySummary,
};
