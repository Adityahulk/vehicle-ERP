const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const { query } = require('../config/db');
const { calculatePenalty } = require('../services/penaltyService');
const { insertPendingTask } = require('../services/whatsappPendingTasksService');
const { sendSMS } = require('../services/notificationService');

const QUEUE_NAME = 'loan-overdue-reminders';

const loanReminderQueue = new Queue(QUEUE_NAME, { connection: redis });

function reminderIntervalDays(overdueDays) {
  if (overdueDays <= 7) return 3;
  if (overdueDays <= 30) return 2;
  return 1;
}

function shouldSendReminder(lastSentStr, intervalDays) {
  if (!lastSentStr) return true;
  const last = new Date(`${String(lastSentStr).slice(0, 10)}T12:00:00.000Z`);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diff = Math.floor((todayUtc - last) / 86400000);
  return diff >= intervalDays;
}

function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function alertCompanyAdmins(companyId, summary) {
  const { rows } = await query(
    `SELECT phone, name FROM users
     WHERE company_id = $1 AND role IN ('company_admin', 'super_admin')
       AND is_deleted = FALSE AND is_active = TRUE AND phone IS NOT NULL AND phone <> ''`,
    [companyId],
  );
  const msg =
    `[MVG ERP] Loan reminder queue: processed ${summary.processed}, ` +
    `pending tasks created ${summary.tasksCreated}, skipped ${summary.skipped}.`;
  for (const u of rows) {
    await sendSMS(u.phone, msg).catch((e) =>
      console.error('[LoanReminderJob] Admin SMS failed:', e.message),
    );
  }
}

async function scheduleLoanReminderJob() {
  const existing = await loanReminderQueue.getRepeatableJobs();
  for (const job of existing) {
    await loanReminderQueue.removeRepeatableByKey(job.key);
  }

  await loanReminderQueue.add(
    'loan-overdue-reminders',
    {},
    {
      repeat: { pattern: '30 4 * * *' },
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 30 },
    },
  );

  console.log('[LoanReminderJob] Scheduled daily at 10:00 AM IST (04:30 UTC)');
}

function createLoanReminderWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log('[LoanReminderJob] Running overdue loan reminder task queue…');
      const { rows: loans } = await query(
        `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
                i.branch_id, v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number,
                b.phone AS branch_phone, co.name AS company_name
         FROM loans l
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN invoices i ON i.id = l.invoice_id
         LEFT JOIN vehicles v ON v.id = i.vehicle_id
         LEFT JOIN branches b ON b.id = i.branch_id
         JOIN companies co ON co.id = l.company_id
         WHERE l.is_deleted = FALSE
           AND l.status IN ('active', 'overdue')
           AND (l.due_date < CURRENT_DATE OR l.due_date = CURRENT_DATE + INTERVAL '7 days')
           AND c.phone IS NOT NULL AND TRIM(c.phone) <> ''`,
      );

      let processed = 0;
      let tasksCreated = 0;
      let skipped = 0;
      const failedCompanies = new Set();

      for (const loan of loans) {
        const calc = calculatePenalty(loan);
        let messageType = 'loan_overdue';

        if (calc.calendarDaysPastDue < 0) {
          if (calc.calendarDaysPastDue !== -7) continue;
          messageType = 'loan_due_soon';
          if (!shouldSendReminder(loan.last_reminder_sent, 7)) continue;
        } else if (calc.calendarDaysPastDue > 0) {
          const interval = reminderIntervalDays(calc.calendarDaysPastDue);
          if (!shouldSendReminder(loan.last_reminder_sent, interval)) continue;
        } else {
          continue;
        }

        processed += 1;
        const chassis = loan.chassis_number ? String(loan.chassis_number).slice(-6) : '';
        const titlePrefix = messageType === 'loan_due_soon' ? 'Payment due soon' : 'Loan overdue';
        const title = `${titlePrefix} — ${loan.customer_name || 'Customer'}`;

        try {
          await insertPendingTask({
            companyId: loan.company_id,
            branchId: loan.branch_id,
            loanId: loan.id,
            messageType,
            title,
            detail: `Due ${fmtDate(loan.due_date)}`,
            customerName: loan.customer_name,
            customerPhone: loan.customer_phone,
            meta: { source: 'loan_reminder_job' },
          });
          tasksCreated += 1;
        } catch (e) {
          console.error('[LoanReminderJob] insertPendingTask failed:', loan.id, e.message);
          failedCompanies.add(loan.company_id);
          skipped += 1;
        }

        await new Promise((r) => setTimeout(r, 50));
      }

      const summary = { processed, tasksCreated, skipped };
      console.log('[LoanReminderJob] Done:', summary);

      for (const cid of failedCompanies) {
        await alertCompanyAdmins(cid, summary).catch((e) =>
          console.error('[LoanReminderJob] Admin alert failed:', e.message),
        );
      }

      return summary;
    },
    { connection: redis },
  );

  worker.on('failed', (job, err) => {
    console.error('[LoanReminderJob] Job failed:', err.message);
  });

  return worker;
}

module.exports = {
  loanReminderQueue,
  scheduleLoanReminderJob,
  createLoanReminderWorker,
};
