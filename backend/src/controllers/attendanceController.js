const { query } = require('../config/db');
const { istYmd } = require('../lib/istDate');

async function clockIn(req, res) {
  try {
    const { id: user_id, company_id, branch_id } = req.user;
    const today = istYmd();

    const existing = await query(
      `SELECT id, clock_in, clock_out, status FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date = $3::date AND is_deleted = FALSE`,
      [user_id, company_id, today],
    );

    if (existing.rows.length > 0) {
      const ex = existing.rows[0];
      if (ex.status === 'on_leave') {
        return res.status(409).json({ error: 'You are marked on leave for today' });
      }
      if (ex.clock_in && !ex.clock_out) {
        return res.status(409).json({
          error: 'Already clocked in today',
          record: ex,
        });
      }
      if (ex.clock_in && ex.clock_out) {
        return res.status(409).json({
          error: 'Attendance for today is already complete',
          record: ex,
        });
      }
    }

    const { rows: openRows } = await query(
      `SELECT id, date FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND is_deleted = FALSE
         AND clock_in IS NOT NULL AND clock_out IS NULL
         AND (status IS NULL OR status <> 'on_leave')
         AND clock_in > NOW() - INTERVAL '48 hours'
       LIMIT 1`,
      [user_id, company_id],
    );
    if (openRows.length > 0) {
      return res.status(409).json({
        error: 'You still have an open clock-in. Please clock out first.',
        record: openRows[0],
      });
    }

    const { rows } = await query(
      `INSERT INTO attendance (company_id, branch_id, user_id, date, clock_in)
       VALUES ($1, $2, $3, $4::date, NOW())
       RETURNING id, date, clock_in, clock_out, status`,
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
    const today = istYmd();

    const byToday = await query(
      `SELECT id, clock_in, clock_out, status FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date = $3::date AND is_deleted = FALSE`,
      [user_id, company_id, today],
    );

    let row = null;
    if (byToday.rows.length > 0) {
      const r = byToday.rows[0];
      if (r.status === 'on_leave') {
        return res.status(400).json({ error: 'Cannot clock out while on leave' });
      }
      if (r.clock_in && !r.clock_out) {
        row = r;
      }
    }

    if (!row) {
      const { rows: openRows } = await query(
        `SELECT id, clock_in, clock_out, status FROM attendance
         WHERE user_id = $1 AND company_id = $2 AND is_deleted = FALSE
           AND clock_in IS NOT NULL AND clock_out IS NULL
           AND (status IS NULL OR status <> 'on_leave')
           AND clock_in > NOW() - INTERVAL '48 hours'
         ORDER BY clock_in DESC
         LIMIT 1`,
        [user_id, company_id],
      );
      if (openRows.length > 0) {
        row = openRows[0];
      }
    }

    if (!row) {
      return res.status(400).json({ error: 'No clock-in record found for today' });
    }

    if (row.clock_out) {
      return res.status(409).json({
        error: 'Already clocked out today',
        record: row,
      });
    }

    const { rows } = await query(
      `UPDATE attendance SET clock_out = NOW()
       WHERE id = $1 AND is_deleted = FALSE
       RETURNING id, date, clock_in, clock_out, status`,
      [row.id],
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
    const today = istYmd();

    let { rows } = await query(
      `SELECT id, date, clock_in, clock_out, status, notes FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date = $3::date AND is_deleted = FALSE`,
      [user_id, company_id, today],
    );

    if (!rows[0]) {
      const { rows: openRows } = await query(
        `SELECT id, date, clock_in, clock_out, status, notes FROM attendance
         WHERE user_id = $1 AND company_id = $2 AND is_deleted = FALSE
           AND clock_in IS NOT NULL AND clock_out IS NULL
           AND (status IS NULL OR status <> 'on_leave')
           AND clock_in > NOW() - INTERVAL '48 hours'
         ORDER BY clock_in DESC
         LIMIT 1`,
        [user_id, company_id],
      );
      if (openRows.length > 0) {
        rows = openRows;
      }
    }

    let hours_today = null;
    if (rows[0]?.clock_in && rows[0]?.clock_out) {
      const h = await query(
        `SELECT ROUND(EXTRACT(EPOCH FROM ($1::timestamptz - $2::timestamptz)) / 3600.0, 2) AS h`,
        [rows[0].clock_out, rows[0].clock_in],
      );
      hours_today = h.rows[0]?.h != null ? Number(h.rows[0].h) : null;
    }

    res.json({ record: rows[0] || null, hours_today });
  } catch (err) {
    console.error('myStatus error:', err.message);
    res.status(500).json({ error: 'Failed to get status' });
  }
}

const VISIBLE_ROLES = {
  super_admin: ['super_admin', 'company_admin', 'branch_manager', 'staff'],
  company_admin: ['company_admin', 'branch_manager', 'staff'],
  branch_manager: ['staff', 'branch_manager'],
  staff: [],
};

function workStatusForTodayRow(u) {
  const hasRow = u && (u.clock_in != null || u.clock_out != null || u.status != null);
  if (!hasRow) return 'not_clocked';
  if (u.status === 'on_leave') return 'on_leave';
  if (u.clock_in && u.clock_out) return 'present';
  if (u.clock_in) return 'working';
  return 'absent';
}

async function todayByBranch(req, res) {
  try {
    const { company_id, role: callerRole, id: callerId } = req.user;
    const { branchId } = req.params;
    const today = istYmd();

    const branchCheck = await query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [branchId, company_id],
    );
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    if (callerRole === 'staff') {
      const { rows } = await query(
        `SELECT u.id, u.name, u.role, a.clock_in, a.clock_out, a.status, a.date
         FROM users u
         LEFT JOIN attendance a ON a.user_id = u.id AND a.date = $3::date AND a.is_deleted = FALSE
         WHERE u.id = $1 AND u.company_id = $2 AND u.is_deleted = FALSE`,
        [callerId, company_id, today],
      );
      const withStatus = rows.map((u) => ({
        ...u,
        work_status: workStatusForTodayRow(u),
      }));
      return res.json({
        date: today,
        summary: {
          total: rows.length,
          clocked_in: rows.filter((u) => u.clock_in && !u.clock_out).length,
          clocked_out: rows.filter((u) => u.clock_in && u.clock_out).length,
          absent: rows.filter((u) => u.work_status === 'absent').length,
          on_leave: rows.filter((u) => u.status === 'on_leave').length,
        },
        users: withStatus,
      });
    }

    const allowedRoles = VISIBLE_ROLES[callerRole] || [];

    const { rows: branchUsers } = await query(
      `SELECT u.id, u.name, u.role,
              a.clock_in, a.clock_out, a.status, a.date, a.id AS attendance_id
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.date = $3::date AND a.is_deleted = FALSE
       WHERE u.branch_id = $1 AND u.company_id = $2 AND u.is_deleted = FALSE AND u.is_active = TRUE
         AND u.role = ANY($4)
       ORDER BY a.clock_in ASC NULLS LAST, u.name`,
      [branchId, company_id, today, allowedRoles],
    );

    const users = branchUsers.map((u) => ({
      ...u,
      work_status: workStatusForTodayRow(u),
    }));

    const clocked_in = users.filter((u) => u.clock_in && !u.clock_out).length;
    const clocked_out = users.filter((u) => u.clock_in && u.clock_out).length;
    const on_leave = users.filter((u) => u.work_status === 'on_leave').length;
    const absent = users.filter((u) => u.work_status === 'absent').length;
    const not_clocked = users.filter((u) => u.work_status === 'not_clocked').length;

    res.json({
      date: today,
      summary: {
        total: users.length,
        clocked_in,
        clocked_out,
        on_leave,
        absent,
        not_clocked,
      },
      users,
    });
  } catch (err) {
    console.error('todayByBranch error:', err.message);
    res.status(500).json({ error: 'Failed to load attendance' });
  }
}

async function report(req, res) {
  try {
    const { company_id, role: callerRole, id: callerId } = req.user;
    const { from, to, user_id, branch_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const conditions = ['a.company_id = $1', 'a.is_deleted = FALSE', 'a.date >= $2', 'a.date <= $3'];
    const params = [company_id, from, to];
    let idx = 4;

    if (callerRole === 'staff') {
      conditions.push(`a.user_id = $${idx++}`);
      params.push(callerId);
    } else {
      const allowedRoles = VISIBLE_ROLES[callerRole] || [];
      conditions.push(`u.role = ANY($${idx++})`);
      params.push(allowedRoles);

      if (user_id) {
        conditions.push(`a.user_id = $${idx++}`);
        params.push(user_id);
      }
      if (branch_id) {
        conditions.push(`a.branch_id = $${idx++}`);
        params.push(branch_id);
      }
    }

    const where = conditions.join(' AND ');

    const { rows } = await query(
      `SELECT a.id, a.date, a.clock_in, a.clock_out, a.notes, a.status,
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

function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { first, last };
}

/** GET /my?month=&year= — own calendar month */
async function myMonthly(req, res) {
  try {
    const { id: userId, company_id: companyId } = req.user;
    const now = new Date();
    const year = req.query.year != null ? Number(req.query.year) : now.getFullYear();
    const month = req.query.month != null ? Number(req.query.month) : now.getMonth() + 1;
    if (month < 1 || month > 12) return res.status(400).json({ error: 'Invalid month' });

    const { first, last } = monthBounds(year, month);
    const todayStr = istYmd();

    const { rows } = await query(
      `SELECT a.date, a.clock_in, a.clock_out, a.status, a.notes,
              CASE WHEN a.clock_out IS NOT NULL AND a.clock_in IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.clock_out - a.clock_in)) / 3600.0, 2)
                ELSE NULL
              END AS hours_worked
       FROM attendance a
       WHERE a.user_id = $1 AND a.company_id = $2 AND a.is_deleted = FALSE
         AND a.date >= $3::date AND a.date <= $4::date
       ORDER BY a.date`,
      [userId, companyId, first, last],
    );

    const byDate = {};
    for (const r of rows) {
      const ds = typeof r.date === 'string' ? r.date.slice(0, 10) : r.date.toISOString().slice(0, 10);
      byDate[ds] = r;
    }

    const y = Number(year);
    const m = Number(month);
    const lastDay = new Date(y, m, 0).getDate();
    let present = 0;
    let absent = 0;
    let onLeave = 0;
    for (let d = 1; d <= lastDay; d += 1) {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 0) continue;
      if (ds > todayStr) continue;
      const rec = byDate[ds];
      if (rec?.status === 'on_leave') onLeave += 1;
      else if (rec?.clock_in) present += 1;
      else if (ds < todayStr) absent += 1;
    }

    const hoursSum = rows.reduce((acc, r) => acc + (Number(r.hours_worked) || 0), 0);

    res.json({
      year,
      month,
      days: rows,
      summary: {
        present,
        absent,
        on_leave: onLeave,
        hours_month: Math.round(hoursSum * 100) / 100,
      },
    });
  } catch (err) {
    console.error('myMonthly error:', err.message);
    res.status(500).json({ error: 'Failed to load monthly attendance' });
  }
}

/** GET /branch/:branchId?month=&year= */
async function branchMonthly(req, res) {
  try {
    const { company_id: companyId, role: callerRole, branch_id: myBranch } = req.user;
    const { branchId } = req.params;

    if (!['branch_manager', 'company_admin', 'super_admin'].includes(callerRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (callerRole === 'branch_manager' && branchId !== myBranch) {
      return res.status(403).json({ error: 'Not your branch' });
    }

    const branchCheck = await query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [branchId, companyId],
    );
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const now = new Date();
    const year = req.query.year != null ? Number(req.query.year) : now.getFullYear();
    const month = req.query.month != null ? Number(req.query.month) : now.getMonth() + 1;
    if (month < 1 || month > 12) return res.status(400).json({ error: 'Invalid month' });

    const { first, last } = monthBounds(year, month);
    const allowedRoles = VISIBLE_ROLES[callerRole] || [];

    const { rows: staffRows } = await query(
      `SELECT u.id, u.name, u.role FROM users u
       WHERE u.branch_id = $1 AND u.company_id = $2 AND u.is_deleted = FALSE AND u.is_active = TRUE
         AND u.role = ANY($3)
       ORDER BY u.name`,
      [branchId, companyId, allowedRoles],
    );

    const { rows: attRows } = await query(
      `SELECT a.user_id, a.date, a.clock_in, a.clock_out, a.status,
              CASE WHEN a.clock_out IS NOT NULL AND a.clock_in IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.clock_out - a.clock_in)) / 3600.0, 2)
                ELSE NULL
              END AS hours_worked
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.company_id = $1 AND a.branch_id = $2 AND a.is_deleted = FALSE
         AND a.date >= $3::date AND a.date <= $4::date
         AND u.role = ANY($5)`,
      [companyId, branchId, first, last, allowedRoles],
    );

    const byUser = {};
    for (const r of attRows) {
      const uid = r.user_id;
      const ds = typeof r.date === 'string' ? r.date.slice(0, 10) : r.date.toISOString().slice(0, 10);
      if (!byUser[uid]) byUser[uid] = {};
      byUser[uid][ds] = r;
    }

    res.json({
      year,
      month,
      first,
      last,
      users: staffRows,
      attendanceByUser: byUser,
    });
  } catch (err) {
    console.error('branchMonthly error:', err.message);
    res.status(500).json({ error: 'Failed to load branch monthly attendance' });
  }
}

/** POST /regularize — manager+ */
async function regularize(req, res) {
  try {
    const { company_id: companyId, role, branch_id: myBranch, id: reviewerId } = req.user;
    const { user_id: targetUserId, date: dateStr, clock_in: clockIn, clock_out: clockOut, note } = req.body;

    if (!['branch_manager', 'company_admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (!targetUserId || !dateStr) {
      return res.status(400).json({ error: 'user_id and date are required' });
    }
    if (!clockIn && !clockOut) {
      return res.status(400).json({ error: 'Provide clock_in and/or clock_out' });
    }

    const { rows: targetRows } = await query(
      `SELECT id, branch_id, company_id, role FROM users
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [targetUserId, companyId],
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = targetRows[0];

    if (role === 'branch_manager' && target.branch_id !== myBranch) {
      return res.status(403).json({ error: 'User is not in your branch' });
    }

    const allowedTargets = VISIBLE_ROLES[role] || [];
    if (!allowedTargets.includes(target.role)) {
      return res.status(403).json({ error: 'Cannot regularize this user role' });
    }

    const clockInTs = clockIn || null;
    const clockOutTs = clockOut || null;

    const { rows: existing } = await query(
      `SELECT id FROM attendance
       WHERE user_id = $1 AND company_id = $2 AND date = $3::date AND is_deleted = FALSE`,
      [targetUserId, companyId, dateStr],
    );

    let row;
    if (existing.length === 0) {
      const ins = await query(
        `INSERT INTO attendance (company_id, branch_id, user_id, date, clock_in, clock_out, notes, status)
         VALUES ($1, $2, $3, $4::date, $5::timestamptz, $6::timestamptz, $7, NULL)
         RETURNING *`,
        [companyId, target.branch_id || null, targetUserId, dateStr, clockInTs, clockOutTs, note || null],
      );
      row = ins.rows[0];
    } else {
      const sets = ['updated_at = NOW()'];
      const params = [];
      let i = 1;
      if (clockInTs != null) {
        sets.push(`clock_in = $${i++}`);
        params.push(clockInTs);
      }
      if (clockOutTs != null) {
        sets.push(`clock_out = $${i++}`);
        params.push(clockOutTs);
      }
      if (note != null) {
        sets.push(`notes = $${i++}`);
        params.push(note);
      }
      sets.push(`status = NULL`);
      params.push(existing[0].id);
      const { rows: upd } = await query(
        `UPDATE attendance SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params,
      );
      row = upd.rows[0];
    }

    await query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity, entity_id, new_value)
       VALUES ($1, $2, 'update', 'attendance', $3, $4)`,
      [
        companyId,
        reviewerId,
        row.id,
        JSON.stringify({ regularize: true, target_user_id: targetUserId, date: dateStr, clock_in: clockInTs, clock_out: clockOutTs }),
      ],
    ).catch(() => {});

    res.json({ attendance: row });
  } catch (err) {
    console.error('regularize error:', err.message);
    res.status(500).json({ error: 'Failed to regularize attendance' });
  }
}

module.exports = {
  clockIn,
  clockOut,
  myStatus,
  todayByBranch,
  report,
  myMonthly,
  branchMonthly,
  regularize,
};
