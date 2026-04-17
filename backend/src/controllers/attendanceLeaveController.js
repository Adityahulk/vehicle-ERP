const { query, getClient } = require('../config/db');
const { getLeaveTypeById, seedDefaultLeaveTypes } = require('../services/leaveTypesService');
const { sendSMS } = require('../services/notificationService');
const { istYmd, pgDateToYmd } = require('../lib/istDate');

function todayYmd() {
  return istYmd();
}

function rowDate(d) {
  return pgDateToYmd(d);
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Each calendar date string YYYY-MM-DD from fromStr to toStr inclusive */
function eachDateInclusive(fromStr, toStr) {
  const out = [];
  const cur = parseYmd(fromStr);
  const end = parseYmd(toStr);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Working days Mon–Sat (Sunday = 0 excluded) */
function workingDatesInRange(fromStr, toStr) {
  return eachDateInclusive(fromStr, toStr).filter((ds) => {
    const dow = parseYmd(ds).getUTCDay();
    return dow !== 0;
  });
}

function computeTotalDays(fromStr, toStr, halfDay) {
  const wd = workingDatesInRange(fromStr, toStr);
  if (halfDay) {
    if (fromStr !== toStr) return null;
    return wd.length > 0 ? 0.5 : 0;
  }
  return wd.length;
}

async function sumApprovedDaysForTypeYear(userId, leaveTypeId, year) {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const { rows } = await query(
    `SELECT COALESCE(SUM(la.total_days), 0)::numeric AS s
     FROM leave_applications la
     WHERE la.user_id = $1 AND la.leave_type_id = $2 AND la.status = 'approved'
       AND la.is_deleted = FALSE
       AND la.from_date <= $4::date AND la.to_date >= $3::date`,
    [userId, leaveTypeId, start, end],
  );
  return Number(rows[0]?.s || 0);
}

async function hasOverlappingLeave(userId, fromStr, toStr, excludeId = null) {
  const params = [userId, fromStr, toStr];
  let sql = `
    SELECT 1 FROM leave_applications la
    WHERE la.user_id = $1 AND la.is_deleted = FALSE
      AND la.status IN ('pending', 'approved')
      AND daterange(la.from_date, la.to_date, '[]') && daterange($2::date, $3::date, '[]')`;
  if (excludeId) {
    sql += ` AND la.id <> $4`;
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const { rows } = await query(sql, params);
  return rows.length > 0;
}

function isUnlimitedLeave(lt) {
  return lt.code === 'LWP' || Number(lt.days_per_year) === 0;
}

async function upsertOnLeaveDays({ companyId, branchId, userId, fromStr, toStr, client }) {
  const q = client ? client.query.bind(client) : query;
  const dates = workingDatesInRange(fromStr, toStr);
  for (const dateStr of dates) {
    await q(
      `INSERT INTO attendance (company_id, branch_id, user_id, date, status, clock_in, clock_out, is_deleted)
       VALUES ($1, $2, $3, $4::date, 'on_leave', NULL, NULL, FALSE)
       ON CONFLICT (user_id, date) WHERE is_deleted = FALSE
       DO UPDATE SET
         status = 'on_leave',
         company_id = EXCLUDED.company_id,
         branch_id = EXCLUDED.branch_id,
         clock_in = NULL,
         clock_out = NULL,
         updated_at = NOW()`,
      [companyId, branchId || null, userId, dateStr],
    );
  }
}

async function revertOnLeaveDays({ userId, fromStr, toStr, client }) {
  const q = client ? client.query.bind(client) : query;
  await q(
    `UPDATE attendance SET status = NULL, updated_at = NOW()
     WHERE user_id = $1 AND date >= $2::date AND date <= $3::date
       AND status = 'on_leave' AND is_deleted = FALSE`,
    [userId, fromStr, toStr],
  );
}

async function getBranchManagerForNotify(branchId, companyId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.phone
     FROM branches b
     JOIN users u ON u.id = b.manager_id AND u.is_deleted = FALSE
     WHERE b.id = $1 AND b.company_id = $2 AND b.is_deleted = FALSE`,
    [branchId, companyId],
  );
  return rows[0] || null;
}

async function leaveApply(req, res) {
  try {
    const { id: userId, company_id: companyId, branch_id: branchId } = req.user;
    const { leave_type_id: leaveTypeId, from_date: fromStr, to_date: toStr, reason, half_day: halfDay } = req.body;

    if (!leaveTypeId || !fromStr || !toStr || reason == null || String(reason).trim() === '') {
      return res.status(400).json({ error: 'leave_type_id, from_date, to_date, and reason are required' });
    }

    const today = todayYmd();
    if (fromStr < today) {
      return res.status(400).json({ error: 'from_date cannot be in the past' });
    }
    if (toStr < fromStr) {
      return res.status(400).json({ error: 'to_date must be on or after from_date' });
    }

    const lt = await getLeaveTypeById(leaveTypeId, companyId);
    if (!lt) return res.status(400).json({ error: 'Invalid leave type' });

    const totalDays = computeTotalDays(fromStr, toStr, !!halfDay);
    if (totalDays === null) {
      return res.status(400).json({ error: 'half_day is only allowed for a single-day application' });
    }
    if (totalDays <= 0) {
      return res.status(400).json({ error: 'No working days in the selected range' });
    }

    const overlap = await hasOverlappingLeave(userId, fromStr, toStr);
    if (overlap) {
      return res.status(409).json({ error: 'Overlaps existing pending or approved leave' });
    }

    if (!isUnlimitedLeave(lt)) {
      const year = parseInt(fromStr.slice(0, 4), 10);
      const used = await sumApprovedDaysForTypeYear(userId, leaveTypeId, year);
      const avail = Number(lt.days_per_year) - used;
      if (totalDays > avail + 1e-9) {
        return res.status(400).json({
          error: `Insufficient ${lt.code} balance (${avail.toFixed(1)} days available, ${totalDays} requested)`,
        });
      }
    }

    const { rows } = await query(
      `INSERT INTO leave_applications
         (company_id, branch_id, user_id, leave_type_id, from_date, to_date, total_days, half_day, reason, status)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, 'pending')
       RETURNING *`,
      [companyId, branchId || null, userId, leaveTypeId, fromStr, toStr, totalDays, !!halfDay, String(reason).trim()],
    );

    const app = rows[0];
    if (branchId) {
      const mgr = await getBranchManagerForNotify(branchId, companyId);
      if (mgr?.phone) {
        const msg =
          `[MVG ERP] Leave request from ${req.user.name || 'Staff'}: ${lt.name} ${fromStr} to ${toStr} (${totalDays} day(s)). Reason: ${String(reason).slice(0, 120)}`;
        await sendSMS(mgr.phone, msg).catch(() => {});
      }
    }

    res.status(201).json({ application: app });
  } catch (err) {
    console.error('leaveApply error:', err.message);
    res.status(500).json({ error: 'Failed to submit leave application' });
  }
}

async function leaveMy(req, res) {
  try {
    const { id: userId, company_id: companyId } = req.user;
    const year = Number(req.query.year) || new Date().getFullYear();

    let { rows: types } = await query(
      `SELECT id, name, code, days_per_year, is_paid FROM leave_types
       WHERE company_id = $1 AND is_active = TRUE ORDER BY code`,
      [companyId],
    );

    if (types.length === 0) {
      await seedDefaultLeaveTypes(companyId);
      const again = await query(
        `SELECT id, name, code, days_per_year, is_paid FROM leave_types
         WHERE company_id = $1 AND is_active = TRUE ORDER BY code`,
        [companyId],
      );
      types = again.rows;
    }

    const balances = [];
    for (const t of types) {
      const used = await sumApprovedDaysForTypeYear(userId, t.id, year);
      const unlimited = t.code === 'LWP' || Number(t.days_per_year) === 0;
      const available = unlimited ? null : Number(t.days_per_year) - used;
      balances.push({
        leave_type_id: t.id,
        code: t.code,
        name: t.name,
        days_per_year: t.days_per_year,
        used,
        available,
        unlimited,
      });
    }

    const { rows: applications } = await query(
      `SELECT la.*, lt.name AS leave_type_name, lt.code AS leave_type_code
       FROM leave_applications la
       JOIN leave_types lt ON lt.id = la.leave_type_id
       WHERE la.user_id = $1 AND la.company_id = $2 AND la.is_deleted = FALSE
         AND (
           EXTRACT(YEAR FROM la.from_date) = $3 OR EXTRACT(YEAR FROM la.to_date) = $3
         )
       ORDER BY la.created_at DESC`,
      [userId, companyId, year],
    );

    res.json({ year, balances, applications });
  } catch (err) {
    console.error('leaveMy error:', err.message);
    res.status(500).json({ error: 'Failed to load leave data' });
  }
}

async function leavePending(req, res) {
  try {
    const { company_id: companyId, role, branch_id: myBranch } = req.user;

    if (!['branch_manager', 'company_admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const params = [companyId];
    let branchClause = '';
    if (role === 'branch_manager') {
      if (!myBranch) return res.status(400).json({ error: 'No branch assigned' });
      branchClause = ' AND la.branch_id = $2';
      params.push(myBranch);
    }

    const { rows } = await query(
      `SELECT la.*, lt.name AS leave_type_name, lt.code AS leave_type_code, lt.days_per_year,
              u.name AS user_name, u.email AS user_email
       FROM leave_applications la
       JOIN leave_types lt ON lt.id = la.leave_type_id
       JOIN users u ON u.id = la.user_id
       WHERE la.company_id = $1 AND la.is_deleted = FALSE AND la.status = 'pending'${branchClause}
       ORDER BY la.created_at ASC`,
      params,
    );

    const enriched = [];
    for (const row of rows) {
      const y = new Date(row.from_date).getFullYear();
      const used = await sumApprovedDaysForTypeYear(row.user_id, row.leave_type_id, y);
      const unlimited = row.leave_type_code === 'LWP' || Number(row.days_per_year) === 0;
      const available = unlimited ? null : Number(row.days_per_year) - used;
      enriched.push({ ...row, balance_available: available, balance_unlimited: unlimited });
    }

    res.json({ applications: enriched });
  } catch (err) {
    console.error('leavePending error:', err.message);
    res.status(500).json({ error: 'Failed to load pending applications' });
  }
}

async function leaveApprove(req, res) {
  try {
    const { company_id: companyId, role, branch_id: myBranch, id: reviewerId } = req.user;
    const { id: appId } = req.params;

    if (!['branch_manager', 'company_admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { rows: apps } = await query(
      `SELECT la.*, u.branch_id AS user_branch_id
       FROM leave_applications la
       JOIN users u ON u.id = la.user_id
       WHERE la.id = $1 AND la.company_id = $2 AND la.is_deleted = FALSE`,
      [appId, companyId],
    );
    if (apps.length === 0) return res.status(404).json({ error: 'Application not found' });
    const app = apps[0];

    if (app.user_id === reviewerId) {
      return res.status(403).json({ error: 'Cannot approve your own application' });
    }
    if (role === 'branch_manager' && app.branch_id !== myBranch) {
      return res.status(403).json({ error: 'Not your branch' });
    }
    if (app.status !== 'pending') {
      return res.status(400).json({ error: 'Application is not pending' });
    }

    const lt = await getLeaveTypeById(app.leave_type_id, companyId);
    if (!lt) return res.status(400).json({ error: 'Leave type missing' });

    if (!isUnlimitedLeave(lt)) {
      const year = new Date(app.from_date).getFullYear();
      const used = await sumApprovedDaysForTypeYear(app.user_id, app.leave_type_id, year);
      const avail = Number(lt.days_per_year) - used;
      if (Number(app.total_days) > avail + 1e-9) {
        return res.status(400).json({ error: 'Insufficient leave balance at approval time' });
      }
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE leave_applications
         SET status = 'approved', reviewed_by = $1, review_note = NULL, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [reviewerId, appId],
      );
      await upsertOnLeaveDays({
        companyId,
        branchId: app.branch_id,
        userId: app.user_id,
        fromStr: rowDate(app.from_date),
        toStr: rowDate(app.to_date),
        client,
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const { rows: out } = await query(`SELECT * FROM leave_applications WHERE id = $1`, [appId]);
    res.json({ application: out[0] });
  } catch (err) {
    console.error('leaveApprove error:', err.message);
    res.status(500).json({ error: 'Failed to approve application' });
  }
}

async function leaveReject(req, res) {
  try {
    const { company_id: companyId, role, branch_id: myBranch, id: reviewerId } = req.user;
    const { id: appId } = req.params;
    const reviewNote = req.body?.review_note;

    if (reviewNote == null || String(reviewNote).trim() === '') {
      return res.status(400).json({ error: 'review_note is required' });
    }

    if (!['branch_manager', 'company_admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { rows: apps } = await query(
      `SELECT * FROM leave_applications WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [appId, companyId],
    );
    if (apps.length === 0) return res.status(404).json({ error: 'Application not found' });
    const app = apps[0];

    if (role === 'branch_manager' && app.branch_id !== myBranch) {
      return res.status(403).json({ error: 'Not your branch' });
    }
    if (app.status !== 'pending') {
      return res.status(400).json({ error: 'Application is not pending' });
    }

    const { rows } = await query(
      `UPDATE leave_applications
       SET status = 'rejected', reviewed_by = $1, review_note = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reviewerId, String(reviewNote).trim(), appId],
    );

    res.json({ application: rows[0] });
  } catch (err) {
    console.error('leaveReject error:', err.message);
    res.status(500).json({ error: 'Failed to reject application' });
  }
}

async function leaveCancel(req, res) {
  try {
    const { id: userId, company_id: companyId } = req.user;
    const { id: appId } = req.params;

    const { rows: apps } = await query(
      `SELECT * FROM leave_applications WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [appId, companyId],
    );
    if (apps.length === 0) return res.status(404).json({ error: 'Application not found' });
    const app = apps[0];

    if (app.user_id !== userId) {
      return res.status(403).json({ error: 'Only the applicant can cancel' });
    }

    const today = todayYmd();
    const fromStr = rowDate(app.from_date);
    const toStr = rowDate(app.to_date);

    if (app.status === 'pending') {
      await query(
        `UPDATE leave_applications SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [appId],
      );
    } else if (app.status === 'approved' && fromStr > today) {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE leave_applications SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [appId],
        );
        await revertOnLeaveDays({ userId: app.user_id, fromStr, toStr, client });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      return res.status(400).json({ error: 'Cannot cancel this application' });
    }

    const { rows: out } = await query(`SELECT * FROM leave_applications WHERE id = $1`, [appId]);
    res.json({ application: out[0] });
  } catch (err) {
    console.error('leaveCancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel application' });
  }
}

/** Manager/admin: all applications with filters */
async function leaveListAll(req, res) {
  try {
    const { company_id: companyId, role, branch_id: myBranch } = req.user;
    const { staff_id, leave_type_id, status, from, to } = req.query;

    if (!['branch_manager', 'company_admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const cond = ['la.company_id = $1', 'la.is_deleted = FALSE'];
    const params = [companyId];
    let i = 2;

    if (role === 'branch_manager') {
      if (!myBranch) return res.status(400).json({ error: 'No branch assigned' });
      cond.push(`la.branch_id = $${i++}`);
      params.push(myBranch);
    }
    if (staff_id) {
      cond.push(`la.user_id = $${i++}`);
      params.push(staff_id);
    }
    if (leave_type_id) {
      cond.push(`la.leave_type_id = $${i++}`);
      params.push(leave_type_id);
    }
    if (status) {
      cond.push(`la.status = $${i++}`);
      params.push(status);
    }
    if (from) {
      cond.push(`la.to_date >= $${i++}::date`);
      params.push(from);
    }
    if (to) {
      cond.push(`la.from_date <= $${i++}::date`);
      params.push(to);
    }

    const where = cond.join(' AND ');
    const { rows } = await query(
      `SELECT la.*, lt.name AS leave_type_name, lt.code AS leave_type_code,
              u.name AS user_name,
              rv.name AS reviewed_by_name
       FROM leave_applications la
       JOIN leave_types lt ON lt.id = la.leave_type_id
       JOIN users u ON u.id = la.user_id
       LEFT JOIN users rv ON rv.id = la.reviewed_by
       WHERE ${where}
       ORDER BY la.created_at DESC
       LIMIT 500`,
      params,
    );

    res.json({ applications: rows });
  } catch (err) {
    console.error('leaveListAll error:', err.message);
    res.status(500).json({ error: 'Failed to list applications' });
  }
}

module.exports = {
  leaveApply,
  leaveMy,
  leavePending,
  leaveApprove,
  leaveReject,
  leaveCancel,
  leaveListAll,
  workingDatesInRange,
  eachDateInclusive,
  sumApprovedDaysForTypeYear,
};
