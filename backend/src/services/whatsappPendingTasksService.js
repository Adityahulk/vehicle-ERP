const { query } = require('../config/db');

/**
 * @param {object} p
 * @param {string} p.companyId
 * @param {string|null} p.branchId
 * @param {string} p.loanId
 * @param {'loan_overdue'|'loan_due_soon'|'loan_penalty_alert'} p.messageType
 * @param {string} p.title
 * @param {string} [p.detail]
 * @param {string} [p.customerName]
 * @param {string} [p.customerPhone]
 * @param {object} [p.meta]
 */
async function insertPendingTask(p) {
  const {
    companyId,
    branchId,
    loanId,
    messageType,
    title,
    detail = null,
    customerName = null,
    customerPhone = null,
    meta = {},
  } = p;

  if (messageType === 'loan_overdue' || messageType === 'loan_due_soon') {
    await query(
      `DELETE FROM whatsapp_pending_tasks
       WHERE loan_id = $1 AND message_type = $2 AND dismissed_at IS NULL`,
      [loanId, messageType],
    );
  }

  const { rows } = await query(
    `INSERT INTO whatsapp_pending_tasks (
       company_id, branch_id, loan_id, message_type, title, detail,
       customer_name, customer_phone, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     RETURNING *`,
    [
      companyId,
      branchId || null,
      loanId,
      messageType,
      title,
      detail,
      customerName,
      customerPhone,
      JSON.stringify(meta || {}),
    ],
  );
  return rows[0];
}

/**
 * @param {Array<{ loanId: string, companyId: string, reason?: string, penaltyDays?: number, thresholdPaise?: number }>} milestones
 */
async function insertPenaltyMilestoneTasks(milestones) {
  if (!milestones?.length) return { inserted: 0 };

  let inserted = 0;
  for (const m of milestones) {
    const { rows } = await query(
      `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
              i.branch_id, v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number,
              b.phone AS branch_phone, co.name AS company_name
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
       LEFT JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN branches b ON b.id = i.branch_id
       JOIN companies co ON co.id = l.company_id
       WHERE l.id = $1 AND l.is_deleted = FALSE`,
      [m.loanId],
    );
    if (rows.length === 0) continue;
    const loan = rows[0];
    if (!loan.customer_phone || !String(loan.customer_phone).trim()) continue;

    let detail = m.reason || 'penalty_milestone';
    if (m.reason === 'first_penalty_day') detail = 'First penalty day';
    else if (m.reason === 'every_7_days') detail = `${m.penaltyDays || ''} days overdue (weekly)`;
    else if (m.reason === 'amount_threshold') detail = `Penalty crossed ₹${(Number(m.thresholdPaise || 0) / 100).toLocaleString('en-IN')}`;

    await insertPendingTask({
      companyId: loan.company_id,
      branchId: loan.branch_id,
      loanId: loan.id,
      messageType: 'loan_penalty_alert',
      title: `Penalty — ${loan.customer_name || 'Customer'}`,
      detail,
      customerName: loan.customer_name,
      customerPhone: loan.customer_phone,
      meta: m,
    });
    inserted += 1;
  }
  return { inserted };
}

async function listOpenTasksForUser(user) {
  const companyId = user.company_id;
  const role = user.role;
  const branchId = user.branch_id;

  const params = [companyId];
  let branchCond = '';
  if (role === 'branch_manager') {
    params.push(branchId);
    branchCond = ' AND (t.branch_id IS NULL OR t.branch_id = $2)';
  }

  const { rows } = await query(
    `SELECT t.*, l.status AS loan_status
     FROM whatsapp_pending_tasks t
     JOIN loans l ON l.id = t.loan_id AND l.is_deleted = FALSE
     WHERE t.company_id = $1 AND t.dismissed_at IS NULL
       ${branchCond}
     ORDER BY t.created_at DESC
     LIMIT 200`,
    params,
  );
  return rows;
}

async function getTaskForCompany(taskId, companyId) {
  const { rows } = await query(
    `SELECT * FROM whatsapp_pending_tasks
     WHERE id = $1 AND company_id = $2`,
    [taskId, companyId],
  );
  return rows[0] || null;
}

async function dismissTask(taskId, companyId) {
  const { rows } = await query(
    `UPDATE whatsapp_pending_tasks
     SET dismissed_at = NOW()
     WHERE id = $1 AND company_id = $2 AND dismissed_at IS NULL
     RETURNING *`,
    [taskId, companyId],
  );
  return rows[0] || null;
}

module.exports = {
  insertPendingTask,
  insertPenaltyMilestoneTasks,
  listOpenTasksForUser,
  getTaskForCompany,
  dismissTask,
};
