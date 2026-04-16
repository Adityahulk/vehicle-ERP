const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../config/db');
const redis = require('../config/redis');

const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      company_id: user.company_id,
      branch_id: user.branch_id,
      role: user.role,
      name: user.name,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_EXPIRY },
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, company_id: user.company_id, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_EXPIRY },
  );
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function login(req, res) {
  const { email, password } = req.validated;

  const { rows } = await query(
    `SELECT u.id, u.company_id, u.branch_id, u.name, u.email, u.password_hash,
            u.role, u.phone, u.is_active
     FROM users u
     WHERE u.email = $1 AND u.is_deleted = FALSE`,
    [email],
  );

  if (rows.length === 0) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  let user = null;
  for (const row of rows) {
    if (!row.is_active) continue;
    const validPassword = await bcrypt.compare(password, row.password_hash);
    if (validPassword) {
      if (user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      user = row;
    }
  }

  if (!user) {
    const anyActive = rows.some((r) => r.is_active);
    if (!anyActive) {
      return res.status(403).json({ error: 'Account is deactivated. Contact your administrator.' });
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await redis.set(
    `refresh:${user.id}`,
    hashToken(refreshToken),
    'EX',
    REFRESH_TTL_SECONDS,
  );

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      company_id: user.company_id,
      branch_id: user.branch_id,
    },
  });
}

async function refresh(req, res) {
  const { refresh_token } = req.validated;

  let decoded;
  try {
    decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  if (decoded.type !== 'refresh') {
    return res.status(401).json({ error: 'Invalid token type' });
  }

  const storedHash = await redis.get(`refresh:${decoded.id}`);
  if (!storedHash || storedHash !== hashToken(refresh_token)) {
    return res.status(401).json({ error: 'Refresh token revoked or invalid' });
  }

  const { rows } = await query(
    `SELECT id, company_id, branch_id, name, email, role, is_active
     FROM users WHERE id = $1 AND is_deleted = FALSE`,
    [decoded.id],
  );

  if (rows.length === 0 || !rows[0].is_active) {
    await redis.del(`refresh:${decoded.id}`);
    return res.status(401).json({ error: 'User not found or deactivated' });
  }

  const user = rows[0];
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  await redis.set(
    `refresh:${user.id}`,
    hashToken(newRefreshToken),
    'EX',
    REFRESH_TTL_SECONDS,
  );

  res.json({
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
  });
}

async function logout(req, res) {
  await redis.del(`refresh:${req.user.id}`);
  res.json({ message: 'Logged out successfully' });
}

async function me(req, res) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.company_id, u.branch_id,
            u.is_active, u.created_at,
            c.name AS company_name, c.gstin AS company_gstin,
            b.name AS branch_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     LEFT JOIN branches b ON b.id = u.branch_id
     WHERE u.id = $1 AND u.company_id = $2 AND u.is_deleted = FALSE`,
    [req.user.id, req.user.company_id],
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: rows[0] });
}

module.exports = { login, refresh, logout, me };
