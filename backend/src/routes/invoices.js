const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const ic = require('../controllers/invoicesController');
const { generateInvoicePdf } = require('../services/pdfService');

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

const createInvoiceSchema = z.object({
  customer_id: z.string().uuid().optional(),
  customer: customerSchema.optional(),
  vehicle_id: z.string().uuid().optional(),
  items: z.array(itemSchema).min(1, 'At least one item required'),
  discount: z.number().int().min(0).optional().default(0),
  invoice_date: z.string().optional(),
  status: z.enum(['draft', 'confirmed']).optional().default('draft'),
  notes: z.string().max(2000).optional(),
}).refine(
  (d) => d.customer_id || d.customer,
  { message: 'Either customer_id or customer details required' },
);

router.post('/', validateBody(createInvoiceSchema), ic.createInvoice);
router.get('/', ic.listInvoices);
router.get('/:id', ic.getInvoice);
router.patch('/:id/cancel', requireMinRole('branch_manager'), ic.cancelInvoice);
router.patch('/:id/confirm', ic.confirmInvoice);

router.get('/:id/pdf', async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const data = await ic.fetchFullInvoice(req.params.id, company_id);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });

    const pdfBuffer = await generateInvoicePdf(data);
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

module.exports = router;
