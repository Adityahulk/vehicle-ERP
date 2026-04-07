const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const cc = require('../controllers/customersController');

const router = Router();
router.use(verifyToken);

const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(1000).optional(),
  gstin: z.string().max(15).optional(),
});

router.post('/', validateBody(createCustomerSchema), cc.createCustomer);
router.get('/', cc.listCustomers);
router.get('/:id', cc.getCustomer);

module.exports = router;
