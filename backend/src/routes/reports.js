const { Router } = require('express');
const { verifyToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const {
  gstr1,
  gstr1Export,
  salesSummary,
  stockAging,
} = require('../controllers/reportsController');

const router = Router();

router.use(verifyToken);

const reportAccess = requireRole('super_admin', 'company_admin', 'ca');
const reportAndManagerAccess = requireRole('super_admin', 'company_admin', 'branch_manager', 'ca');

router.get('/gstr1', reportAccess, gstr1);
router.get('/gstr1/export', reportAccess, gstr1Export);
router.get('/sales-summary', reportAndManagerAccess, salesSummary);
router.get('/stock-aging', reportAndManagerAccess, stockAging);

module.exports = router;
