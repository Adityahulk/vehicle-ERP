const { query } = require('../config/db');

const DEFAULT_TYPES = [
  { code: 'CL', name: 'Casual Leave', days_per_year: 12, is_paid: true, carry_forward: false },
  { code: 'SL', name: 'Sick Leave', days_per_year: 6, is_paid: true, carry_forward: false },
  { code: 'EL', name: 'Earned Leave', days_per_year: 12, is_paid: true, carry_forward: true },
  { code: 'LWP', name: 'Leave Without Pay', days_per_year: 0, is_paid: false, carry_forward: false },
];

async function seedDefaultLeaveTypes(companyId, client = null) {
  const q = client ? client.query.bind(client) : query;
  for (const t of DEFAULT_TYPES) {
    await q(
      `INSERT INTO leave_types (company_id, name, code, days_per_year, is_paid, carry_forward)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId, t.name, t.code, t.days_per_year, t.is_paid, t.carry_forward],
    );
  }
}

async function getLeaveTypeById(leaveTypeId, companyId) {
  const { rows } = await query(
    `SELECT * FROM leave_types WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
    [leaveTypeId, companyId],
  );
  return rows[0] || null;
}

module.exports = { seedDefaultLeaveTypes, getLeaveTypeById, DEFAULT_TYPES };
