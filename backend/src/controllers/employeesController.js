const { query } = require('../config/db');
const { istYmd } = require('../lib/istDate');

function maskAadharInput(raw) {
  if (!raw || !String(raw).trim()) return null;
  const digits = String(raw).replace(/\D/g, '');
  const last4 = digits.slice(-4);
  if (last4.length < 4) return null;
  return `XXXX-XXXX-${last4}`;
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { first, last };
}

async function nextEmployeeCode(companyId, branchCode) {
  const code = String(branchCode || 'HQ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HQ';
  const prefix = `EMP-${code}-`;
  const { rows } = await query(
    `SELECT employee_code FROM employee_profiles
     WHERE company_id = $1 AND employee_code LIKE $2`,
    [companyId, `${prefix}%`],
  );
  let max = 0;
  for (const r of rows) {
    const m = String(r.employee_code).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function assertCanViewProfile(req, targetUserId) {
  const { id: callerId, company_id: companyId, role, branch_id: myBranch } = req.user;

  const { rows } = await query(
    `SELECT id, branch_id, company_id FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [targetUserId, companyId],
  );
  if (rows.length === 0) return { error: 'User not found', status: 404 };
  const target = rows[0];

  if (['company_admin', 'super_admin'].includes(role)) {
    return { target, mode: 'admin' };
  }
  if (callerId === targetUserId) {
    return { target, mode: 'self' };
  }
  if (role === 'branch_manager' && target.branch_id && String(target.branch_id) === String(myBranch)) {
    return { target, mode: 'manager' };
  }
  return { error: 'Not allowed', status: 403 };
}

async function createEmployee(req, res) {
  try {
    const companyId = req.user.company_id;
    const d = req.body;

    const userId = d.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const { rows: urows } = await query(
      `SELECT u.id, u.branch_id, b.code AS branch_code
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = $1 AND u.company_id = $2 AND u.is_deleted = FALSE`,
      [userId, companyId],
    );
    if (urows.length === 0) return res.status(404).json({ error: 'User not found' });

    const existing = await query(
      `SELECT id FROM employee_profiles WHERE user_id = $1`,
      [userId],
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Employee profile already exists for this user' });
    }

    const branchCode = urows[0].branch_code || 'HQ';
    const employee_code = await nextEmployeeCode(companyId, branchCode);
    const joining_date = String(d.joining_date).slice(0, 10);
    const probation_end_date = addDaysIso(joining_date, 90);

    const annualPaise = Math.round(Number(d.annual_salary) * 100);
    if (!Number.isFinite(annualPaise) || annualPaise < 0) {
      return res.status(400).json({ error: 'annual_salary (₹) must be a valid number' });
    }

    const aadhar = d.aadhar_number ? maskAadharInput(d.aadhar_number) : null;

    const { rows } = await query(
      `INSERT INTO employee_profiles (
         company_id, user_id, employee_code, designation, department, joining_date,
         employment_type, probation_end_date, annual_salary, salary_type,
         bank_name, bank_account_number, bank_ifsc, pan_number, aadhar_number,
         emergency_contact_name, emergency_contact_phone, address
       ) VALUES (
         $1,$2,$3,$4,$5,$6::date,
         COALESCE($7,'full_time'), $8::date, $9, COALESCE($10,'monthly'),
         $11,$12,$13,$14,$15,
         $16,$17,$18
       ) RETURNING *`,
      [
        companyId,
        userId,
        employee_code,
        String(d.designation || '').trim() || 'Staff',
        d.department || null,
        joining_date,
        d.employment_type || 'full_time',
        probation_end_date,
        annualPaise,
        d.salary_type || 'monthly',
        d.bank_name || null,
        d.bank_account_number || null,
        d.bank_ifsc || null,
        d.pan_number || null,
        aadhar,
        d.emergency_contact_name || null,
        d.emergency_contact_phone || null,
        d.address || null,
      ],
    );

    res.status(201).json({ profile: rows[0] });
  } catch (err) {
    console.error('createEmployee:', err.message);
    res.status(500).json({ error: 'Failed to create employee profile' });
  }
}

async function listEmployees(req, res) {
  try {
    const companyId = req.user.company_id;
    const { role, branch_id: myBranch } = req.user;
    const { branch_id, department, employment_type, search } = req.query;

    const cond = ['u.company_id = $1', 'u.is_deleted = FALSE', 'ep.id IS NOT NULL'];
    const params = [companyId];
    let idx = 2;

    if (role === 'branch_manager') {
      cond.push(`u.branch_id = $${idx++}`);
      params.push(myBranch);
    } else if (branch_id) {
      cond.push(`u.branch_id = $${idx++}`);
      params.push(branch_id);
    }

    if (department) {
      cond.push(`ep.department = $${idx++}`);
      params.push(department);
    }
    if (employment_type) {
      cond.push(`ep.employment_type = $${idx++}`);
      params.push(employment_type);
    }
    if (search) {
      cond.push(`(
        u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR ep.employee_code ILIKE $${idx} OR ep.designation ILIKE $${idx}
      )`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = cond.join(' AND ');

    const { rows } = await query(
      `SELECT u.id AS user_id, u.name, u.email, u.phone, u.role, u.branch_id, u.is_active AS user_active,
              b.name AS branch_name,
              ep.id AS employee_profile_id, ep.employee_code, ep.designation, ep.department,
              ep.joining_date, ep.employment_type, ep.annual_salary, ep.is_active AS profile_active,
              ep.resigned_at,
              (SELECT COUNT(*)::int FROM salary_revisions sr WHERE sr.employee_id = ep.id) AS salary_revision_count,
              (EXTRACT(YEAR FROM AGE(CURRENT_DATE, ep.joining_date)) * 12
                + EXTRACT(MONTH FROM AGE(CURRENT_DATE, ep.joining_date)))::int AS months_employed
       FROM users u
       INNER JOIN employee_profiles ep ON ep.user_id = u.id AND ep.company_id = u.company_id
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE ${where}
       ORDER BY u.name`,
      params,
    );

    res.json({ employees: rows });
  } catch (err) {
    console.error('listEmployees:', err.message);
    res.status(500).json({ error: 'Failed to list employees' });
  }
}

function redactProfileRow(ep, mode) {
  if (mode === 'admin') return ep;
  const { notes, ...rest } = ep;
  return {
    ...rest,
    bank_account_number: rest.bank_account_number
      ? `****${String(rest.bank_account_number).slice(-4)}`
      : null,
    notes: undefined,
  };
}

async function getEmployee(req, res) {
  try {
    const { userId } = req.params;
    const check = await assertCanViewProfile(req, userId);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { rows: urows } = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.branch_id, u.is_active,
              b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = $1 AND u.company_id = $2 AND u.is_deleted = FALSE`,
      [userId, req.user.company_id],
    );
    if (urows.length === 0) return res.status(404).json({ error: 'User not found' });

    const { rows: eprows } = await query(
      `SELECT * FROM employee_profiles WHERE user_id = $1 AND company_id = $2`,
      [userId, req.user.company_id],
    );
    if (eprows.length === 0) return res.status(404).json({ error: 'No employee profile for this user' });

    let ep = eprows[0];
    const isCompanyAdmin = ['company_admin', 'super_admin'].includes(req.user.role);
    const redactMode = isCompanyAdmin ? 'admin' : 'limited';
    ep = redactProfileRow(ep, redactMode);

    const { rows: history } = await query(
      `SELECT sr.*, u.name AS revised_by_name
       FROM salary_revisions sr
       LEFT JOIN users u ON u.id = sr.revised_by
       WHERE sr.employee_id = $1
       ORDER BY sr.effective_date DESC, sr.created_at DESC`,
      [eprows[0].id],
    );

    res.json({ user: urows[0], profile: ep, salary_history: history });
  } catch (err) {
    console.error('getEmployee:', err.message);
    res.status(500).json({ error: 'Failed to load employee' });
  }
}

async function patchEmployee(req, res) {
  try {
    const { userId } = req.params;
    const companyId = req.user.company_id;
    const d = req.body;

    const { rows: eprows } = await query(
      `SELECT * FROM employee_profiles WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId],
    );
    if (eprows.length === 0) return res.status(404).json({ error: 'Employee profile not found' });
    const ep = eprows[0];

    const newAnnualRupees = d.annual_salary !== undefined ? Number(d.annual_salary) : null;
    if (newAnnualRupees !== null && !Number.isFinite(newAnnualRupees)) {
      return res.status(400).json({ error: 'Invalid annual_salary' });
    }
    const newAnnualPaise = newAnnualRupees !== null ? Math.round(newAnnualRupees * 100) : null;

    if (newAnnualPaise !== null && newAnnualPaise !== Number(ep.annual_salary)) {
      if (!d.salary_effective_date || !String(d.salary_change_reason || '').trim()) {
        return res.status(400).json({
          error: 'When changing annual_salary, salary_effective_date and salary_change_reason are required',
        });
      }
    }

    const fields = [];
    const vals = [];
    let i = 1;

    const set = (col, val) => {
      fields.push(`${col} = $${i++}`);
      vals.push(val);
    };

    if (d.designation != null) set('designation', String(d.designation).trim());
    if (d.department !== undefined) set('department', d.department || null);
    if (d.joining_date != null) set('joining_date', String(d.joining_date).slice(0, 10));
    if (d.employment_type != null) set('employment_type', d.employment_type);
    if (d.probation_end_date !== undefined) set('probation_end_date', d.probation_end_date || null);
    if (d.salary_type != null) set('salary_type', d.salary_type);
    if (d.bank_name !== undefined) set('bank_name', d.bank_name || null);
    if (d.bank_account_number !== undefined) set('bank_account_number', d.bank_account_number || null);
    if (d.bank_ifsc !== undefined) set('bank_ifsc', d.bank_ifsc || null);
    if (d.pan_number !== undefined) set('pan_number', d.pan_number || null);
    if (d.aadhar_number !== undefined) {
      set('aadhar_number', d.aadhar_number ? maskAadharInput(d.aadhar_number) : null);
    }
    if (d.emergency_contact_name !== undefined) set('emergency_contact_name', d.emergency_contact_name || null);
    if (d.emergency_contact_phone !== undefined) set('emergency_contact_phone', d.emergency_contact_phone || null);
    if (d.address !== undefined) set('address', d.address || null);
    if (d.notes !== undefined) set('notes', d.notes || null);
    if (d.is_active !== undefined) set('is_active', !!d.is_active);

    if (newAnnualPaise !== null && newAnnualPaise !== Number(ep.annual_salary)) {
      const oldSal = Number(ep.annual_salary);
      await query(
        `INSERT INTO salary_revisions (company_id, employee_id, effective_date, old_salary, new_salary, reason, revised_by)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7)`,
        [
          companyId,
          ep.id,
          String(d.salary_effective_date).slice(0, 10),
          oldSal,
          newAnnualPaise,
          String(d.salary_change_reason).trim(),
          req.user.id,
        ],
      );
      set('annual_salary', newAnnualPaise);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    vals.push(ep.id);
    await query(
      `UPDATE employee_profiles SET ${fields.join(', ')} WHERE id = $${i}`,
      vals,
    );

    const { rows: out } = await query(`SELECT * FROM employee_profiles WHERE id = $1`, [ep.id]);
    res.json({ profile: out[0] });
  } catch (err) {
    console.error('patchEmployee:', err.message);
    res.status(500).json({ error: 'Failed to update employee' });
  }
}

async function salaryHistory(req, res) {
  try {
    const { userId } = req.params;
    const companyId = req.user.company_id;

    const { rows: eprows } = await query(
      `SELECT id FROM employee_profiles WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId],
    );
    if (eprows.length === 0) return res.status(404).json({ error: 'Employee profile not found' });

    const { rows } = await query(
      `SELECT sr.*, u.name AS revised_by_name
       FROM salary_revisions sr
       LEFT JOIN users u ON u.id = sr.revised_by
       WHERE sr.employee_id = $1
       ORDER BY sr.effective_date DESC, sr.created_at DESC`,
      [eprows[0].id],
    );
    res.json({ revisions: rows });
  } catch (err) {
    console.error('salaryHistory:', err.message);
    res.status(500).json({ error: 'Failed to load salary history' });
  }
}

async function resignEmployee(req, res) {
  try {
    const { userId } = req.params;
    const companyId = req.user.company_id;
    const { resigned_at, resignation_reason } = req.body;

    if (!resigned_at) return res.status(400).json({ error: 'resigned_at is required' });

    const { rows: eprows } = await query(
      `SELECT id FROM employee_profiles WHERE user_id = $1 AND company_id = $2`,
      [userId, companyId],
    );
    if (eprows.length === 0) return res.status(404).json({ error: 'Employee profile not found' });

    await query(
      `UPDATE employee_profiles SET
         is_active = FALSE,
         resigned_at = $1::date,
         resignation_reason = $2
       WHERE id = $3`,
      [String(resigned_at).slice(0, 10), resignation_reason || null, eprows[0].id],
    );

    await query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [userId, companyId],
    );

    const { rows: prof } = await query(`SELECT * FROM employee_profiles WHERE id = $1`, [eprows[0].id]);
    const { rows: usr } = await query(`SELECT id, is_active FROM users WHERE id = $1`, [userId]);
    res.json({ profile: prof[0], user: usr[0] });
  } catch (err) {
    console.error('resignEmployee:', err.message);
    res.status(500).json({ error: 'Failed to process resignation' });
  }
}

async function attendanceSummary(req, res) {
  try {
    const { userId } = req.params;
    const check = await assertCanViewProfile(req, userId);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const companyId = req.user.company_id;
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
      summary: {
        present,
        absent,
        on_leave: onLeave,
        hours_month: Math.round(hoursSum * 100) / 100,
      },
      link_hint: `/attendance/report?from=${first}&to=${last}&user_id=${userId}`,
    });
  } catch (err) {
    console.error('attendanceSummary:', err.message);
    res.status(500).json({ error: 'Failed to load attendance summary' });
  }
}

async function leaveBalancesForEmployee(req, res) {
  try {
    const { userId } = req.params;
    const check = await assertCanViewProfile(req, userId);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const companyId = req.user.company_id;
    const year = Number(req.query.year) || new Date().getFullYear();

    const { sumApprovedDaysForTypeYear } = require('./attendanceLeaveController');
    const { seedDefaultLeaveTypes } = require('../services/leaveTypesService');

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

    res.json({ year, balances });
  } catch (err) {
    console.error('leaveBalancesForEmployee:', err.message);
    res.status(500).json({ error: 'Failed to load leave balances' });
  }
}

module.exports = {
  createEmployee,
  listEmployees,
  getEmployee,
  patchEmployee,
  salaryHistory,
  resignEmployee,
  attendanceSummary,
  leaveBalancesForEmployee,
};
