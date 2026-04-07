const { query } = require('../config/db');

/**
 * Calculate penalty for a single loan.
 * Returns { overdue_days, penalty_amount } in paise.
 */
function calculatePenalty(loan) {
  if (!loan.due_date || !loan.penalty_per_day) {
    return { overdue_days: 0, penalty_amount: 0 };
  }

  const dueDate = new Date(loan.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  const diffMs = today - dueDate;
  if (diffMs <= 0) return { overdue_days: 0, penalty_amount: 0 };

  const overdueDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const penaltyAmount = overdueDays * Number(loan.penalty_per_day);

  return { overdue_days: overdueDays, penalty_amount: penaltyAmount };
}

/**
 * Scan all active loans past due_date, update their penalty and status.
 * Returns list of updated loans for notification.
 */
async function processOverduePenalties() {
  const { rows: overdueLoans } = await query(
    `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone
     FROM loans l
     LEFT JOIN customers c ON c.id = l.customer_id
     WHERE l.status = 'active' AND l.due_date < CURRENT_DATE AND l.is_deleted = FALSE`,
  );

  const updated = [];

  for (const loan of overdueLoans) {
    const { penalty_amount } = calculatePenalty(loan);

    if (penalty_amount !== Number(loan.total_penalty_accrued)) {
      await query(
        `UPDATE loans SET total_penalty_accrued = $1, status = 'overdue'
         WHERE id = $2`,
        [penalty_amount, loan.id],
      );
      updated.push({
        ...loan,
        total_penalty_accrued: penalty_amount,
        status: 'overdue',
      });
    }
  }

  return updated;
}

/**
 * Stub for WhatsApp notification via Twilio.
 * Sends a penalty reminder to the customer.
 */
async function sendPenaltyWhatsApp(loan) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !fromNumber || !loan.customer_phone) {
    console.log(`[Penalty] Skipping WhatsApp for loan ${loan.id} — credentials or phone missing`);
    return;
  }

  try {
    const twilio = require('twilio')(accountSid, authToken);
    const penaltyRupees = (Number(loan.total_penalty_accrued) / 100).toFixed(2);

    await twilio.messages.create({
      body: `Dear ${loan.customer_name}, your vehicle loan with ${loan.bank_name} is overdue. Accrued penalty: ₹${penaltyRupees}. Please clear the outstanding amount at the earliest. — Vehicle ERP`,
      from: `whatsapp:${fromNumber}`,
      to: `whatsapp:+91${loan.customer_phone.replace(/^\+91/, '')}`,
    });

    console.log(`[Penalty] WhatsApp sent to ${loan.customer_phone} for loan ${loan.id}`);
  } catch (err) {
    console.error(`[Penalty] WhatsApp failed for loan ${loan.id}:`, err.message);
  }
}

module.exports = { calculatePenalty, processOverduePenalties, sendPenaltyWhatsApp };
