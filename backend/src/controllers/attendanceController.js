const { query } = require('../config/db');

async function clockIn(req, res) {
  try {
    const { id: user_id, company_id, branch_id } = req.user;
    const today = new Date().toISOString().split('T')[0];

    const existing = await query(
      `SELECT id, clock_in FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date = $3 AND is_deleted = FALSE`,
      [user_id, company_id, today],
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Already clocked in today',
        record: existing.rows[0],
      });
    }

    const { rows } = await query(
      `INSERT INTO attendance (company_id, branch_id, user_id, date, clock_in)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, date, clock_in`,
      [company_id, branch_id || null, user_id, today],
    );

    res.status(201).json({ attendance: rows[0] });
  } catch (err) {
    console.error('clockIn error:', err.message);
    res.status(500).json({ error: 'Failed to clock in' });
  }
}

async function clockOut(req, res) {
  try {
    const { id: user_id, company_id } = req.user;
    const today = new Date().toISOString().split('T')[0];

    const existing = await query(
      `SELECT id, clock_in, clock_out FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date = $3 AND is_deleted = FALSE`,
      [user_id, company_id, today],
    );

    if (existing.rows.length === 0) {
      return res.status(400).json({ error: 'No clock-in record found for today' });
    }

    if (existing.rows[0].clock_out) {
      return res.status(409).json({
        error: 'Already clocked out today',
        record: existing.rows[0],
      });
    }

    const { rows } = await query(
      `UPDATE attendance SET clock_out = NOW()
       WHERE id = $1 AND is_deleted = FALSE
       RETURNING id, date, clock_in, clock_out`,
      [existing.rows[0].id],
    );

    res.json({ attendance: rows[0] });
  } catch (err) {
    console.error('clockOut error:', err.message);
    res.status(500).json({ error: 'Failed to clock out' });
  }
}

async function myStatus(req, res) {
  try {
    const { id: user_id, company_id } = req.user;
    const today = new Date().toISOString().split('T')[0];

    const { rows } = await query(
      `SELECT id, date, clock_in, clock_out FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date = $3 AND is_deleted = FALSE`,
      [user_id, company_id, today],
    );

    res.json({ record: rows[0] || null });
  } catch (err) {
    console.error('myStatus error:', err.message);
    res.status(500).json({ error: 'Failed to get status' });
  }
}

async function todayByBranch(req, res) {
  try {
    const { company_id } = req.user;
    const { branchId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const branchCheck = await query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [branchId, company_id],
    );
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // All users in this branch
    const { rows: branchUsers } = await query(
      `SELECT u.id, u.name, u.role,
              a.clock_in, a.clock_out
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.date = $3 AND a.is_deleted = FALSE
       WHERE u.branch_id = $1 AND u.company_id = $2 AND u.is_deleted = FALSE AND u.is_active = TRUE
       ORDER BY a.clock_in ASC NULLS LAST, u.name`,
      [branchId, company_id, today],
    );

    const clocked_in = branchUsers.filter((u) => u.clock_in && !u.clock_out).length;
    const clocked_out = branchUsers.filter((u) => u.clock_in && u.clock_out).length;
    const absent = branchUsers.filter((u) => !u.clock_in).length;

    res.json({
      date: today,
      summary: { total: branchUsers.length, clocked_in, clocked_out, absent },
      users: branchUsers,
    });
  } catch (err) {
    console.error('todayByBranch error:', err.message);
    res.status(500).json({ error: 'Failed to load attendance' });
  }
}

async function report(req, res) {
  try {
    const { company_id } = req.user;
    const { from, to, user_id, branch_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const conditions = ['a.company_id = $1', 'a.is_deleted = FALSE', 'a.date >= $2', 'a.date <= $3'];
    const params = [company_id, from, to];
    let idx = 4;

    if (user_id) {
      conditions.push(`a.user_id = $${idx++}`);
      params.push(user_id);
    }
    if (branch_id) {
      conditions.push(`a.branch_id = $${idx++}`);
      params.push(branch_id);
    }

    const where = conditions.join(' AND ');

    const { rows } = await query(
      `SELECT a.id, a.date, a.clock_in, a.clock_out, a.notes,
              u.name AS user_name, u.role AS user_role,
              b.name AS branch_name,
              CASE WHEN a.clock_out IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.clock_out - a.clock_in)) / 3600.0, 2)
                ELSE NULL
              END AS hours_worked
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN branches b ON b.id = a.branch_id
       WHERE ${where}
       ORDER BY a.date DESC, u.name`,
      params,
    );

    res.json({ records: rows, period: { from, to } });
  } catch (err) {
    console.error('attendance report error:', err.message);
    res.status(500).json({ error: 'Failed to generate report' });
  }
}

module.exports = { clockIn, clockOut, myStatus, todayByBranch, report };
