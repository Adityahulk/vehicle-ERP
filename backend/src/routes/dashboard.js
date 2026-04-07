const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const { adminDashboard, branchDashboard } = require('../controllers/dashboardController');

router.use(verifyToken);

// Admin dashboard — company_admin or higher
router.get('/admin', requireMinRole('company_admin'), adminDashboard);

// Branch dashboard — any authenticated user (controller verifies branch access)
router.get('/branch/:branchId', branchDashboard);

module.exports = router;
