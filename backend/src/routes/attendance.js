const { Router } = require('express');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const {
  clockIn,
  clockOut,
  myStatus,
  todayByBranch,
  report,
} = require('../controllers/attendanceController');

const router = Router();

router.use(verifyToken);

router.post('/clockin', clockIn);
router.post('/clockout', clockOut);
router.get('/me', myStatus);
router.get('/today/:branchId', requireMinRole('branch_manager'), todayByBranch);
router.get('/report', requireMinRole('branch_manager'), report);

module.exports = router;
