const { Router } = require('express');
const { verifyToken } = require('../middleware/auth');
const { requireNotRole, requireMinRole, requireRole } = require('../middleware/role');
const wc = require('../controllers/whatsappController');

const router = Router();
router.use(verifyToken);
router.use(requireNotRole('ca'));

const staffPlus = requireRole('staff', 'branch_manager', 'company_admin', 'super_admin');

router.post('/send-invoice/:invoiceId', staffPlus, wc.sendInvoiceWhatsApp);
router.post('/send-quotation/:quotationId', staffPlus, wc.sendQuotationWhatsApp);
router.get('/preview-invoice/:invoiceId', staffPlus, wc.previewInvoiceMessage);
router.get('/preview-quotation/:quotationId', staffPlus, wc.previewQuotationMessage);

router.post('/send-custom', requireMinRole('branch_manager'), wc.sendCustom);
router.get('/preview-loan/:loanId', staffPlus, wc.previewLoanMessage);
router.post('/send-loan-reminder/:loanId', staffPlus, wc.sendLoanReminder);

router.get('/logs', requireMinRole('branch_manager'), wc.listLogs);
router.get('/logs/invoice/:invoiceId', wc.logsForInvoice);

router.get('/templates', requireMinRole('company_admin'), wc.listTemplates);
router.patch('/templates/:id', requireMinRole('company_admin'), wc.updateTemplate);

module.exports = router;
