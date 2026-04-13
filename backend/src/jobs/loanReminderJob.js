const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const { query } = require('../config/db');
const { calculatePenalty } = require('../services/penaltyService');
const { sendWhatsApp, sendCustomMessage } = require('../services/whatsappService');

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

function fmtRupees(paise) {
  return (Number(paise || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function handlePenaltyMilestone(data) {
  const { loanId, reason } = data;
  const { rows } = await query(
    `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
            v.make AS vehicle_make, v.model AS vehicle_model, v.chassis_number,
            b.phone AS branch_phone, co.name AS company_name
     FROM loans l
     JOIN customers c ON c.id = l.customer_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     LEFT JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN branches b ON b.id = i.branch_id
     JOIN companies co ON co.id = l.company_id
     WHERE l.id = $1 AND l.is_deleted = FALSE`,
    [loanId],
  );
  if (rows.length === 0) return { skipped: true, reason: 'loan_not_found' };
  const loan = rows[0];
  if (!loan.customer_phone || !String(loan.customer_phone).trim()) {
    return { skipped: true, reason: 'no_phone' };
  }

  const calc = calculatePenalty(loan);
  const chassis = loan.chassis_number ? String(loan.chassis_number).slice(-6) : '';
  const vehicle = [loan.vehicle_make, loan.vehicle_model, chassis && `…${chassis}`]
    .filter(Boolean)
    .join(' ') || 'N/A';

  const variables = {
    customer_name: loan.customer_name || 'Customer',
    vehicle,
    due_date: fmtDate(loan.due_date),
    overdue_days: String(calc.calendarDaysPastDue),
    penalty: fmtRupees(calc.netPenalty),
    penalty_per_day: fmtRupees(calc.penaltyPerDay),
    branch_phone: loan.branch_phone || 'N/A',
    company_name: loan.company_name || 'Our dealership',
  };

  const result = await sendWhatsApp({
    companyId: loan.company_id,
    recipientPhone: loan.customer_phone,
    recipientName: loan.customer_name,
    messageType: 'loan_penalty_alert',
    referenceId: loan.id,
    referenceType: 'loan',
    variables,
    triggeredByUserId: null,
  });

  return { sent: result.success, logId: result.logId, reason, error: result.error };
}

async function alertCompanyAdmins(companyId, summary) {
  const { rows } = await query(
    `SELECT phone, name FROM users
     WHERE company_id = $1 AND role IN ('company_admin', 'super_admin')
       AND is_deleted = FALSE AND is_active = TRUE AND phone IS NOT NULL AND phone <> ''`,
    [companyId],
  );
  const msg =
    `[MVG ERP] Loan reminder job had failures today.\n` +
    `Processed: ${summary.processed}, Sent: ${summary.sent}, Failed: ${summary.failed}.\n` +
    `Check WhatsApp logs in the app.`;
  for (const u of rows) {
    await sendCustomMessage({
      companyId,
      recipientPhone: u.phone,
      recipientName: u.name,
      messageBody: msg,
      triggeredByUserId: null,
    });
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
    async (job) => {
      if (job.name === 'penalty-milestone') {
        const out = await handlePenaltyMilestone(job.data || {});
        await new Promise((r) => setTimeout(r, 500));
        return out;
      }

      console.log('[LoanReminderJob] Running overdue loan WhatsApp reminders...');
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
      let sent = 0;
      let failed = 0;
      const errors = [];
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
        const vehicle = [loan.vehicle_make, loan.vehicle_model, chassis && `…${chassis}`]
          .filter(Boolean)
          .join(' ') || 'N/A';

        const variables = {
          customer_name: loan.customer_name || 'Customer',
          vehicle,
          due_date: fmtDate(loan.due_date),
          overdue_days: String(calc.calendarDaysPastDue),
          penalty: fmtRupees(calc.netPenalty),
          penalty_per_day: fmtRupees(calc.penaltyPerDay),
          branch_phone: loan.branch_phone || 'N/A',
          company_name: loan.company_name || 'Our dealership',
        };

        const result = await sendWhatsApp({
          companyId: loan.company_id,
          recipientPhone: loan.customer_phone,
          recipientName: loan.customer_name,
          messageType,
          referenceId: loan.id,
          referenceType: 'loan',
          variables,
          triggeredByUserId: null,
        });

        if (result.success) {
          sent += 1;
          await query(
            `UPDATE loans SET last_reminder_sent = CURRENT_DATE,
             status = CASE WHEN status = 'active' THEN 'overdue'::loan_status ELSE status END,
             updated_at = NOW()
             WHERE id = $1`,
            [loan.id],
          );
        } else {
          failed += 1;
          errors.push({ loanId: loan.id, error: result.error });
          failedCompanies.add(loan.company_id);
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      const summary = { processed, sent, failed, errors };
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
