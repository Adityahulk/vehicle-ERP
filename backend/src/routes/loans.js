const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const lc = require('../controllers/loansController');

const router = Router();
router.use(verifyToken);

const createLoanSchema = z.object({
  invoice_id: z.string().uuid('Valid invoice ID required'),
  bank_name: z.string().min(1, 'Bank name required').max(255),
  loan_amount: z.number().int().min(1, 'Loan amount in paise'),
  interest_rate: z.number().min(0).max(100),
  tenure_months: z.number().int().min(1).max(360),
  disbursement_date: z.string().min(1, 'Disbursement date required'),
  penalty_per_day: z.number().int().min(0).optional().default(0),
});

router.get('/overdue', lc.listOverdue);
router.get('/', lc.listLoans);
router.post('/', validateBody(createLoanSchema), lc.createLoan);
router.get('/:id', lc.getLoan);
router.patch('/:id/close', requireMinRole('branch_manager'), lc.closeLoan);

module.exports = router;
