const { Router } = require('express');
const { z } = require('zod');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const { validateBody } = require('../middleware/validate');
const { query } = require('../config/db');

const router = Router();

router.use(verifyToken);

const branchSchema = z.object({
  name: z.string().min(1, 'Branch name is required').max(255),
  address: z.string().max(1000).optional(),
  phone: z.string().max(20).optional(),
  manager_id: z.string().uuid().nullable().optional(),
  city: z.string().max(200).optional(),
  state: z.string().max(200).optional(),
  pincode: z.string().max(10).optional(),
  state_code: z.string().max(5).optional(),
});

// List branches with manager name
router.get('/', async (req, res) => {
  const company_id = req.user.company_id;
  const { role, branch_id: myBranch } = req.user;

  if (role === 'branch_manager' || role === 'staff') {
    if (!myBranch) {
      return res.json({ branches: [] });
    }
    const { rows } = await query(
      `SELECT b.id, b.name, b.address, b.phone, b.manager_id,
              b.city, b.state, b.pincode, b.state_code,
              u.name AS manager_name, u.email AS manager_email
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id AND u.is_deleted = FALSE
       WHERE b.company_id = $1 AND b.id = $2 AND b.is_deleted = FALSE
       ORDER BY b.name`,
      [company_id, myBranch],
    );
    return res.json({ branches: rows });
  }

  const { rows } = await query(
    `SELECT b.id, b.name, b.address, b.phone, b.manager_id,
            b.city, b.state, b.pincode, b.state_code,
            u.name AS manager_name, u.email AS manager_email
     FROM branches b
     LEFT JOIN users u ON u.id = b.manager_id AND u.is_deleted = FALSE
     WHERE b.company_id = $1 AND b.is_deleted = FALSE
     ORDER BY b.name`,
    [company_id],
  );
  res.json({ branches: rows });
});

// Create branch
router.post(
  '/',
  requireMinRole('company_admin'),
  validateBody(branchSchema),
  async (req, res) => {
    const company_id = req.user.company_id;
    const { name, address, phone, manager_id, city, state, pincode, state_code } = req.validated;

    if (manager_id) {
      const mgr = await query(
        `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [manager_id, company_id],
      );
      if (mgr.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid manager user' });
      }
    }

    const { rows } = await query(
      `INSERT INTO branches (company_id, name, address, phone, manager_id, city, state, pincode, state_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, address, phone, manager_id, city, state, pincode, state_code, created_at`,
      [company_id, name, address || null, phone || null, manager_id || null, city || null, state || null, pincode || null, state_code || null],
    );

    res.status(201).json({ branch: rows[0] });
  },
);

// Update branch
router.patch(
  '/:id',
  requireMinRole('company_admin'),
  validateBody(branchSchema.partial()),
  async (req, res) => {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const existing = await query(
      `SELECT id FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [id, company_id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const updates = req.validated;
    if (updates.manager_id) {
      const mgr = await query(
        `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [updates.manager_id, company_id],
      );
      if (mgr.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid manager user' });
      }
    }

    const allowedFields = ['name', 'address', 'phone', 'manager_id', 'city', 'state', 'pincode', 'state_code'];
    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        setClauses.push(`${key} = $${idx++}`);
        params.push(updates[key]);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id, company_id);
    const { rows } = await query(
      `UPDATE branches SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND company_id = $${idx} AND is_deleted = FALSE
       RETURNING id, name, address, phone, manager_id, city, state, pincode, state_code`,
      params,
    );

    res.json({ branch: rows[0] });
  },
);

// Delete branch (soft delete)
router.delete(
  '/:id',
  requireMinRole('company_admin'),
  async (req, res) => {
    const company_id = req.user.company_id;
    const { id } = req.params;

    const vehicleCheck = await query(
      `SELECT COUNT(*)::int AS count FROM vehicles
       WHERE branch_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'in_stock'`,
      [id, company_id],
    );
    if (vehicleCheck.rows[0].count > 0) {
      return res.status(400).json({ error: 'Cannot delete branch with in-stock vehicles. Transfer them first.' });
    }

    await query(
      `UPDATE branches SET is_deleted = TRUE WHERE id = $1 AND company_id = $2`,
      [id, company_id],
    );

    res.json({ message: 'Branch deleted' });
  },
);

module.exports = router;
