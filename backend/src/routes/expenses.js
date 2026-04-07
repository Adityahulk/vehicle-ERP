const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const ec = require('../controllers/expensesController');

const router = Router();
router.use(verifyToken);

const createExpenseSchema = z.object({
  category: z.string().min(1, 'Category required'),
  description: z.string().max(1000).optional(),
  amount: z.number().int().min(1, 'Amount in paise must be positive'),
  expense_date: z.string().min(1, 'Expense date required'),
});

router.get('/summary', ec.expenseSummary);
router.get('/', ec.listExpenses);
router.post('/', requireMinRole('branch_manager'), validateBody(createExpenseSchema), ec.createExpense);

module.exports = router;
