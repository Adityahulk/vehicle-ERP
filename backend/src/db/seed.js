require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const DEMO_PASSWORD = 'Demo@1234';

const VEHICLE_DATA = [
  { chassis: 'MA3FJEB1S00123456', engine: 'K12MN1234567', make: 'Maruti Suzuki', model: 'Alto K10', variant: 'VXi', color: 'Silky Silver', year: 2024, purchase: 41500000, selling: 44900000 },
  { chassis: 'MA3EYD81S00234567', engine: 'K10BN2345678', make: 'Maruti Suzuki', model: 'WagonR', variant: 'ZXi+', color: 'Magma Grey', year: 2024, purchase: 62000000, selling: 66500000 },
  { chassis: 'MA3EYAB1S00345678', engine: 'K12CN3456789', make: 'Maruti Suzuki', model: 'Swift', variant: 'ZXi AMT', color: 'Pearl Arctic White', year: 2025, purchase: 72500000, selling: 78900000 },
  { chassis: 'MALA851CLMM567890', engine: 'DDiS4567890', make: 'Maruti Suzuki', model: 'Brezza', variant: 'ZXi+', color: 'Brave Khaki', year: 2025, purchase: 105000000, selling: 113900000 },
  { chassis: 'MA3FJE91S00456789', engine: 'K15CN5678901', make: 'Maruti Suzuki', model: 'Ertiga', variant: 'VXi CNG', color: 'Oxford Blue', year: 2024, purchase: 97500000, selling: 105900000 },
  { chassis: 'MAKE1AA1AAA678901', engine: 'G12B6789012', make: 'Toyota', model: 'Glanza', variant: 'V', color: 'Sporting Red', year: 2024, purchase: 75000000, selling: 82000000 },
  { chassis: 'MAKE2BB2BBB789012', engine: 'D13A7890123', make: 'Toyota', model: 'Urban Cruiser Hyryder', variant: 'V Hybrid', color: 'Cafe White', year: 2025, purchase: 130000000, selling: 141900000 },
  { chassis: 'MAKE3CC3CCC890123', engine: '2NRF8901234', make: 'Toyota', model: 'Innova Crysta', variant: 'GX 8S', color: 'Super White', year: 2024, purchase: 195000000, selling: 210000000 },
  { chassis: 'MH1KC1CDXPP901234', engine: 'KC15E9012345', make: 'Honda', model: 'City', variant: 'ZX CVT', color: 'Platinum White Pearl', year: 2025, purchase: 140000000, selling: 152900000 },
  { chassis: 'MH1RV1CE1PP012345', engine: 'L15BG012345', make: 'Honda', model: 'Elevate', variant: 'ZX CVT', color: 'Golden Brown', year: 2025, purchase: 155000000, selling: 167900000 },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Clean existing demo data ──────────────────────────
    const existingCompany = await client.query(
      `SELECT id FROM companies WHERE gstin = '27AABCD1234E1Z5' AND is_deleted = FALSE LIMIT 1`
    );
    if (existingCompany.rows.length > 0) {
      const cid = existingCompany.rows[0].id;
      await client.query(`DELETE FROM attendance WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM invoice_items WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM loans WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM invoices WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM quotations WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM expenses WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM vehicle_transfers WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM vehicles WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM customers WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM refresh_tokens WHERE company_id = $1`, [cid]);
      await client.query(`UPDATE branches SET manager_id = NULL WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM users WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM branches WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM companies WHERE id = $1`, [cid]);
    }

    // ── 1. Company ────────────────────────────────────────
    const { rows: [company] } = await client.query(
      `INSERT INTO companies (name, gstin, address, phone, email, state_code, default_hsn_code, default_gst_rate)
       VALUES ('Demo Motors Pvt Ltd', '27AABCD1234E1Z5',
               'Plot 42, Industrial Estate, Mapusa, Goa 403507',
               '9876543210', 'info@demomotors.com', '30', '8703', 28.00)
       RETURNING id`,
    );
    const companyId = company.id;

    // Self-reference for company_id
    await client.query(`UPDATE companies SET company_id = $1 WHERE id = $1`, [companyId]);

    // ── 2. Branches ───────────────────────────────────────
    const { rows: [mapusa] } = await client.query(
      `INSERT INTO branches (company_id, name, address, phone)
       VALUES ($1, 'Mapusa Branch', 'Shop 5, Municipal Market Road, Mapusa, Goa 403507', '9876543211')
       RETURNING id`,
      [companyId],
    );

    const { rows: [panaji] } = await client.query(
      `INSERT INTO branches (company_id, name, address, phone)
       VALUES ($1, 'Panaji Branch', '18th June Road, Near Old Secretariat, Panaji, Goa 403001', '9876543212')
       RETURNING id`,
      [companyId],
    );

    // ── 3. Users ──────────────────────────────────────────
    const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

    const { rows: [adminUser] } = await client.query(
      `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
       VALUES ($1, $2, 'Rajesh Naik', 'admin@demo.com', $3, '9876543210', 'company_admin')
       RETURNING id`,
      [companyId, mapusa.id, hash],
    );

    const { rows: [manager1] } = await client.query(
      `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
       VALUES ($1, $2, 'Priya Dessai', 'manager1@demo.com', $3, '9876543211', 'branch_manager')
       RETURNING id`,
      [companyId, mapusa.id, hash],
    );

    const { rows: [manager2] } = await client.query(
      `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
       VALUES ($1, $2, 'Amit Prabhu', 'manager2@demo.com', $3, '9876543215', 'branch_manager')
       RETURNING id`,
      [companyId, panaji.id, hash],
    );

    const { rows: [staff1] } = await client.query(
      `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
       VALUES ($1, $2, 'Suresh Kamat', 'staff1@demo.com', $3, '9876543213', 'staff')
       RETURNING id`,
      [companyId, mapusa.id, hash],
    );

    await client.query(
      `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
       VALUES ($1, $2, 'Meera Shetty', 'staff2@demo.com', $3, '9876543214', 'staff')`,
      [companyId, panaji.id, hash],
    );

    // Assign managers to branches
    await client.query(`UPDATE branches SET manager_id = $1 WHERE id = $2`, [manager1.id, mapusa.id]);
    await client.query(`UPDATE branches SET manager_id = $1 WHERE id = $2`, [manager2.id, panaji.id]);

    // ── 4. Vehicles ───────────────────────────────────────
    const vehicleIds = [];
    for (let i = 0; i < VEHICLE_DATA.length; i++) {
      const v = VEHICLE_DATA[i];
      const branchId = i < 6 ? mapusa.id : panaji.id;
      const insuranceExpiry = new Date();
      // Mix: some expiring soon, some far out
      if (i === 2) {
        insuranceExpiry.setDate(insuranceExpiry.getDate() + 15); // expiring in 15 days
      } else if (i === 7) {
        insuranceExpiry.setDate(insuranceExpiry.getDate() - 10); // already expired
      } else {
        insuranceExpiry.setMonth(insuranceExpiry.getMonth() + 6 + i);
      }

      const rtoDate = new Date();
      rtoDate.setMonth(rtoDate.getMonth() - (3 + i));

      const { rows: [vehicle] } = await client.query(
        `INSERT INTO vehicles
           (company_id, branch_id, chassis_number, engine_number, make, model, variant,
            color, year, purchase_price, selling_price, status,
            rto_number, rto_date, insurance_company, insurance_expiry, insurance_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          companyId, branchId, v.chassis, v.engine, v.make, v.model, v.variant,
          v.color, v.year, v.purchase, v.selling,
          i < 8 ? 'in_stock' : 'sold',
          `GA-${String(1 + i).padStart(2, '0')}-${String(1000 + i * 111)}`,
          rtoDate.toISOString().slice(0, 10),
          ['ICICI Lombard', 'HDFC ERGO', 'New India Assurance', 'Bajaj Allianz'][i % 4],
          insuranceExpiry.toISOString().slice(0, 10),
          `POL-${2024}${String(i + 1).padStart(6, '0')}`,
        ],
      );
      vehicleIds.push(vehicle.id);
    }

    // ── 5. Customers ──────────────────────────────────────
    const { rows: [customer1] } = await client.query(
      `INSERT INTO customers (company_id, name, phone, email, address, gstin)
       VALUES ($1, 'Vikram Sinai', '9823456701', 'vikram.sinai@email.com',
               'House 201, Dona Paula, Goa 403004', '30AABCV1234H1Z9')
       RETURNING id`,
      [companyId],
    );

    const { rows: [customer2] } = await client.query(
      `INSERT INTO customers (company_id, name, phone, email, address)
       VALUES ($1, 'Anita Fernandes', '9823456702', 'anita.f@email.com',
               'Flat 3B, Fontainhas, Panaji, Goa 403001')
       RETURNING id`,
      [companyId],
    );

    // ── 6. Invoices ───────────────────────────────────────
    // Invoice 1: confirmed sale of vehicle 9 (Honda City)
    const vehicle9 = vehicleIds[8];
    const inv1Subtotal = 152900000; // selling price in paise
    const inv1Cgst = Math.round(inv1Subtotal * 0.14);
    const inv1Sgst = Math.round(inv1Subtotal * 0.14);
    const inv1Total = inv1Subtotal + inv1Cgst + inv1Sgst;

    const { rows: [invoice1] } = await client.query(
      `INSERT INTO invoices
         (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
          subtotal, cgst_amount, sgst_amount, total, status)
       VALUES ($1, $2, 'INV-2025-0001', CURRENT_DATE - INTERVAL '15 days', $3, $4,
               $5, $6, $7, $8, 'confirmed')
       RETURNING id`,
      [companyId, panaji.id, customer1.id, vehicle9,
       inv1Subtotal, inv1Cgst, inv1Sgst, inv1Total],
    );

    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, company_id, description, hsn_code, quantity, unit_price,
          cgst_rate, sgst_rate, cgst_amount, sgst_amount, amount)
       VALUES ($1, $2, 'Honda City ZX CVT', '8703', 1, $3,
               14.00, 14.00, $4, $5, $6)`,
      [invoice1.id, companyId, inv1Subtotal, inv1Cgst, inv1Sgst, inv1Total],
    );

    // Invoice 2: confirmed sale of vehicle 10 (Honda Elevate)
    const vehicle10 = vehicleIds[9];
    const inv2Subtotal = 167900000;
    const inv2Cgst = Math.round(inv2Subtotal * 0.14);
    const inv2Sgst = Math.round(inv2Subtotal * 0.14);
    const inv2Total = inv2Subtotal + inv2Cgst + inv2Sgst;

    const { rows: [invoice2] } = await client.query(
      `INSERT INTO invoices
         (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
          subtotal, cgst_amount, sgst_amount, total, status)
       VALUES ($1, $2, 'INV-2025-0002', CURRENT_DATE - INTERVAL '5 days', $3, $4,
               $5, $6, $7, $8, 'confirmed')
       RETURNING id`,
      [companyId, mapusa.id, customer2.id, vehicle10,
       inv2Subtotal, inv2Cgst, inv2Sgst, inv2Total],
    );

    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, company_id, description, hsn_code, quantity, unit_price,
          cgst_rate, sgst_rate, cgst_amount, sgst_amount, amount)
       VALUES ($1, $2, 'Honda Elevate ZX CVT', '8703', 1, $3,
               14.00, 14.00, $4, $5, $6)`,
      [invoice2.id, companyId, inv2Subtotal, inv2Cgst, inv2Sgst, inv2Total],
    );

    // ── 7. Loan ───────────────────────────────────────────
    // Loan on invoice 1 — overdue for demo purposes
    const loanDueDate = new Date();
    loanDueDate.setDate(loanDueDate.getDate() - 5); // overdue by 5 days

    await client.query(
      `INSERT INTO loans
         (company_id, invoice_id, customer_id, bank_name, loan_amount,
          interest_rate, tenure_months, emi_amount, disbursement_date,
          due_date, penalty_per_day, total_penalty_accrued, status)
       VALUES ($1, $2, $3, 'HDFC Bank', 120000000, 8.50, 60, 2458900,
               CURRENT_DATE - INTERVAL '30 days', $4, 50000, 250000, 'overdue')`,
      [companyId, invoice1.id, customer1.id, loanDueDate.toISOString().slice(0, 10)],
    );

    // ── 8. Sample expenses ────────────────────────────────
    const expenseData = [
      { cat: 'Electricity', desc: 'April electricity bill - Mapusa showroom', amt: 850000, branch: mapusa.id, daysAgo: 3 },
      { cat: 'Tea/Coffee', desc: 'Monthly tea/coffee supplies', amt: 350000, branch: mapusa.id, daysAgo: 7 },
      { cat: 'Salary', desc: 'Part-time cleaner salary', amt: 1200000, branch: panaji.id, daysAgo: 1 },
      { cat: 'Maintenance', desc: 'AC repair - Panaji office', amt: 450000, branch: panaji.id, daysAgo: 10 },
      { cat: 'Transport', desc: 'Vehicle delivery transport', amt: 250000, branch: mapusa.id, daysAgo: 5 },
    ];

    for (const e of expenseData) {
      await client.query(
        `INSERT INTO expenses (company_id, branch_id, category, description, amount, expense_date, created_by)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - ($6 || ' days')::interval, $7)`,
        [companyId, e.branch, e.cat, e.desc, e.amt, String(e.daysAgo), staff1.id],
      );
    }

    // ── 9. Transfer record ────────────────────────────────
    // Transfer one vehicle from Mapusa to Panaji
    await client.query(
      `INSERT INTO vehicle_transfers
         (company_id, vehicle_id, from_branch_id, to_branch_id, transferred_by, notes, transferred_at)
       VALUES ($1, $2, $3, $4, $5, 'Rebalancing stock between branches', NOW() - INTERVAL '10 days')`,
      [companyId, vehicleIds[5], mapusa.id, panaji.id, adminUser.id],
    );

    await client.query('COMMIT');

    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════════╗');
    console.log('  ║            ✓ Seed Complete — Demo Motors              ║');
    console.log('  ╠═══════════════════════════════════════════════════════╣');
    console.log('  ║                                                       ║');
    console.log('  ║  Company : Demo Motors Pvt Ltd                        ║');
    console.log('  ║  GSTIN   : 27AABCD1234E1Z5                           ║');
    console.log('  ║                                                       ║');
    console.log('  ║  Branches: Mapusa Branch, Panaji Branch               ║');
    console.log('  ║  Vehicles: 10 (8 in stock, 2 sold)                   ║');
    console.log('  ║  Invoices: 2 confirmed                               ║');
    console.log('  ║  Loans   : 1 overdue                                 ║');
    console.log('  ║  Expenses: 5 sample entries                           ║');
    console.log('  ║                                                       ║');
    console.log('  ╠═══════════════════════════════════════════════════════╣');
    console.log('  ║  Login Credentials (all use password: Demo@1234)      ║');
    console.log('  ╠═══════════════════════════════════════════════════════╣');
    console.log('  ║  admin@demo.com    → company_admin                    ║');
    console.log('  ║  manager1@demo.com → branch_manager (Mapusa)          ║');
    console.log('  ║  manager2@demo.com → branch_manager (Panaji)          ║');
    console.log('  ║  staff1@demo.com   → staff (Mapusa)                   ║');
    console.log('  ║  staff2@demo.com   → staff (Panaji)                   ║');
    console.log('  ║                                                       ║');
    console.log('  ╚═══════════════════════════════════════════════════════╝');
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
