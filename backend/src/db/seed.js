try {
  require('dotenv').config();
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
  console.warn('[seed] dotenv not found — using process.env only. From host run: cd backend && npm install');
}

const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { seedDefaultLeaveTypes } = require('../services/leaveTypesService');
const { seedWhatsappTemplates } = require('../services/whatsappTemplatesSeed');
const { workingDatesInRange } = require('../controllers/attendanceLeaveController');

const DEMO_PASSWORD = 'VehicleERP@2026';

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
  { chassis: 'MA3XZE81S01111222', engine: 'K12AA1112223', make: 'Maruti Suzuki', model: 'Dzire', variant: 'ZXI+', color: 'Pearl Midnight Black', year: 2024, purchase: 68000000, selling: 72900000 },
  { chassis: 'MA3XZF91S02222333', engine: 'K12BB2223334', make: 'Maruti Suzuki', model: 'Baleno', variant: 'Alpha', color: 'Nexa Blue', year: 2025, purchase: 72000000, selling: 78900000 },
  { chassis: 'MA3XZG01S03333444', engine: 'K12CC3334445', make: 'Maruti Suzuki', model: 'Celerio', variant: 'ZXi+', color: 'Glistening Grey', year: 2024, purchase: 52000000, selling: 56900000 },
  { chassis: 'MA3XZH11S04444555', engine: 'K12DD4445556', make: 'Maruti Suzuki', model: 'Ignis', variant: 'Zeta', color: 'Pearl Arctic White', year: 2025, purchase: 58000000, selling: 62900000 },
  { chassis: 'MA3XZI21S05555666', engine: 'K12EE5556667', make: 'Maruti Suzuki', model: 'S-Presso', variant: 'VXi+', color: 'Solid Fire Red', year: 2024, purchase: 48000000, selling: 51900000 },
  { chassis: 'MA3XZJ31S06666777', engine: 'K12FF6667778', make: 'Maruti Suzuki', model: 'XL6', variant: 'Alpha+', color: 'Brave Khaki', year: 2025, purchase: 112000000, selling: 120900000 },
  { chassis: 'MAKE4DD4DDD777888', engine: 'M15AA7778889', make: 'Toyota', model: 'Fortuner', variant: '4x4 AT', color: 'Phantom Brown', year: 2024, purchase: 385000000, selling: 419900000 },
  { chassis: 'MAKE5EE5EEE888999', engine: 'M15BB8889900', make: 'Toyota', model: 'Camry', variant: 'Hybrid', color: 'Silver Metallic', year: 2025, purchase: 420000000, selling: 455900000 },
  { chassis: 'MH2KC2CDXPP999000', engine: 'KC16F9990001', make: 'Honda', model: 'Amaze', variant: 'VX CVT', color: 'Radiant Red', year: 2024, purchase: 72000000, selling: 78900000 },
  { chassis: 'MH2RV2CE2PP000111', engine: 'L15BH0001112', make: 'Honda', model: 'Jazz', variant: 'ZX', color: 'Lunar Silver', year: 2025, purchase: 88000000, selling: 94900000 },
  { chassis: 'MH3HY3HY3HY111222', engine: 'HY11A1112223', make: 'Hyundai', model: 'i20', variant: 'Asta', color: 'Polar White', year: 2025, purchase: 82000000, selling: 88900000 },
  { chassis: 'MH3HY4HY4HY222333', engine: 'HY22B2223334', make: 'Hyundai', model: 'Venue', variant: 'SX', color: 'Phantom Black', year: 2024, purchase: 98000000, selling: 105900000 },
  { chassis: 'MH3HY5HY5HY333444', engine: 'HY33C3334445', make: 'Hyundai', model: 'Creta', variant: 'SX(O)', color: 'Atlas White', year: 2025, purchase: 165000000, selling: 178900000 },
  { chassis: 'MH4TA4TA4TA444555', engine: 'TA44D4445556', make: 'Tata', model: 'Nexon', variant: 'XZ+', color: 'Daytona Grey', year: 2025, purchase: 112000000, selling: 120900000 },
  { chassis: 'MH4TA5TA5TA555666', engine: 'TA55E5556667', make: 'Tata', model: 'Punch', variant: 'Creative', color: 'Oxygen Blue', year: 2024, purchase: 72000000, selling: 78900000 },
  { chassis: 'MH5KI5KI5KI666777', engine: 'KI66F6667778', make: 'Kia', model: 'Sonet', variant: 'GTX+', color: 'Intense Red', year: 2025, purchase: 125000000, selling: 134900000 },
  { chassis: 'MH5KI6KI6KI777888', engine: 'KI77G7778889', make: 'Kia', model: 'Seltos', variant: 'GTX+', color: 'Gravity Grey', year: 2024, purchase: 168000000, selling: 181900000 },
  { chassis: 'MH6MG6MG6MG888999', engine: 'MG88H8889900', make: 'MG', model: 'Astor', variant: 'Savvy', color: 'Hunter Green', year: 2025, purchase: 142000000, selling: 152900000 },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Clean existing demo data (both legacy and current seed GSTINs) ──
    const existingCompanies = await client.query(
      `SELECT id FROM companies WHERE gstin IN ('27AABCD1234E1Z5', '07AASCM8531F1Z4') AND is_deleted = FALSE`
    );
    for (const { id: cid } of existingCompanies.rows) {
      await client.query(`DELETE FROM whatsapp_pending_tasks WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM whatsapp_logs WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM loan_penalty_log WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM eway_bills WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM leave_applications WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM leave_types WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM attendance WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM invoice_items WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM loans WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM invoices WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM quotation_items WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM quotations WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM expenses WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM vehicle_transfers WHERE company_id = $1`, [cid]);
      await client.query(`UPDATE vehicles SET purchase_order_id = NULL WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM purchase_receipts WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM purchase_orders WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM vehicles WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM customers WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM refresh_tokens WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM audit_logs WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM whatsapp_templates WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM invoice_templates WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM einvoice_tokens WHERE company_id = $1`, [cid]);
      await client.query(`UPDATE branches SET manager_id = NULL WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM salary_revisions WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM employee_profiles WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM users WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM branches WHERE company_id = $1`, [cid]);
      await client.query(`DELETE FROM companies WHERE id = $1`, [cid]);
    }

    // ── 1. Company ────────────────────────────────────────
    const { rows: [company] } = await client.query(
      `INSERT INTO companies (name, gstin, address, phone, email, state_code, default_hsn_code, default_gst_rate)
       VALUES (
 'MAVIDYA MVG PRADEEP GURU SYSTEM PRIVATE LIMITED',
         '07AASCM8531F1Z4',
         '1st Floor, 102, 52A, V81, Capital Tree, Jain Uniform Street, Nattu Sweets, Laxmi Nagar, Vijay Block, New Delhi - 110092',
         '626006629',
         'accounts@mavidya.com',
         '07',
         '8703',
         28.00
       )
       RETURNING id`,
    );
    const companyId = company.id;

    // Self-reference for company_id
    await client.query(`UPDATE companies SET company_id = $1 WHERE id = $1`, [companyId]);

    await client.query(
      `INSERT INTO invoice_templates (company_id, name, is_default, template_key, layout_config)
       VALUES
         ($1, 'GST Trade Invoice (full)', TRUE, 'trade',
          $2::jsonb),
         ($1, 'Standard GST Invoice', FALSE, 'standard',
          '{"show_logo": true, "logo_asset": "mvg_group", "show_signature": true, "signature_asset": "company_upload", "show_qr_code": false, "show_bank_details": false, "show_terms": true, "terms_text": "Goods once sold will not be taken back or exchanged. Subject to local jurisdiction.", "primary_color": "#1a56db", "font": "default", "header_style": "left-aligned", "show_vehicle_details_block": true, "show_loan_summary": false, "footer_text": "", "bank_details": ""}'::jsonb),
         ($1, 'Simple Invoice', FALSE, 'simple',
          '{"show_logo": false, "show_signature": true, "signature_asset": "company_upload", "show_qr_code": false, "show_bank_details": false, "show_terms": false, "terms_text": "", "primary_color": "#374151", "font": "default", "header_style": "left-aligned", "show_vehicle_details_block": true, "show_loan_summary": false, "footer_text": "", "bank_details": ""}'::jsonb),
         ($1, 'Rudra Green Legender (Proprietor)', FALSE, 'trade',
          $3::jsonb)`,
      [
        companyId,
        JSON.stringify({
          show_logo: true,
          logo_asset: 'mvg_group',
          show_signature: true,
          signature_asset: 'mavidya_director',
          signatory_title: 'Authorised Signatory',
          original_copy_label: 'ORIGINAL FOR RECIPIENT',
          ship_to_same_as_billing: true,
          show_bank_details: true,
          bank_details:
            'MAVIDYA MVG PRADEEP GURU SYSTEM PVT.LTD.\n'
            + 'SBI A/C NO. 20529090825 | IFSC SBIN0007085 | Branch: Swasthya Vihar, New Delhi\n'
            + 'RBL A/C No. 409002393507 | IFSC RATN0000296 | Branch: Daryaganj, New Delhi',
          show_terms: true,
          terms_text:
            '1) All subject to Delhi jurisdiction only.\n'
            + '2) Goods sold will not be taken back.\n'
            + '3) Interest will be recovered @24% p.a. on bills not paid on due date.',
          primary_color: '#000000',
          font: 'serif',
          header_style: 'left-aligned',
          show_vehicle_details_block: true,
          show_loan_summary: false,
          footer_text: '',
          computer_gen_subnote: 'E. & O. E.',
        }),
        JSON.stringify({
          show_logo: true,
          logo_asset: 'mvg_group',
          show_signature: true,
          signature_asset: 'rudra_proprietor',
          signatory_title: 'Proprietor',
          original_copy_label: 'ORIGINAL FOR RECIPIENT',
          ship_to_same_as_billing: true,
          show_bank_details: false,
          bank_details: '',
          show_terms: true,
          terms_text:
            '1) All subject to Madhya Pradesh jurisdiction.\n'
            + '2) Goods once sold will not be taken back.\n'
            + '3) E. & O. E.',
          primary_color: '#1e3a5f',
          font: 'default',
          header_style: 'left-aligned',
          show_vehicle_details_block: true,
          show_loan_summary: false,
          footer_text: '',
          computer_gen_subnote: 'E. & O. E.',
        }),
      ],
    );

    await seedWhatsappTemplates(companyId, client);

    // ── 2. Branches ───────────────────────────────────────
    const { rows: [mapusa] } = await client.query(
      `INSERT INTO branches (company_id, name, code, address, phone, city, state, pincode, state_code)
       VALUES ($1, 'MVG Delhi (Registered Office)', 'DEL',
 '1st Floor, 102, 52A, V81, Capital Tree, Jain Uniform Street, Laxmi Nagar, New Delhi - 110092',
               '626006629', 'New Delhi', 'Delhi', '110092', '07')
       RETURNING id`,
      [companyId],
    );

    const { rows: [panaji] } = await client.query(
      `INSERT INTO branches (company_id, name, code, address, phone, city, state, pincode, state_code)
       VALUES ($1, 'MVG Satna (Sales)', 'STN',
               'Word No 13 Kothi Main Road, Royani, Satna - 485666',
               '9876543212', 'Satna', 'Madhya Pradesh', '485666', '23')
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

    const { rows: [staff2] } = await client.query(
      `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
       VALUES ($1, $2, 'Meera Shetty', 'staff2@demo.com', $3, '9876543214', 'staff')
       RETURNING id`,
      [companyId, panaji.id, hash],
    );

    const { rows: [caUser] } = await client.query(
      `INSERT INTO users (company_id, branch_id, name, email, password_hash, phone, role)
       VALUES ($1, NULL, 'CA Ramesh Pai', 'ca@demo.com', $2, '9876543216', 'ca')
       RETURNING id`,
      [companyId, hash],
    );

    // Assign managers to branches
    await client.query(`UPDATE branches SET manager_id = $1 WHERE id = $2`, [manager1.id, mapusa.id]);
    await client.query(`UPDATE branches SET manager_id = $1 WHERE id = $2`, [manager2.id, panaji.id]);

    const { rows: epInserted } = await client.query(
      `INSERT INTO employee_profiles (
         company_id, user_id, employee_code, designation, department, joining_date,
         employment_type, probation_end_date, annual_salary, salary_type
       ) VALUES
         ($1, $2, 'EMP-MAP-001', 'Branch Operations Manager', 'Sales',
          (CURRENT_DATE - INTERVAL '3 years')::date, 'full_time',
          ((CURRENT_DATE - INTERVAL '3 years')::date + INTERVAL '90 days')::date,
          72000000, 'monthly'),
         ($1, $3, 'EMP-MAP-002', 'Branch Manager', 'Management',
          (CURRENT_DATE - INTERVAL '2 years')::date, 'full_time',
          ((CURRENT_DATE - INTERVAL '2 years')::date + INTERVAL '90 days')::date,
          54000000, 'monthly'),
         ($1, $4, 'EMP-MAP-003', 'Sales Executive', 'Sales',
          (CURRENT_DATE - INTERVAL '1 year')::date, 'full_time',
          ((CURRENT_DATE - INTERVAL '1 year')::date + INTERVAL '90 days')::date,
          24000000, 'monthly'),
         ($1, $5, 'EMP-STN-001', 'Branch Manager', 'Management',
          (CURRENT_DATE - INTERVAL '2 years')::date, 'full_time',
          ((CURRENT_DATE - INTERVAL '2 years')::date + INTERVAL '90 days')::date,
          54000000, 'monthly'),
         ($1, $6, 'EMP-STN-002', 'Sales Executive', 'Sales',
          (CURRENT_DATE - INTERVAL '1 year')::date, 'full_time',
          ((CURRENT_DATE - INTERVAL '1 year')::date + INTERVAL '90 days')::date,
          24000000, 'monthly'),
         ($1, $7, 'EMP-CA-001', 'Consultant', 'Finance',
          (CURRENT_DATE - INTERVAL '4 years')::date, 'full_time',
          ((CURRENT_DATE - INTERVAL '4 years')::date + INTERVAL '90 days')::date,
          120000000, 'monthly')
       RETURNING id, employee_code`,
      [companyId, adminUser.id, manager1.id, staff1.id, manager2.id, staff2.id, caUser.id],
    );
    const mgrProfile = epInserted.find((r) => r.employee_code === 'EMP-MAP-002');
    await client.query(
      `INSERT INTO salary_revisions (company_id, employee_id, effective_date, old_salary, new_salary, reason, revised_by)
       VALUES ($1, $2, (CURRENT_DATE - INTERVAL '6 months')::date, $3, $4, $5, $6)`,
      [companyId, mgrProfile.id, 49090909, 54000000, 'Annual increment (10%)', adminUser.id],
    );

    await seedDefaultLeaveTypes(companyId, client);

    const { rows: leaveTypeRows } = await client.query(
      `SELECT id, code FROM leave_types WHERE company_id = $1`,
      [companyId],
    );
    const ltByCode = Object.fromEntries(leaveTypeRows.map((r) => [r.code, r.id]));

    function rng(seed) {
      let x = Math.abs(seed) % 2147483646;
      if (x <= 0) x = 12345;
      return () => {
        x = (x * 16807) % 2147483647;
        return (x - 1) / 2147483646;
      };
    }

    function ymdAddDays(baseStr, delta) {
      const d = new Date(`${baseStr}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    }

    const todayUtc = new Date().toISOString().slice(0, 10);
    const attendanceUsers = [
      { id: adminUser.id, branchId: mapusa.id },
      { id: manager1.id, branchId: mapusa.id },
      { id: manager2.id, branchId: panaji.id },
      { id: staff1.id, branchId: mapusa.id },
      { id: staff2.id, branchId: panaji.id },
    ];

    for (let back = 29; back >= 0; back -= 1) {
      const dateStr = ymdAddDays(todayUtc, -back);
      const dow = new Date(`${dateStr}T12:00:00.000Z`).getUTCDay();
      if (dow === 0) continue;

      for (let ui = 0; ui < attendanceUsers.length; ui += 1) {
        const u = attendanceUsers[ui];
        const r = rng(u.id.charCodeAt(0) + back + ui * 17)();
        if (r < 0.8) {
          const r2 = rng(u.id.charCodeAt(1) + back)();
          const inMin = Math.floor(r2 * 46);
          const outMin = Math.floor(rng(back + 3)() * 46);
          const clockIn = `${dateStr}T${String(9 + Math.floor(inMin / 60)).padStart(2, '0')}:${String(inMin % 60).padStart(2, '0')}:00+05:30`;
          const clockOut = `${dateStr}T${String(18 + Math.floor(outMin / 60)).padStart(2, '0')}:${String(outMin % 60).padStart(2, '0')}:00+05:30`;
          await client.query(
            `INSERT INTO attendance (company_id, branch_id, user_id, date, clock_in, clock_out, status)
             VALUES ($1, $2, $3, $4::date, $5::timestamptz, $6::timestamptz, NULL)
             ON CONFLICT (user_id, date) WHERE is_deleted = FALSE DO NOTHING`,
            [companyId, u.branchId, u.id, dateStr, clockIn, clockOut],
          );
        } else if (r < 0.95) {
          /* absent — no row */
        } else {
          await client.query(
            `INSERT INTO attendance (company_id, branch_id, user_id, date, clock_in, clock_out, status)
             VALUES ($1, $2, $3, $4::date, NULL, NULL, 'on_leave')
             ON CONFLICT (user_id, date) WHERE is_deleted = FALSE
             DO UPDATE SET status = 'on_leave', clock_in = NULL, clock_out = NULL, updated_at = NOW()`,
            [companyId, u.branchId, u.id, dateStr],
          );
        }
      }
    }

    const clFrom = ymdAddDays(todayUtc, -10);
    const clTo = ymdAddDays(todayUtc, -8);
    const clDays = workingDatesInRange(clFrom, clTo).length;
    await client.query(
      `INSERT INTO leave_applications
         (company_id, branch_id, user_id, leave_type_id, from_date, to_date, total_days, half_day, reason, status,
          reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, FALSE, 'Family function', 'approved', $8, NOW())`,
      [companyId, mapusa.id, staff1.id, ltByCode.CL, clFrom, clTo, clDays, adminUser.id],
    );

    const slFrom = ymdAddDays(todayUtc, 5);
    const slTo = ymdAddDays(todayUtc, 7);
    const slDays = workingDatesInRange(slFrom, slTo).length;
    await client.query(
      `INSERT INTO leave_applications
         (company_id, branch_id, user_id, leave_type_id, from_date, to_date, total_days, half_day, reason, status)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, FALSE, 'Medical check-up', 'pending')`,
      [companyId, mapusa.id, staff1.id, ltByCode.SL, slFrom, slTo, slDays],
    );

    const mClFrom = ymdAddDays(todayUtc, -17);
    const mClTo = ymdAddDays(todayUtc, -15);
    const mClDays = workingDatesInRange(mClFrom, mClTo).length;
    await client.query(
      `INSERT INTO leave_applications
         (company_id, branch_id, user_id, leave_type_id, from_date, to_date, total_days, half_day, reason, status,
          reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, FALSE, 'Personal work', 'approved', $8, NOW())`,
      [companyId, mapusa.id, manager1.id, ltByCode.CL, mClFrom, mClTo, mClDays, adminUser.id],
    );

    async function applyApprovedLeaveToAttendance(userId, branchId, fromStr, toStr) {
      const dates = workingDatesInRange(fromStr, toStr);
      for (const ds of dates) {
        await client.query(
          `INSERT INTO attendance (company_id, branch_id, user_id, date, clock_in, clock_out, status)
           VALUES ($1, $2, $3, $4::date, NULL, NULL, 'on_leave')
           ON CONFLICT (user_id, date) WHERE is_deleted = FALSE
           DO UPDATE SET status = 'on_leave', clock_in = NULL, clock_out = NULL, updated_at = NOW()`,
          [companyId, branchId, userId, ds],
        );
      }
    }

    await applyApprovedLeaveToAttendance(staff1.id, mapusa.id, clFrom, clTo);
    await applyApprovedLeaveToAttendance(manager1.id, mapusa.id, mClFrom, mClTo);

    // ── 4. Vehicles ───────────────────────────────────────
    const soldCount = 8;
    const soldStartIndex = VEHICLE_DATA.length - soldCount;
    const vehicleIds = [];
    for (let i = 0; i < VEHICLE_DATA.length; i++) {
      const v = VEHICLE_DATA[i];
      const branchId = i % 2 === 0 ? mapusa.id : panaji.id;
      const insuranceExpiry = new Date();
      if (i === 2) {
        insuranceExpiry.setDate(insuranceExpiry.getDate() + 15);
      } else if (i === 15) {
        insuranceExpiry.setDate(insuranceExpiry.getDate() - 10);
      } else {
        insuranceExpiry.setMonth(insuranceExpiry.getMonth() + (6 + (i % 8)));
      }

      const rtoDate = new Date();
      rtoDate.setMonth(rtoDate.getMonth() - (3 + (i % 12)));

      const inStock = i < soldStartIndex;
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
          inStock ? 'in_stock' : 'sold',
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
    const CUSTOMER_ROWS = [
      ['Vikram Sinai', '9823456701', 'vikram.sinai@email.com', 'House 201, Sector 12, New Delhi 110092', '07AABCV1234H1Z9'],
      ['Anita Fernandes', '9823456702', 'anita.f@email.com', 'Flat 3B, Laxmi Nagar, Delhi 110092', null],
      ['Rohit Sharma', '9810011122', 'rohit.s@email.com', '42 MG Road, Satna 485666', '23AABCR5678F1Z2'],
      ['Priya Menon', '9845033344', 'priya.m@email.com', 'Plot 7, Civil Lines, Satna', null],
      ['Kiran Patel', '9876512345', 'kiran.p@email.com', 'Shop 12, Main Bazar, Delhi', '07AABCP9999E1Z1'],
      ['Deepak Nair', '9898765432', 'deepak.n@email.com', 'Villa 8, Royani, Satna', null],
      ['Sneha Reddy', '9123456780', 'sneha.r@email.com', 'Apt 4C, Dwarka, Delhi', null],
      ['Manoj Tiwari', '9988776655', 'manoj.t@email.com', 'House 9, Kothi Road, Satna', '23AABCT1111H1Z3'],
      ['Geeta Iyer', '9765432109', 'geeta.i@email.com', 'Office 15, Connaught Place, Delhi', null],
      ['Arjun Mehta', '9654321098', 'arjun.m@email.com', 'Warehouse Lane, Satna', null],
      ['Neha Kapoor', '9543210987', 'neha.k@email.com', 'Tower B, Laxmi Nagar, Delhi', '07AABCK2222L1Z4'],
      ['Vikas Rao', '9432109876', 'vikas.r@email.com', 'NH-7 Service Road, Satna', null],
    ];

    const customerIds = [];
    for (const [name, phone, email, address, gstin] of CUSTOMER_ROWS) {
      const { rows: [c] } = await client.query(
        gstin
          ? `INSERT INTO customers (company_id, name, phone, email, address, gstin)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
          : `INSERT INTO customers (company_id, name, phone, email, address)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        gstin ? [companyId, name, phone, email, address, gstin] : [companyId, name, phone, email, address],
      );
      customerIds.push(c.id);
    }

    function gstSplit(subtotalPaise) {
      const cgst = Math.round(subtotalPaise * 0.14);
      const sgst = Math.round(subtotalPaise * 0.14);
      return { cgst, sgst, total: subtotalPaise + cgst + sgst };
    }

    // ── 6. Invoices (8 confirmed sales + drafts + cancelled) ──
    const confirmedInvoiceIds = [];
    for (let k = 0; k < soldCount; k += 1) {
      const vIdx = soldStartIndex + k;
      const v = VEHICLE_DATA[vIdx];
      const vid = vehicleIds[vIdx];
      const custId = customerIds[k % customerIds.length];
      const branchId = vIdx % 2 === 0 ? mapusa.id : panaji.id;
      const subtotal = v.selling;
      const { cgst, sgst, total } = gstSplit(subtotal);
      const invNo = `INV-2025-${String(k + 1).padStart(4, '0')}`;
      const daysAgo = 5 + k * 12;

      const { rows: [inv] } = await client.query(
        `INSERT INTO invoices
           (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
            subtotal, cgst_amount, sgst_amount, igst_amount, total, status)
         VALUES ($1, $2, $3, CURRENT_DATE - ($4::integer * INTERVAL '1 day'), $5, $6,
                 $7, $8, $9, 0, $10, 'confirmed')
         RETURNING id`,
        [companyId, branchId, invNo, daysAgo, custId, vid, subtotal, cgst, sgst, total],
      );
      confirmedInvoiceIds.push(inv.id);

      await client.query(
        `INSERT INTO invoice_items
           (invoice_id, company_id, description, hsn_code, quantity, unit_price,
            cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount)
         VALUES ($1, $2, $3, '8703', 1, $4, 14, 14, 0, $5, $6, 0, $7)`,
        [inv.id, companyId, `${v.make} ${v.model} ${v.variant}`, subtotal, cgst, sgst, total],
      );
    }

    const draftSub = 50000000;
    const draftGst = gstSplit(draftSub);
    const { rows: [invDraft1] } = await client.query(
      `INSERT INTO invoices
         (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
          subtotal, cgst_amount, sgst_amount, igst_amount, total, status)
       VALUES ($1, $2, 'INV-2025-D001', CURRENT_DATE - 1, $3, NULL,
               $4, $5, $6, 0, $7, 'draft')
       RETURNING id`,
      [companyId, mapusa.id, customerIds[0], draftSub, draftGst.cgst, draftGst.sgst, draftGst.total],
    );
    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, company_id, description, hsn_code, quantity, unit_price,
          cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount)
       VALUES ($1, $2, 'Vehicle booking — pending allocation', '8703', 1, $3, 14, 14, 0, $4, $5, 0, $6)`,
      [invDraft1.id, companyId, draftSub, draftGst.cgst, draftGst.sgst, draftGst.total],
    );

    const { rows: [invCancel] } = await client.query(
      `INSERT INTO invoices
         (company_id, branch_id, invoice_number, invoice_date, customer_id, vehicle_id,
          subtotal, cgst_amount, sgst_amount, igst_amount, total, status)
       VALUES ($1, $2, 'INV-2025-X001', CURRENT_DATE - 40, $3, NULL,
               $4, $5, $6, 0, $7, 'cancelled')
       RETURNING id`,
      [companyId, panaji.id, customerIds[3], draftSub, draftGst.cgst, draftGst.sgst, draftGst.total],
    );
    await client.query(
      `INSERT INTO invoice_items
         (invoice_id, company_id, description, hsn_code, quantity, unit_price,
          cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount)
       VALUES ($1, $2, 'Cancelled booking', '8703', 1, $3, 14, 14, 0, $4, $5, 0, $6)`,
      [invCancel.id, companyId, draftSub, draftGst.cgst, draftGst.sgst, draftGst.total],
    );

    // ── 7. Loans (overdue, active, closed + extras) ─────────
    const overdueDue = new Date();
    overdueDue.setDate(overdueDue.getDate() - 8);
    await client.query(
      `INSERT INTO loans
         (company_id, invoice_id, customer_id, bank_name, loan_amount,
          interest_rate, tenure_months, emi_amount, disbursement_date,
          due_date, penalty_per_day, total_penalty_accrued, status, grace_period_days)
       VALUES ($1, $2, $3, 'HDFC Bank', 120000000, 8.50, 60, 2458900,
               CURRENT_DATE - INTERVAL '45 days', $4, 50000, 380000, 'overdue', 3)`,
      [companyId, confirmedInvoiceIds[0], customerIds[0], overdueDue.toISOString().slice(0, 10)],
    );

    const activeDue = new Date();
    activeDue.setDate(activeDue.getDate() + 20);
    await client.query(
      `INSERT INTO loans
         (company_id, invoice_id, customer_id, bank_name, loan_amount,
          interest_rate, tenure_months, emi_amount, disbursement_date,
          due_date, penalty_per_day, total_penalty_accrued, status, grace_period_days)
       VALUES ($1, $2, $3, 'ICICI Bank', 95000000, 9.00, 48, 2100000,
               CURRENT_DATE - INTERVAL '20 days', $4, 45000, 0, 'active', 5)`,
      [companyId, confirmedInvoiceIds[1], customerIds[1], activeDue.toISOString().slice(0, 10)],
    );

    await client.query(
      `INSERT INTO loans
         (company_id, invoice_id, customer_id, bank_name, loan_amount,
          interest_rate, tenure_months, emi_amount, disbursement_date,
          due_date, penalty_per_day, total_penalty_accrued, status)
       VALUES ($1, $2, $3, 'Axis Bank', 60000000, 8.75, 36, 1850000,
               CURRENT_DATE - INTERVAL '400 days', CURRENT_DATE - INTERVAL '30 days',
               40000, 0, 'closed')`,
      [companyId, confirmedInvoiceIds[2], customerIds[2]],
    );

    const od2 = new Date();
    od2.setDate(od2.getDate() - 3);
    await client.query(
      `INSERT INTO loans
         (company_id, invoice_id, customer_id, bank_name, loan_amount,
          interest_rate, tenure_months, emi_amount, disbursement_date,
          due_date, penalty_per_day, total_penalty_accrued, status, grace_period_days)
       VALUES ($1, $2, $3, 'SBI', 200000000, 8.25, 72, 4100000,
               CURRENT_DATE - INTERVAL '60 days', $4, 60000, 120000, 'overdue', 2)`,
      [companyId, confirmedInvoiceIds[3], customerIds[3], od2.toISOString().slice(0, 10)],
    );

    // ── 7b. WhatsApp pending-task queue (demo — matches loan reminder / penalty flows) ──
    // The daily job also creates these when Redis+worker run; seed inserts so UI can be tested without waiting.
    // branch_id is NULL so every branch_manager in the company sees these (listOpenTasksForUser OR branch match).
    const { rows: waLoans } = await client.query(
      `SELECT l.id, l.company_id, c.name AS customer_name, c.phone AS customer_phone, l.due_date
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
       JOIN invoices i ON i.id = l.invoice_id
       WHERE l.company_id = $1 AND l.status = 'overdue'
         AND l.is_deleted = FALSE
         AND l.due_date < CURRENT_DATE
         AND c.phone IS NOT NULL AND TRIM(c.phone) <> ''
       ORDER BY l.due_date ASC
       LIMIT 2`,
      [companyId],
    );
    const fmtDue = (d) => {
      if (!d) return 'N/A';
      return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    if (waLoans.length >= 1) {
      const L = waLoans[0];
      await client.query(
        `INSERT INTO whatsapp_pending_tasks (
           company_id, branch_id, loan_id, message_type, title, detail,
           customer_name, customer_phone, meta
         ) VALUES ($1, NULL, $2, 'loan_overdue', $3, $4, $5, $6, $7::jsonb)`,
        [
          L.company_id,
          L.id,
          `Loan overdue — ${L.customer_name}`,
          `Due ${fmtDue(L.due_date)}`,
          L.customer_name,
          L.customer_phone,
          JSON.stringify({ source: 'seed', note: 'demo loan_overdue queue item' }),
        ],
      );
    }
    if (waLoans.length >= 2) {
      const L = waLoans[1];
      await client.query(
        `INSERT INTO whatsapp_pending_tasks (
           company_id, branch_id, loan_id, message_type, title, detail,
           customer_name, customer_phone, meta
         ) VALUES ($1, NULL, $2, 'loan_penalty_alert', $3, $4, $5, $6, $7::jsonb)`,
        [
          L.company_id,
          L.id,
          `Penalty — ${L.customer_name}`,
          'Weekly penalty reminder (demo seed)',
          L.customer_name,
          L.customer_phone,
          JSON.stringify({ source: 'seed', note: 'demo loan_penalty_alert queue item', reason: 'every_7_days' }),
        ],
      );
    }

    // ── 8. Quotations (mixed statuses) ─────────────────────
    const qBranch = (i) => (i % 2 === 0 ? mapusa.id : panaji.id);
    const quotationSpecs = [
      ['QT-2025-0001', 'draft', customerIds[4], vehicleIds[3], 88900000],
      ['QT-2025-0002', 'sent', customerIds[5], vehicleIds[5], 105900000],
      ['QT-2025-0003', 'accepted', customerIds[6], null, 62900000],
      ['QT-2025-0004', 'expired', customerIds[7], vehicleIds[7], 120900000],
      ['QT-2025-0005', 'converted', customerIds[8], null, 51900000],
    ];

    for (let qi = 0; qi < quotationSpecs.length; qi += 1) {
      const [qnum, qstatus, custId, vehId, sub] = quotationSpecs[qi];
      const g = gstSplit(sub);
      const qDate = new Date();
      qDate.setDate(qDate.getDate() - qi * 2);
      const vu = new Date();
      if (qstatus === 'expired') vu.setDate(vu.getDate() - 10);
      else vu.setDate(vu.getDate() + 21);
      const convInvId = qstatus === 'converted' ? confirmedInvoiceIds[4] : null;
      const { rows: [qrow] } = await client.query(
        `INSERT INTO quotations (
           company_id, branch_id, quotation_number, quotation_date, valid_until_date,
           customer_id, vehicle_id, status,
           subtotal, discount_type, discount_value, discount_amount,
           cgst_amount, sgst_amount, igst_amount, total, prepared_by,
           converted_to_invoice_id, converted_at
         ) VALUES (
           $1, $2, $3, $4::date, $5::date,
           $6, $7, $8,
           $9, 'flat', 0, 0,
           $10, $11, 0, $12, $13,
           $14::uuid, CASE WHEN $14::uuid IS NOT NULL THEN NOW() ELSE NULL END
         ) RETURNING id`,
        [
          companyId, qBranch(qi), qnum,
          qDate.toISOString().slice(0, 10),
          vu.toISOString().slice(0, 10),
          custId, vehId, qstatus,
          sub, g.cgst, g.sgst, g.total, staff1.id,
          convInvId,
        ],
      );
      await client.query(
        `INSERT INTO quotation_items (
           quotation_id, company_id, item_type, description, hsn_code, quantity, unit_price,
           discount_type, discount_value, discount_amount,
           cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, amount, sort_order
         ) VALUES (
           $1, $2, 'vehicle', $3, '8703', 1, $4,
           'none', 0, 0,
           14, 14, 0, $5, $6, 0, $7, 0
         )`,
        [qrow.id, companyId, `Quotation line — ${qnum}`, sub, g.cgst, g.sgst, g.total],
      );
    }

    // ── 9. Sample expenses (more rows) ───────────────────
    const expenseData = [
      { cat: 'Electricity', desc: 'Showroom electricity — Delhi', amt: 850000, branch: mapusa.id, daysAgo: 3 },
      { cat: 'Tea/Coffee', desc: 'Pantry supplies', amt: 350000, branch: mapusa.id, daysAgo: 7 },
      { cat: 'Salary', desc: 'Support staff wages', amt: 1200000, branch: panaji.id, daysAgo: 1 },
      { cat: 'Maintenance', desc: 'AC servicing — Satna', amt: 450000, branch: panaji.id, daysAgo: 10 },
      { cat: 'Transport', desc: 'PDI transport charges', amt: 250000, branch: mapusa.id, daysAgo: 5 },
      { cat: 'Marketing', desc: 'Local newspaper ads', amt: 1800000, branch: mapusa.id, daysAgo: 14 },
      { cat: 'IT', desc: 'Internet + software renewals', amt: 220000, branch: panaji.id, daysAgo: 2 },
      { cat: 'Rent', desc: 'Branch rent advance', amt: 4500000, branch: panaji.id, daysAgo: 30 },
      { cat: 'Insurance', desc: 'Fire insurance policy', amt: 190000, branch: mapusa.id, daysAgo: 60 },
      { cat: 'Stationery', desc: 'Office stationery Q1', amt: 85000, branch: mapusa.id, daysAgo: 8 },
      { cat: 'Fuel', desc: 'Test-drive fuel', amt: 420000, branch: panaji.id, daysAgo: 4 },
      { cat: 'Legal', desc: 'Registration assistance fees', amt: 150000, branch: mapusa.id, daysAgo: 18 },
      { cat: 'Canteen', desc: 'Staff meals subsidy', amt: 95000, branch: panaji.id, daysAgo: 6 },
      { cat: 'Security', desc: 'Security agency — March', amt: 880000, branch: mapusa.id, daysAgo: 11 },
      { cat: 'Cleaning', desc: 'Deep cleaning — showroom', amt: 320000, branch: panaji.id, daysAgo: 9 },
      { cat: 'Training', desc: 'Sales training workshop', amt: 650000, branch: mapusa.id, daysAgo: 22 },
      { cat: 'Uniforms', desc: 'Staff uniforms', amt: 275000, branch: panaji.id, daysAgo: 16 },
      { cat: 'Misc', desc: 'Bank charges & petty cash', amt: 125000, branch: mapusa.id, daysAgo: 1 },
    ];

    for (const e of expenseData) {
      await client.query(
        `INSERT INTO expenses (company_id, branch_id, category, description, amount, expense_date, created_by)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - ($6::integer * INTERVAL '1 day'), $7)`,
        [companyId, e.branch, e.cat, e.desc, e.amt, e.daysAgo, staff1.id],
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

    // ── 10. E-Way Bill (first confirmed sale) ─────────
    const ewayInvoiceId = confirmedInvoiceIds[0];
    const ewayVehicleId = vehicleIds[soldStartIndex];
    await client.query(
      `INSERT INTO eway_bills
         (company_id, reference_type, reference_id, vehicle_id, eway_bill_number, generated_json, status, valid_from, valid_until, distance_km)
       VALUES ($1, 'sale', $2, $3, '331400123456', '{"sample": "data"}', 'submitted', NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 day', 15)`,
      [companyId, ewayInvoiceId, ewayVehicleId],
    );

    await client.query('COMMIT');

    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════════╗');
    console.log('  ║         ✓ Seed Complete — Mavidya Group (MVG)         ║');
    console.log('  ╠═══════════════════════════════════════════════════════╣');
    console.log('  ║                                                       ║');
    console.log('  ║  Company : MAVIDYA MVG PRADEEP GURU SYSTEM PVT LTD    ║');
    console.log('  ║  GSTIN   : 07AASCM8531F1Z4                           ║');
    console.log('  ║                                                       ║');
    console.log('  ║  Branches: MVG Delhi (RO), MVG Satna (Sales)          ║');
    console.log(`  ║  Vehicles: ${VEHICLE_DATA.length} (${VEHICLE_DATA.length - soldCount} in stock, ${soldCount} sold)              ║`);
    console.log(`  ║  Customers: ${CUSTOMER_ROWS.length} · Invoices: ${soldCount} confirmed + draft + cancelled ║`);
    console.log('  ║  Loans   : 4 (overdue, active, closed mix)            ║');
    console.log('  ║  Quotations: 5 · Expenses: 18 · WhatsApp queue: 2 demo tasks ║');
    console.log('  ║                                                       ║');
    console.log('  ╠═══════════════════════════════════════════════════════╣');
    console.log('  ║  Login credentials (all use password: VehicleERP@2026) ║');
    console.log('  ╠═══════════════════════════════════════════════════════╣');
    console.log('  ║  admin@demo.com    → company_admin                    ║');
    console.log('  ║  manager1@demo.com → branch_manager (MVG Mapusa)      ║');
    console.log('  ║  manager2@demo.com → branch_manager (MVG Panaji)      ║');
    console.log('  ║  staff1@demo.com   → staff (MVG Mapusa)               ║');
    console.log('  ║  staff2@demo.com   → staff (MVG Panaji)               ║');
    console.log('  ║  ca@demo.com       → ca (Chartered Accountant)        ║');
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
