const { Router } = require('express');
const { verifyToken } = require('../middleware/auth');
const { requireNotRole, requireMinRole, requireRole } = require('../middleware/role');
const wc = require('../controllers/whatsappController');

const router = Router();
router.use(verifyToken);
router.use(requireNotRole('ca'));

const staffPlus = requireRole('staff', 'branch_manager', 'company_admin', 'super_admin');
const managersPlus = requireMinRole('branch_manager');

router.get('/preview-invoice/:invoiceId', staffPlus, wc.previewInvoiceMessage);
router.get('/preview-quotation/:quotationId', staffPlus, wc.previewQuotationMessage);
router.get('/preview-loan/:loanId', staffPlus, wc.previewLoanMessage);
router.post('/loan/:loanId/record-reminder', staffPlus, wc.recordLoanReminderSent);

router.get('/pending-tasks', managersPlus, wc.listPendingTasks);
router.post('/pending-tasks/:id/dismiss', managersPlus, wc.dismissPendingTask);
router.post('/pending-tasks/:id/complete-reminder', managersPlus, wc.completePendingReminderTask);

router.get('/logs', requireMinRole('branch_manager'), wc.listLogs);
router.get('/logs/invoice/:invoiceId', wc.logsForInvoice);

router.get('/templates', requireMinRole('company_admin'), wc.listTemplates);
router.patch('/templates/:id', requireMinRole('company_admin'), wc.updateTemplate);

module.exports = router;
