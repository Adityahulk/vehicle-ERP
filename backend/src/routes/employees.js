const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole, requireNotRole, requireRole } = require('../middleware/role');
const ec = require('../controllers/employeesController');

const router = Router();
router.use(verifyToken);
router.use(requireNotRole('ca'));

const createSchema = z.object({
  user_id: z.string().uuid(),
  designation: z.string().min(1).max(200),
  department: z.string().max(100).optional(),
  joining_date: z.string().min(1),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'probation']).optional(),
  annual_salary: z.number().min(0),
  salary_type: z.enum(['monthly', 'daily', 'hourly']).optional(),
  bank_name: z.string().max(200).optional(),
  bank_account_number: z.string().max(100).optional(),
  bank_ifsc: z.string().max(20).optional(),
  pan_number: z.string().max(20).optional(),
  aadhar_number: z.string().optional(),
  emergency_contact_name: z.string().max(200).optional(),
  emergency_contact_phone: z.string().max(20).optional(),
  address: z.string().optional(),
});

const patchSchema = z.object({
  designation: z.string().min(1).max(200).optional(),
  department: z.string().max(100).nullable().optional(),
  joining_date: z.string().optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'probation']).optional(),
  probation_end_date: z.string().nullable().optional(),
  annual_salary: z.number().min(0).optional(),
  salary_effective_date: z.string().optional(),
  salary_change_reason: z.string().optional(),
  salary_type: z.enum(['monthly', 'daily', 'hourly']).optional(),
  bank_name: z.string().max(200).nullable().optional(),
  bank_account_number: z.string().max(100).nullable().optional(),
  bank_ifsc: z.string().max(20).nullable().optional(),
  pan_number: z.string().max(20).nullable().optional(),
  aadhar_number: z.string().nullable().optional(),
  emergency_contact_name: z.string().max(200).nullable().optional(),
  emergency_contact_phone: z.string().max(20).nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

const resignSchema = z.object({
  resigned_at: z.string().min(1),
  resignation_reason: z.string().optional(),
});

router.get('/', requireMinRole('branch_manager'), ec.listEmployees);
router.post('/', requireRole('company_admin', 'super_admin'), validateBody(createSchema), ec.createEmployee);

router.get(
  '/:userId/salary-history',
  requireRole('company_admin', 'super_admin'),
  ec.salaryHistory,
);

router.get(
  '/:userId/attendance-summary',
  requireMinRole('branch_manager'),
  ec.attendanceSummary,
);

router.get(
  '/:userId/leave-balances',
  requireMinRole('branch_manager'),
  ec.leaveBalancesForEmployee,
);

router.post(
  '/:userId/resign',
  requireRole('company_admin', 'super_admin'),
  validateBody(resignSchema),
  ec.resignEmployee,
);

router.get('/:userId', requireMinRole('staff'), ec.getEmployee);
router.patch(
  '/:userId',
  requireRole('company_admin', 'super_admin'),
  validateBody(patchSchema),
  ec.patchEmployee,
);

module.exports = router;
