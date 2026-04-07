const { Router } = require('express');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const {
  gstr1,
  gstr1Export,
  salesSummary,
  stockAging,
} = require('../controllers/reportsController');

const router = Router();

router.use(verifyToken);

router.get('/gstr1', requireMinRole('company_admin'), gstr1);
router.get('/gstr1/export', requireMinRole('company_admin'), gstr1Export);
router.get('/sales-summary', requireMinRole('branch_manager'), salesSummary);
router.get('/stock-aging', requireMinRole('branch_manager'), stockAging);

module.exports = router;
