const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const qc = require('../controllers/quotationsController');

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
  description: z.string().min(1),
  hsn_code: z.string().max(20).optional(),
  quantity: z.number().int().min(1).optional().default(1),
  unit_price: z.number().int().min(0),
  gst_rate: z.number().min(0).max(100).optional(),
});

const createQuotationSchema = z.object({
  customer_id: z.string().uuid().optional(),
  customer: customerSchema.optional(),
  vehicle_id: z.string().uuid().optional(),
  items: z.array(itemSchema).min(1),
  discount: z.number().int().min(0).optional().default(0),
  valid_until: z.string().optional(),
}).refine(
  (d) => d.customer_id || d.customer,
  { message: 'Either customer_id or customer details required' },
);

router.post('/', validateBody(createQuotationSchema), qc.createQuotation);
router.get('/', qc.listQuotations);
router.get('/:id', qc.getQuotation);
router.post('/:id/convert', qc.convertToInvoice);

module.exports = router;
