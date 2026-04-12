const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole, requireNotRole, requireRole } = require('../middleware/role');
const lc = require('../controllers/loansController');

const router = Router();
router.use(verifyToken);

const PAISE_HINT =
  'penalty_per_day must be in paise (integer). For ₹100/day, enter 10000.';

const createLoanSchema = z
  .object({
    invoice_id: z.string().uuid('Valid invoice ID required'),
    bank_name: z.string().min(1, 'Bank name required').max(255),
    loan_amount: z.number().int().min(1, 'Loan amount in paise'),
    interest_rate: z.number().min(0).max(100),
    tenure_months: z.number().int().min(1).max(360),
    disbursement_date: z.string().min(1, 'Disbursement date required'),
    penalty_per_day: z
      .number({ invalid_type_error: PAISE_HINT })
      .int(PAISE_HINT)
      .min(0, PAISE_HINT),
    grace_period_days: z.number().int().min(0, 'grace_period_days must be >= 0'),
    penalty_cap: z.number().int().min(0).optional().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.penalty_per_day > 0 && data.penalty_per_day < 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: PAISE_HINT,
        path: ['penalty_per_day'],
      });
    }
  });

const waivePenaltySchema = z.object({
  amount: z.number().int().positive('Amount must be a positive integer (paise)'),
  note: z.string().min(10, 'Note must be at least 10 characters'),
});

router.get('/penalty/summary', requireMinRole('company_admin'), lc.penaltySummary);
router.get('/overdue', lc.listOverdue);
router.get('/', lc.listLoans);
router.post('/', requireNotRole('ca'), validateBody(createLoanSchema), lc.createLoan);

router.get('/:id/penalty', requireMinRole('branch_manager'), lc.getLoanPenalty);
router.post(
  '/:id/penalty/waive',
  requireNotRole('ca'),
  requireRole('company_admin', 'super_admin'),
  validateBody(waivePenaltySchema),
  lc.waiveLoanPenalty,
);

router.get('/:id', lc.getLoan);
router.patch('/:id/close', requireNotRole('ca'), requireMinRole('branch_manager'), lc.closeLoan);

module.exports = router;
