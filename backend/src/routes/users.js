const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const usersController = require('../controllers/usersController');

const router = Router();

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Valid email required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().max(20).optional(),
  role: z.enum(['company_admin', 'branch_manager', 'staff', 'ca']),
  branch_id: z.string().uuid().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  role: z.enum(['company_admin', 'branch_manager', 'staff', 'ca']).optional(),
  branch_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

router.use(verifyToken);

router.post(
  '/',
  requireMinRole('company_admin'),
  validateBody(createUserSchema),
  usersController.createUser,
);

router.get(
  '/',
  requireMinRole('branch_manager'),
  usersController.listUsers,
);

router.patch(
  '/:id',
  requireMinRole('company_admin'),
  validateBody(updateUserSchema),
  usersController.updateUser,
);

router.patch(
  '/:id/toggle-active',
  requireMinRole('company_admin'),
  usersController.toggleActive,
);

router.post(
  '/:id/reset-password',
  requireMinRole('company_admin'),
  usersController.resetPassword,
);

router.delete(
  '/:id',
  requireMinRole('company_admin'),
  usersController.deleteUser,
);

module.exports = router;
