const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { ROLE_HIERARCHY } = require('../middleware/role');

const SALT_ROUNDS = 12;

async function createUser(req, res) {
  const { name, email, password, phone, role, branch_id } = req.validated;
  const company_id = req.user.company_id;

  // Cannot create a user with a higher or equal role than your own (except company_admin creating staff/branch_manager)
  const callerLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const targetLevel = ROLE_HIERARCHY[role] || 0;
  if (targetLevel >= callerLevel) {
    return res.status(403).json({ error: 'Cannot create a user with equal or higher role than your own' });
  }

  const existing = await query(
    `SELECT id FROM users WHERE email = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [email, company_id],
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  if (branch_id) {
    const branch = await query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [branch_id, company_id],
    );
    if (branch.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid branch' });
    }
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const { rows } = await query(
    `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, company_id, branch_id, name, email, phone, role, is_active, created_at`,
    [company_id, branch_id || null, name, email, password_hash, phone || null, role],
  );

  res.status(201).json({ user: rows[0] });
}

async function listUsers(req, res) {
  const company_id = req.user.company_id;
  const { role: callerRole, branch_id: callerBranch } = req.user;
  const { page = 1, limit = 50, branch_id, role, search } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const conditions = ['u.company_id = $1', 'u.is_deleted = FALSE'];
  const params = [company_id];
  let idx = 2;

  // branch_manager and staff only see their own branch
  if (callerRole === 'branch_manager' || callerRole === 'staff') {
    conditions.push(`u.branch_id = $${idx++}`);
    params.push(callerBranch);
  } else if (branch_id) {
    conditions.push(`u.branch_id = $${idx++}`);
    params.push(branch_id);
  }

  if (role) {
    conditions.push(`u.role = $${idx++}`);
    params.push(role);
  }

  if (search) {
    conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM users u WHERE ${where}`,
    params,
  );

  params.push(Number(limit), offset);
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.branch_id, u.is_active, u.created_at,
            b.name AS branch_name
     FROM users u
     LEFT JOIN branches b ON b.id = u.branch_id
     WHERE ${where}
     ORDER BY u.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  res.json({
    users: rows,
    total: parseInt(countResult.rows[0].count, 10),
    page: Number(page),
    limit: Number(limit),
  });
}

async function updateUser(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const updates = req.validated;

  // Fetch target user
  const target = await query(
    `SELECT id, role FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );
  if (target.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const targetUser = target.rows[0];
  const callerLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;

  if (targetLevel >= callerLevel) {
    return res.status(403).json({ error: 'Cannot modify a user with equal or higher role' });
  }

  if (updates.role) {
    const newLevel = ROLE_HIERARCHY[updates.role] || 0;
    if (newLevel >= callerLevel) {
      return res.status(403).json({ error: 'Cannot assign a role equal to or above your own' });
    }
  }

  if (updates.branch_id) {
    const branch = await query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [updates.branch_id, company_id],
    );
    if (branch.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid branch' });
    }
  }

  const setClauses = [];
  const params = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${idx++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  params.push(id, company_id);
  const { rows } = await query(
    `UPDATE users SET ${setClauses.join(', ')}
     WHERE id = $${idx++} AND company_id = $${idx} AND is_deleted = FALSE
     RETURNING id, company_id, branch_id, name, email, phone, role, is_active, created_at`,
    params,
  );

  res.json({ user: rows[0] });
}

async function deleteUser(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const target = await query(
    `SELECT id, role FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );
  if (target.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const callerLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const targetLevel = ROLE_HIERARCHY[target.rows[0].role] || 0;
  if (targetLevel >= callerLevel) {
    return res.status(403).json({ error: 'Cannot delete a user with equal or higher role' });
  }

  await query(
    `UPDATE users SET is_deleted = TRUE WHERE id = $1 AND company_id = $2`,
    [id, company_id],
  );

  res.json({ message: 'User deleted' });
}

async function toggleActive(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot toggle your own account' });
  }

  const target = await query(
    `SELECT id, role, is_active FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );
  if (target.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const callerLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const targetLevel = ROLE_HIERARCHY[target.rows[0].role] || 0;
  if (targetLevel >= callerLevel) {
    return res.status(403).json({ error: 'Cannot modify a user with equal or higher role' });
  }

  const newActive = !target.rows[0].is_active;
  const { rows } = await query(
    `UPDATE users SET is_active = $1
     WHERE id = $2 AND company_id = $3 AND is_deleted = FALSE
     RETURNING id, name, email, role, is_active`,
    [newActive, id, company_id],
  );

  res.json({ user: rows[0] });
}

async function resetPassword(req, res) {
  const { id } = req.params;
  const company_id = req.user.company_id;
  const crypto = require('crypto');

  const target = await query(
    `SELECT id, role, name FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [id, company_id],
  );
  if (target.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const callerLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const targetLevel = ROLE_HIERARCHY[target.rows[0].role] || 0;
  if (targetLevel >= callerLevel) {
    return res.status(403).json({ error: 'Cannot reset password for a user with equal or higher role' });
  }

  const tempPassword = crypto.randomBytes(4).toString('hex');
  const password_hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  await query(
    `UPDATE users SET password_hash = $1 WHERE id = $2 AND company_id = $3`,
    [password_hash, id, company_id],
  );

  res.json({
    message: 'Password reset successfully',
    user_name: target.rows[0].name,
    temp_password: tempPassword,
  });
}

module.exports = { createUser, listUsers, updateUser, deleteUser, toggleActive, resetPassword };
