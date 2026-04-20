const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole, requireNotRole } = require('../middleware/role');
const ic = require('../controllers/invoicesController');
const {
  generateInvoicePdf,
  generateInvoiceHtmlForPreview,
  attachInvoiceBarcodeDataUri,
} = require('../services/pdfService');
const {
  fetchInvoiceTemplateRow,
  buildDummyInvoiceData,
  buildStandardInvoiceHtml,
} = require('../services/invoiceTemplateRender');
const taxPro = require('../services/taxProService');
const { query } = require('../config/db');
const { logAudit } = require('../middleware/auditLog');

const router = Router();
router.use(verifyToken);

const customerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  gstin: z.string().max(15).optional(),
});

const itemSchema = z.object({
  description: z.string().min(1, 'Item description required'),
  hsn_code: z.string().max(20).optional(),
  quantity: z.number().int().min(1).optional().default(1),
  unit_price: z.number().int().min(0, 'Unit price in paise'),
  gst_rate: z.number().min(0).max(100).optional(),
});

const PAISE_HINT_LOAN =
  'penalty_per_day must be integer paise (UI sends rupees × 100).';

const invoiceLoanBodySchema = z
  .object({
    bank_name: z.string().min(1, 'Bank name required').max(255),
    loan_amount: z.number().int().min(1, 'Loan amount in paise'),
    interest_rate: z.number().min(0).max(100),
    tenure_months: z.number().int().min(1).max(360),
    disbursement_date: z.string().min(1, 'Disbursement date required'),
    penalty_per_day: z
      .number({ invalid_type_error: PAISE_HINT_LOAN })
      .int(PAISE_HINT_LOAN)
      .min(0, PAISE_HINT_LOAN),
    grace_period_days: z.number().int().min(0, 'grace_period_days must be >= 0'),
    penalty_cap: z.number().int().min(0).optional().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.penalty_per_day > 0 && data.penalty_per_day < 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Daily penalty must be 0 or at least ₹1/day (100 paise)',
        path: ['penalty_per_day'],
      });
    }
  });

const createInvoiceSchema = z.object({
  customer_id: z.string().uuid().optional(),
  customer: customerSchema.optional(),
  vehicle_id: z.string().uuid().optional(),
  items: z.array(itemSchema).min(1, 'At least one item required'),
  discount: z.number().int().min(0).optional().default(0),
  invoice_date: z.string().optional(),
  status: z.enum(['draft', 'confirmed']).optional().default('draft'),
  notes: z.string().max(2000).optional(),
  loan: invoiceLoanBodySchema.optional(),
}).refine(
  (d) => d.customer_id || d.customer,
  { message: 'Either customer_id or customer details required' },
).refine(
  (d) => !d.loan || d.status === 'confirmed',
  { message: 'Loan can only be added when confirming the sale, not for drafts', path: ['loan'] },
);

// Static paths must be before /:id
router.get('/preview-template', requireMinRole('company_admin'), async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const row = await fetchInvoiceTemplateRow(company_id, req.query.templateId || undefined);
    const data = buildDummyInvoiceData();
    data.invoice.company_id = company_id;
    const { rows: coRows } = await query(
      `SELECT name, gstin, address, phone, email, logo_url, signature_url FROM companies WHERE id = $1 AND is_deleted = FALSE`,
      [company_id],
    );
    if (coRows[0]) {
      const c = coRows[0];
      Object.assign(data.invoice, {
        company_name: c.name,
        company_gstin: c.gstin,
        company_address: c.address,
        company_phone: c.phone,
        company_email: c.email,
        logo_url: c.logo_url,
        signature_url: c.signature_url,
      });
    }
    const withBarcode = await attachInvoiceBarcodeDataUri(data);
    const html = buildStandardInvoiceHtml(withBarcode, row);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('preview-template failed:', err);
    res.status(500).send('Template preview failed');
  }
});

// TaxPro e-invoice status must be before /:id routes to avoid param collision
router.get('/einvoice/status', (_req, res) => {
  res.json({
    enabled: taxPro.isTaxProEinvoiceEnabled(),
    ewayConfigured: taxPro.isTaxProEnabled(),
    environment: process.env.TAXPRO_ENV || 'sandbox',
  });
});

router.post('/', requireNotRole('ca'), validateBody(createInvoiceSchema), ic.createInvoice);
router.get('/', ic.listInvoices);

router.get('/:id/preview', async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const denied = await ic.invoiceBranchAccessError(req, req.params.id);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    const data = await ic.fetchFullInvoice(req.params.id, company_id);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });
    const html = await generateInvoiceHtmlForPreview(
      data,
      company_id,
      req.query.templateId || undefined,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Invoice HTML preview failed:', err);
    res.status(500).json({ error: 'Preview generation failed' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const denied = await ic.invoiceBranchAccessError(req, req.params.id);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    const data = await ic.fetchFullInvoice(req.params.id, company_id);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });

    const pdfBuffer = await generateInvoicePdf(
      data,
      company_id,
      req.query.templateId || null,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.invoice.invoice_number}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

router.get('/:id', ic.getInvoice);
router.patch('/:id/cancel', requireNotRole('ca'), requireMinRole('branch_manager'), ic.cancelInvoice);
router.patch('/:id/confirm', requireNotRole('ca'), ic.confirmInvoice);

// ─── E-Invoice (TaxPro) Routes ───────────────────────────

router.post('/:id/einvoice/generate', requireNotRole('ca'), requireMinRole('branch_manager'), async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const invoiceId = req.params.id;
    const denied = await ic.invoiceBranchAccessError(req, invoiceId);
    if (denied) return res.status(denied.status).json({ success: false, error: denied.error });

    if (!taxPro.isTaxProEinvoiceEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'TaxPro e-invoice is not configured. Set TAXPRO_ASPID, TAXPRO_PASSWORD, TAXPRO_EINV_USER_NAME, and TAXPRO_EINV_PASSWORD (see .env.example).',
      });
    }

    const { rows: invData } = await query(
      `SELECT i.*,
       co.name AS company_name, co.gstin AS company_gstin, co.address AS company_address,
       co.phone AS company_phone, co.email AS company_email,
       c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
       c.address AS customer_address, c.gstin AS customer_gstin,
       agg.items
       FROM invoices i
       INNER JOIN companies co ON co.id = i.company_id AND co.is_deleted = FALSE
       INNER JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id AND c.is_deleted = FALSE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'description', ii.description,
           'hsn_code', ii.hsn_code,
           'quantity', ii.quantity,
           'unit_price', ii.unit_price,
           'cgst_rate', ii.cgst_rate,
           'sgst_rate', ii.sgst_rate,
           'igst_rate', ii.igst_rate,
           'cgst_amount', ii.cgst_amount,
           'sgst_amount', ii.sgst_amount,
           'igst_amount', ii.igst_amount
         ) ORDER BY ii.created_at) AS items
         FROM invoice_items ii
         WHERE ii.invoice_id = i.id AND ii.is_deleted = FALSE
       ) agg ON TRUE
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = FALSE`,
      [invoiceId, company_id],
    );

    if (invData.length === 0) return res.status(404).json({ success: false, error: 'Invoice not found' });
    const invoice = invData[0];
    if (!invoice.items || !invoice.items.length) {
      return res.status(400).json({ success: false, error: 'Invoice has no line items' });
    }

    if (invoice.status !== 'confirmed') {
      return res.status(400).json({ success: false, error: 'Only confirmed invoices can generate e-invoice' });
    }

    if (invoice.irn_status === 'generated') {
      return res.status(400).json({ success: false, error: 'E-Invoice already generated', irn: invoice.irn });
    }

    const result = await taxPro.generateIRN(company_id, { invoice, items: invoice.items });

    await query(
      `UPDATE invoices SET irn = $1, ack_number = $2, ack_date = $3, irn_date = $3, signed_qr = $4, signed_invoice = $5, irn_status = 'generated'
       WHERE id = $6 AND company_id = $7`,
      [result.irn, result.ackNumber, result.ackDate, result.signedQr, result.signedInvoice, invoiceId, company_id],
    );

    logAudit({ companyId: company_id, userId: req.user.id, action: 'create', entity: 'einvoice', entityId: invoiceId, newValue: { irn: result.irn, ackNumber: result.ackNumber }, req });

    res.json({
      success: true,
      data: {
        irn: result.irn,
        ack_number: result.ackNumber,
        ack_date: result.ackDate,
        irn_status: 'generated',
      },
    });
  } catch (err) {
    console.error('E-Invoice generation failed:', err.message);

    await query(
      `UPDATE invoices SET irn_status = 'failed' WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id],
    ).catch(() => {});

    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/einvoice/cancel', requireNotRole('ca'), requireMinRole('branch_manager'), async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const invoiceId = req.params.id;
    const { reason, remark } = req.body || {};
    const denied = await ic.invoiceBranchAccessError(req, invoiceId);
    if (denied) return res.status(denied.status).json({ success: false, error: denied.error });

    const { rows: inv } = await query(
      `SELECT i.id, i.irn, i.irn_status, i.irn_date, co.gstin AS company_gstin
       FROM invoices i
       INNER JOIN companies co ON co.id = i.company_id AND co.is_deleted = FALSE
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = FALSE`,
      [invoiceId, company_id],
    );
    if (inv.length === 0) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (!inv[0].irn || inv[0].irn_status !== 'generated') {
      return res.status(400).json({ success: false, error: 'No active e-invoice to cancel' });
    }

    const hoursSinceGeneration = (Date.now() - new Date(inv[0].irn_date).getTime()) / (1000 * 60 * 60);
    if (hoursSinceGeneration > 24) {
      return res.status(400).json({ success: false, error: 'E-invoice can only be cancelled within 24 hours of generation' });
    }

    const result = await taxPro.cancelIRN(company_id, inv[0].irn, reason, remark, inv[0].company_gstin);

    await query(
      `UPDATE invoices SET irn_status = 'cancelled', irn_cancel_date = $1, irn_cancel_reason = $2
       WHERE id = $3 AND company_id = $4`,
      [result.cancelDate, remark || 'Cancelled', invoiceId, company_id],
    );

    logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'einvoice', entityId: invoiceId, oldValue: { irn_status: 'generated' }, newValue: { irn_status: 'cancelled' }, req });

    res.json({ success: true, data: { irn_status: 'cancelled', cancel_date: result.cancelDate } });
  } catch (err) {
    console.error('E-Invoice cancellation failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/einvoice', async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const denied = await ic.invoiceBranchAccessError(req, req.params.id);
    if (denied) return res.status(denied.status).json({ success: false, error: denied.error });
    const { rows } = await query(
      `SELECT irn, irn_date, ack_number, ack_date, irn_status, signed_qr, irn_cancel_date, irn_cancel_reason
       FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, company_id],
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Invoice not found' });

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── E-Way Bill (TaxPro) Routes ───────────────────────────

router.post('/:id/ewaybill/generate', requireNotRole('ca'), requireMinRole('branch_manager'), async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const invoiceId = req.params.id;
    const denied = await ic.invoiceBranchAccessError(req, invoiceId);
    if (denied) return res.status(denied.status).json({ success: false, error: denied.error });

    if (!taxPro.isTaxProEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'TaxPro e-way bill is not configured. Set TAXPRO_EWB_USER_NAME and TAXPRO_EWB_PASSWORD in addition to ASP credentials (see .env.example).',
      });
    }

    const transportArgs = req.body;
    if (!transportArgs.distance_km || !transportArgs.transporter_id || !transportArgs.vehicle_no) {
      return res.status(400).json({ success: false, error: 'distance_km, transporter_id, and vehicle_no are required' });
    }

    const { rows: inv } = await query(
      `SELECT i.id, i.irn, i.irn_status, i.eway_bill_no, co.gstin AS company_gstin,
       co.name AS company_name, co.address AS company_address,
       c.name AS customer_name, c.address AS customer_address, c.gstin AS customer_gstin
       FROM invoices i
       INNER JOIN companies co ON co.id = i.company_id AND co.is_deleted = FALSE
       INNER JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id AND c.is_deleted = FALSE
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = FALSE`,
      [invoiceId, company_id],
    );

    if (inv.length === 0) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (!inv[0].irn || inv[0].irn_status !== 'generated') return res.status(400).json({ success: false, error: 'Generate IRN before E-way bill' });
    if (inv[0].eway_bill_no) return res.status(400).json({ success: false, error: 'E-Way bill already generated', ewbNo: inv[0].eway_bill_no });

    const result = await taxPro.generateEwayBill(
      company_id,
      inv[0].irn,
      transportArgs,
      inv[0].company_gstin,
      {
        companyName: inv[0].company_name,
        companyAddress: inv[0].company_address,
        customerName: inv[0].customer_name,
        customerAddress: inv[0].customer_address,
        customerGstin: inv[0].customer_gstin,
      },
    );

    await query(
      `UPDATE invoices SET eway_bill_no = $1, eway_bill_date = $2, eway_bill_valid_until = $3, eway_bill_status = 'generated',
       transporter_id = $4, transporter_name = $5, vehicle_no = $6, transport_mode = $7, distance_km = $8
       WHERE id = $9 AND company_id = $10`,
      [result.ewbNo, result.ewbDt, result.validUpto, transportArgs.transporter_id, transportArgs.transporter_name, transportArgs.vehicle_no, transportArgs.transport_mode, transportArgs.distance_km, invoiceId, company_id],
    );

    logAudit({ companyId: company_id, userId: req.user.id, action: 'create', entity: 'eway_bill', entityId: invoiceId, newValue: { eway_bill_no: result.ewbNo }, req });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('EWP generation failed:', err.message);
    await query(`UPDATE invoices SET eway_bill_status = 'failed', eway_bill_error = $1 WHERE id = $2 AND company_id = $3`, [err.message, req.params.id, req.user.company_id]).catch(() => {});
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/ewaybill/cancel', requireNotRole('ca'), requireMinRole('branch_manager'), async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const invoiceId = req.params.id;
    const { reason, remark } = req.body || {};
    const denied = await ic.invoiceBranchAccessError(req, invoiceId);
    if (denied) return res.status(denied.status).json({ success: false, error: denied.error });

    const { rows: inv } = await query(
      `SELECT i.eway_bill_no, i.eway_bill_status, co.gstin AS company_gstin
       FROM invoices i
       INNER JOIN companies co ON co.id = i.company_id AND co.is_deleted = FALSE
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = FALSE`,
      [invoiceId, company_id],
    );
    if (inv.length === 0) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (!inv[0].eway_bill_no || inv[0].eway_bill_status !== 'generated') {
      return res.status(400).json({ success: false, error: 'No active E-Way bill to cancel' });
    }

    const result = await taxPro.cancelEwayBill(
      company_id,
      inv[0].eway_bill_no,
      reason,
      remark,
      inv[0].company_gstin,
    );

    await query(
      `UPDATE invoices SET eway_bill_status = 'cancelled' WHERE id = $1 AND company_id = $2`,
      [invoiceId, company_id],
    );

    logAudit({ companyId: company_id, userId: req.user.id, action: 'update', entity: 'eway_bill', entityId: invoiceId, oldValue: { eway_bill_status: 'generated' }, newValue: { eway_bill_status: 'cancelled' }, req });

    res.json({ success: true, data: { eway_bill_status: 'cancelled', cancel_date: result.cancelDate } });
  } catch (err) {
    console.error('E-Way cancellation failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
