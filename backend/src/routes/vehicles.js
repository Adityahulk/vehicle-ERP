const { Router } = require('express');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/role');
const vc = require('../controllers/vehiclesController');

const router = Router();

router.use(verifyToken);

// --- Schemas ---

const createVehicleSchema = z.object({
  chassis_number: z.string().min(1, 'Chassis number is required').max(50),
  engine_number: z.string().min(1, 'Engine number is required').max(50),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  variant: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  purchase_price: z.number().int().min(0).optional(),
  selling_price: z.number().int().min(0).optional(),
  status: z.enum(['in_stock', 'sold', 'transferred', 'scrapped']).optional(),
  branch_id: z.string().uuid().optional(),
  rto_number: z.string().max(20).optional(),
  rto_date: z.string().optional(),
  insurance_company: z.string().max(255).optional(),
  insurance_expiry: z.string().optional(),
  insurance_number: z.string().max(100).optional(),
});

const updateVehicleSchema = z.object({
  chassis_number: z.string().min(1).max(50).optional(),
  engine_number: z.string().min(1).max(50).optional(),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  variant: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  purchase_price: z.number().int().min(0).optional(),
  selling_price: z.number().int().min(0).optional(),
  status: z.enum(['in_stock', 'sold', 'transferred', 'scrapped']).optional(),
  branch_id: z.string().uuid().optional(),
  rto_number: z.string().max(20).optional(),
  rto_date: z.string().nullable().optional(),
  insurance_company: z.string().max(255).nullable().optional(),
  insurance_expiry: z.string().nullable().optional(),
  insurance_number: z.string().max(100).nullable().optional(),
});

const transferSchema = z.object({
  to_branch_id: z.string().uuid('Valid branch ID required'),
  notes: z.string().max(1000).optional(),
});

// --- Routes ---

router.get('/', vc.listVehicles);
router.post('/', validateBody(createVehicleSchema), vc.createVehicle);
router.get('/search', vc.searchVehicles);
router.get('/expiring-insurance', requireMinRole('branch_manager'), vc.expiringInsurance);
router.get('/inventory/summary', requireMinRole('branch_manager'), vc.inventorySummary);
router.get('/inventory/branch/:branchId', vc.branchInventory);
router.get('/:id', vc.getVehicle);
router.patch('/:id', requireMinRole('branch_manager'), validateBody(updateVehicleSchema), vc.updateVehicle);
router.post('/:id/transfer', requireMinRole('branch_manager'), validateBody(transferSchema), vc.transferVehicle);

module.exports = router;
