const { query } = require('../config/db');

function startOfUtcDayFromDateInput(d) {
  if (!d) return null;
  const s = typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
  const [y, m, day] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/** Whole calendar days from due date start to asOf start: 0 on due date, 1 on next day */
function calendarDaysPastDueDate(dueDate, asOfDate) {
  const due = startOfUtcDayFromDateInput(dueDate);
  const asOf = startOfUtcDayFromDateInput(asOfDate);
  if (!due || !asOf) return 0;
  return Math.max(0, Math.floor((asOf - due) / 86400000));
}

function addCalendarDaysIso(dateInput, daysToAdd) {
  const d = startOfUtcDayFromDateInput(dateInput);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + Number(daysToAdd || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * @returns {{
 *   overdueDays: number,
 *   penaltyPerDay: number,
 *   totalPenalty: number,
 *   cappedPenalty: number,
 *   netPenalty: number,
 *   isOverdue: boolean,
 *   penaltyStartDate: string | null,
 *   penaltyFirstAccrualDate: string | null,
 *   gracePeriodActive: boolean,
 *   calendarDaysPastDue: number,
 * }}
 */
function calculatePenalty(loan, asOfDate = new Date()) {
  const grace = Number(loan.grace_period_days ?? 0);
  const perDay = Number(loan.penalty_per_day ?? 0);
  const cap = Number(loan.penalty_cap ?? 0);
  const waived = Number(loan.penalty_waived ?? 0);

  if (!loan.due_date) {
    return {
      overdueDays: 0,
      penaltyPerDay: perDay,
      totalPenalty: 0,
      cappedPenalty: 0,
      netPenalty: Math.max(0, 0 - waived),
      isOverdue: false,
      penaltyStartDate: null,
      penaltyFirstAccrualDate: null,
      gracePeriodActive: false,
      calendarDaysPastDue: 0,
    };
  }

  const calendarDaysPastDue = calendarDaysPastDueDate(loan.due_date, asOfDate);
  const isOverdue = calendarDaysPastDue > 0;

  // Last calendar date (inclusive) with no penalty accrual: due_date + grace_period_days
  const penaltyStartDate = addCalendarDaysIso(loan.due_date, grace);
  const penaltyFirstAccrualDate = addCalendarDaysIso(loan.due_date, grace + 1);

  const gracePeriodActive = calendarDaysPastDue > 0 && calendarDaysPastDue <= grace;

  if (!isOverdue || calendarDaysPastDue <= grace || perDay <= 0) {
    return {
      overdueDays: 0,
      penaltyPerDay: perDay,
      totalPenalty: 0,
      cappedPenalty: 0,
      netPenalty: Math.max(0, 0 - waived),
      isOverdue,
      penaltyStartDate,
      penaltyFirstAccrualDate,
      gracePeriodActive,
      calendarDaysPastDue,
    };
  }

  const overdueDays = calendarDaysPastDue - grace;
  const totalPenalty = overdueDays * perDay;
  const cappedPenalty = cap > 0 ? Math.min(totalPenalty, cap) : totalPenalty;
  const netPenalty = Math.max(0, cappedPenalty - waived);

  return {
    overdueDays,
    penaltyPerDay: perDay,
    totalPenalty,
    cappedPenalty,
    netPenalty,
    isOverdue,
    penaltyStartDate,
    penaltyFirstAccrualDate,
    gracePeriodActive: false,
    calendarDaysPastDue,
  };
}

const RUPEE_MILESTONES_PAISE = [100000, 500000, 1000000, 5000000];

/**
 * Daily penalty recalculation for all past-due active/overdue loans.
 * @param {string|null} companyId
 */
async function updateLoanPenalties(companyId = null) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const params = [];
  let cond = `
    l.is_deleted = FALSE
    AND l.status IN ('active', 'overdue')
    AND l.due_date IS NOT NULL
    AND l.due_date < CURRENT_DATE
  `;
  if (companyId) {
    params.push(companyId);
    cond += ` AND l.company_id = $${params.length}`;
  }

  const { rows: loans } = await query(`SELECT l.* FROM loans l WHERE ${cond}`, params);

  let updated = 0;
  let unchanged = 0;
  const errors = [];
  const milestones = [];

  for (const loan of loans) {
    try {
      const prevCapped = Number(loan.total_penalty_accrued || 0);
      const calc = calculatePenalty(loan, today);
      const newCapped = calc.cappedPenalty;
      const penaltyAdded = newCapped - prevCapped;

      const needOverdueStatus = loan.status === 'active' && calc.isOverdue;

      if (penaltyAdded === 0 && !needOverdueStatus) {
        unchanged += 1;
        continue;
      }

      await query(
        `UPDATE loans SET
           total_penalty_accrued = $1,
           last_penalty_calc_at = NOW(),
           status = CASE WHEN status = 'active' AND due_date < CURRENT_DATE THEN 'overdue'::loan_status ELSE status END,
           updated_at = NOW()
         WHERE id = $2`,
        [newCapped, loan.id],
      );

      if (penaltyAdded !== 0) {
        await query(
          `INSERT INTO loan_penalty_log
             (loan_id, company_id, calc_date, overdue_days, penalty_per_day, penalty_added, running_total, notes)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
           ON CONFLICT (loan_id, calc_date) DO NOTHING`,
          [
            loan.id,
            loan.company_id,
            todayStr,
            calc.overdueDays,
            calc.penaltyPerDay,
            penaltyAdded,
            newCapped,
            null,
          ],
        );
      }

      updated += 1;

      // Milestones for WhatsApp only when capped penalty increased today
      if (penaltyAdded > 0) {
        const pd = calc.overdueDays;
        if (pd === 1) {
          milestones.push({ loanId: loan.id, companyId: loan.company_id, reason: 'first_penalty_day' });
        }
        if (pd > 0 && pd % 7 === 0) {
          milestones.push({ loanId: loan.id, companyId: loan.company_id, reason: 'every_7_days', penaltyDays: pd });
        }
        for (const threshold of RUPEE_MILESTONES_PAISE) {
          if (prevCapped < threshold && newCapped >= threshold) {
            milestones.push({
              loanId: loan.id,
              companyId: loan.company_id,
              reason: 'amount_threshold',
              thresholdPaise: threshold,
            });
          }
        }
      }
    } catch (e) {
      errors.push({ loanId: loan.id, error: e.message });
    }
  }

  return { updated, unchanged, errors, milestones, date: todayStr };
}

async function waivePenalty(loanId, amountPaise, note, waivedByUserId, companyId) {
  const waive = Math.round(Number(amountPaise));
  if (waive <= 0) {
    const err = new Error('Waiver amount must be positive');
    err.statusCode = 400;
    throw err;
  }

  const { rows } = await query(
    `SELECT * FROM loans WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [loanId, companyId],
  );
  if (rows.length === 0) {
    const err = new Error('Loan not found');
    err.statusCode = 404;
    throw err;
  }
  const loan = rows[0];
  const accrued = Number(loan.total_penalty_accrued || 0);
  const currentWaived = Number(loan.penalty_waived || 0);
  const maxMore = accrued - currentWaived;
  if (maxMore <= 0) {
    const err = new Error('No accrued penalty left to waive');
    err.statusCode = 400;
    throw err;
  }
  if (waive > maxMore) {
    const err = new Error('Waiver amount exceeds remaining accrued penalty');
    err.statusCode = 400;
    throw err;
  }

  await query(
    `UPDATE loans SET
       penalty_waived = penalty_waived + $1,
       penalty_waived_by = $2,
       penalty_waived_at = NOW(),
       penalty_waive_note = $3,
       updated_at = NOW()
     WHERE id = $4`,
    [waive, waivedByUserId, note, loanId],
  );

  const { rows: out } = await query(`SELECT * FROM loans WHERE id = $1`, [loanId]);
  return out[0];
}

/**
 * @deprecated use updateLoanPenalties — kept for any external callers
 */
async function processOverduePenalties() {
  const r = await updateLoanPenalties(null);
  return { updated: r.updated, unchanged: r.unchanged, errors: r.errors };
}

module.exports = {
  calculatePenalty,
  updateLoanPenalties,
  waivePenalty,
  processOverduePenalties,
  calendarDaysPastDueDate,
};
