const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const { query } = require('../config/db');
const { sendTemplatedNotification } = require('../services/notificationService');
const { calculatePenalty } = require('../services/penaltyService');

const QUEUE_NAME = 'daily-reminders';

const reminderQueue = new Queue(QUEUE_NAME, { connection: redis });

// ────────────────────── Daily Loan Check (8 AM IST) ──────────────────────

async function processOverdueLoans() {
  const { rows: loans } = await query(
    `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
            v.chassis_number, b.phone AS branch_phone
     FROM loans l
     JOIN customers c ON c.id = l.customer_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN branches b ON b.id = i.branch_id
     WHERE l.status IN ('active', 'overdue')
       AND l.due_date < CURRENT_DATE
       AND l.is_deleted = FALSE`,
  );

  let notified = 0;

  for (const loan of loans) {
    const { overdue_days, penalty_amount } = calculatePenalty(loan);

    if (penalty_amount !== Number(loan.total_penalty_accrued)) {
      await query(
        `UPDATE loans SET total_penalty_accrued = $1, status = 'overdue' WHERE id = $2`,
        [penalty_amount, loan.id],
      );
    }

    if (loan.customer_phone) {
      await sendTemplatedNotification('LOAN_OVERDUE', {
        name: loan.customer_name,
        chassis: loan.chassis_number || 'N/A',
        days: overdue_days,
        penalty: (penalty_amount / 100).toFixed(2),
        branch_phone: loan.branch_phone || 'our office',
      }, loan.customer_phone);
      notified++;
    }
  }

  return { total: loans.length, notified };
}

// ────────────────────── Insurance Expiry Check (9 AM IST) ──────────────────────

async function processInsuranceExpiry() {
  const { rows: vehicles } = await query(
    `SELECT v.id, v.chassis_number, v.make, v.model, v.insurance_expiry,
            b.phone AS branch_phone,
            -- find customer from the last confirmed invoice for this vehicle
            c.name AS customer_name, c.phone AS customer_phone
     FROM vehicles v
     LEFT JOIN branches b ON b.id = v.branch_id
     LEFT JOIN LATERAL (
       SELECT inv.customer_id FROM invoices inv
       WHERE inv.vehicle_id = v.id AND inv.status = 'confirmed' AND inv.is_deleted = FALSE
       ORDER BY inv.invoice_date DESC LIMIT 1
     ) last_inv ON TRUE
     LEFT JOIN customers c ON c.id = last_inv.customer_id
     WHERE v.is_deleted = FALSE
       AND v.insurance_expiry IS NOT NULL
       AND v.insurance_expiry BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`,
  );

  let notified = 0;

  for (const vehicle of vehicles) {
    const phone = vehicle.customer_phone || vehicle.branch_phone;
    if (!phone) continue;

    const expiryDate = new Date(vehicle.insurance_expiry).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });

    await sendTemplatedNotification('INSURANCE_EXPIRY', {
      name: vehicle.customer_name || 'Customer',
      chassis: vehicle.chassis_number,
      date: expiryDate,
    }, phone);
    notified++;
  }

  return { total: vehicles.length, notified };
}

// ────────────────────── Schedule Both Jobs ──────────────────────

async function scheduleReminderJobs() {
  const existing = await reminderQueue.getRepeatableJobs();
  for (const job of existing) {
    await reminderQueue.removeRepeatableByKey(job.key);
  }

  // Daily loan check at 8:00 AM IST = 2:30 AM UTC
  await reminderQueue.add(
    'daily-loan-check',
    { type: 'loan_check' },
    {
      repeat: { pattern: '0 30 2 * * *' },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 50 },
    },
  );

  // Insurance expiry check at 9:00 AM IST = 3:30 AM UTC
  await reminderQueue.add(
    'insurance-expiry-check',
    { type: 'insurance_check' },
    {
      repeat: { pattern: '0 30 3 * * *' },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 50 },
    },
  );

  console.log('[ReminderJob] Loan check scheduled at 8:00 AM IST, insurance check at 9:00 AM IST');
}

// ────────────────────── Worker ──────────────────────

function createReminderWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { type } = job.data;

      if (type === 'loan_check') {
        console.log('[ReminderJob] Running daily loan check...');
        const result = await processOverdueLoans();
        console.log(`[ReminderJob] Loan check done: ${result.total} overdue, ${result.notified} notified`);
        return result;
      }

      if (type === 'insurance_check') {
        console.log('[ReminderJob] Running insurance expiry check...');
        const result = await processInsuranceExpiry();
        console.log(`[ReminderJob] Insurance check done: ${result.total} expiring, ${result.notified} notified`);
        return result;
      }

      console.warn(`[ReminderJob] Unknown job type: ${type}`);
      return { skipped: true };
    },
    { connection: redis },
  );

  worker.on('completed', (job, result) => {
    console.log(`[ReminderJob] ${job.name} completed:`, result);
  });

  worker.on('failed', (job, err) => {
    console.error(`[ReminderJob] ${job.name} failed:`, err.message);
  });

  return worker;
}

const reminderWorker = process.env.NODE_ENV !== 'production' ? createReminderWorker() : null;

module.exports = { reminderQueue, reminderWorker, scheduleReminderJobs, createReminderWorker };
