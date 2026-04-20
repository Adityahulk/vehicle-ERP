# Vehicle ERP — calculation logic (reference)

All money stored as **integer paise** unless noted. Rounding: `Math.round` where specified.

---

## 1. Interstate vs intrastate (GST)

- `companyState = first 2 chars of company GSTIN`
- `customerState = first 2 chars of customer GSTIN`
- If either GSTIN missing → **intrastate** (not interstate)
- Else `interstate = (companyState !== customerState)`

---

## 2. GST on a taxable line (`calculateGst`)

Inputs: `taxableAmount` (paise), `gstRate` (total %, e.g. 28), `interstate` (boolean).

**Interstate (IGST)**  
- `igst_amount = round(taxableAmount × gstRate / 100)`  
- `cgst_rate = sgst_rate = igst_rate = 0` for CGST/SGST display; `igst_rate = gstRate`  
- `cgst_amount = sgst_amount = 0`

**Intrastate (CGST + SGST)**  
- `halfRate = gstRate / 2`  
- `cgst_amount = round(taxableAmount × halfRate / 100)`  
- `sgst_amount = round(taxableAmount × halfRate / 100)`  
- `cgst_rate = sgst_rate = halfRate`, `igst_rate = 0`, `igst_amount = 0`

---

## 3. Default GST rate from HSN (`getGstRateForHsn`)

Map (total %): `8703,8711,8704,8708 → 28`; `9971,9973,9985 → 18`; else `18`.

---

## 4. Invoice (create)

Per item:

- `lineTotal = unit_price × quantity` (paise)
- `gstRate = item.gst_rate` if set, else `getGstRateForHsn(hsn_code || '8703')`
- GST on line: `calculateGst(lineTotal, gstRate, interstate)`
- Line `amount = lineTotal + cgst_amount + sgst_amount + igst_amount`

Header:

- `subtotal = Σ lineTotal`
- `totalCgst = Σ cgst_amount`, same for SGST, IGST
- `discount = data.discount` (paise)
- **`total = subtotal − discount + totalCgst + totalSgst + totalIgst`**

---

## 5. Quotation totals (`computeQuotationTotals`)

Per line:

- `gross = unit_price × quantity`
- Line discount:  
  - `flat`: `lineDiscAmt = min(discount_value, gross)`  
  - `percent`: `lineDiscAmt = round(gross × discount_value / 10000)`, capped at `gross` (`discount_value` is percent×100, e.g. 1050 = 10.50%)
- `taxable = max(0, gross − lineDiscAmt)`
- GST on line: `calculateGst(taxable, gst_rate, interstate)`; accumulate line taxable + CGST + SGST + IGST sums

Header discount on **sum of line taxables** (`sumLineTaxable`):

- `flat`: `headerDiscAmt = min(headerDiscountValue, sumLineTaxable)`
- `percent`: `headerDiscAmt = round(sumLineTaxable × headerDiscountValue / 10000)`, capped at `sumLineTaxable`

- `taxableAfter = max(0, sumLineTaxable − headerDiscAmt)`
- `ratio = sumLineTaxable > 0 ? taxableAfter / sumLineTaxable : 0`
- `cgst_amount = round(sumCgst × ratio)`  
- `sgst_amount = round(sumSgst × ratio)`  
- `igst_amount = round(sumIgst × ratio)`  
- **`total = taxableAfter + cgst_amount + sgst_amount + igst_amount`**

---

## 6. Purchase order (`processItemsForPo`)

Same per-line GST as invoice lines (`lineTotal`, `calculateGst`, sum subtotal + taxes).

- `baseAfterDiscount = subtotal − discount`
- If TCS applicable: `tcs = round(max(0, baseAfterDiscount) × 0.001)` (0.1%)
- **`total = baseAfterDiscount + totalCgst + totalSgst + totalIgst + tcs`**

---

## 7. Loan EMI (`calculateEmi`)

- `principalPaise = P` (paise)
- `r = annualRate / 12 / 100` (monthly rate decimal)
- `n = tenure_months`
- If `n <= 0` or `annualRate <= 0`: return `principalPaise`
- Else: **`EMI = round(P × r × (1+r)^n / ((1+r)^n − 1))`** (paise)

---

## 8. Loan due date

- `due_date = disbursement_date + tenure_months` (calendar `Date` add months, ISO date string `YYYY-MM-DD`)

---

## 9. Penalty (`calculatePenalty`)

Let `grace = grace_period_days`, `perDay = penalty_per_day` (paise/day), `cap = penalty_cap` (paise), `waived = penalty_waived` (paise).

**Calendar days past due (UTC day boundaries)**  
- `calendarDaysPastDue = max(0, floor((asOfStart − dueStart) / 86400000))` in whole days

**Flags**  
- `isOverdue = calendarDaysPastDue > 0`  
- `gracePeriodActive = calendarDaysPastDue > 0 && calendarDaysPastDue <= grace`  
- `penaltyStartDate = due_date + grace` (calendar)  
- `penaltyFirstAccrualDate = due_date + grace + 1` day

**No penalty accrual in formula if:** not overdue, or `calendarDaysPastDue <= grace`, or `perDay <= 0`  
→ `overdueDays = 0`, `totalPenalty = cappedPenalty = 0`, `netPenalty = max(0, 0 − waived)`

**Otherwise**  
- `overdueDays = calendarDaysPastDue − grace`  
- `totalPenalty = overdueDays × perDay`  
- `cappedPenalty = cap > 0 ? min(totalPenalty, cap) : totalPenalty`  
- **`netPenalty = max(0, cappedPenalty − waived)`**

---

## 10. Daily stored penalty update (`updateLoanPenalties`)

For each qualifying loan (`due_date < today`, active/overdue):

- `prevCapped = total_penalty_accrued` (stored)
- `newCapped = calculatePenalty(loan, today).cappedPenalty`
- `penaltyAdded = newCapped − prevCapped`
- Store `total_penalty_accrued = newCapped`
- Log row when `penaltyAdded ≠ 0`: `penalty_added = penaltyAdded`, `running_total = newCapped`, `overdue_days` from calc

**Milestone flags (WhatsApp)** when `penaltyAdded > 0`:  
- `overdueDays === 1` → first penalty day  
- `overdueDays > 0 && overdueDays % 7 === 0` → weekly milestone  
- Thresholds (paise): `100000, 500000, 1000000, 5000000` — if `prevCapped < T && newCapped >= T`

---

## 11. Penalty waiver (`waivePenalty`)

- `maxMore = total_penalty_accrued − penalty_waived`
- Waiver `waive` (paise): `0 < waive ≤ maxMore`
- **`penalty_waived ← penalty_waived + waive`**

---

## 12. Loan reminder throttle (`shouldSendReminder` / intervals)

- `diffDays = whole days from last_reminder_sent date to today (UTC date)`
- If no `last_reminder_sent` → allow
- Else require `diffDays >= intervalDays`

`reminderIntervalDays(calendarDaysPastDue)` for overdue branch:  
- `≤ 7` → 3  
- `≤ 30` → 2  
- else → 1  

*(Separate SMS/reminder job uses `calculatePenalty` for template values; net penalty display uses `netPenalty/100` for rupees in one path.)*

---

## 13. Frontend EMI preview (sales)

Same formula as §7 with principal `round(rupees × 100)`.

---

## 14. Invoice numbering (branch)

`INV-{year}-{branchCode}-{seq}` — `branchCode` = first 3 chars of branch name, uppercase; `seq` = count of invoices matching `INV-{year}-{branchCode}-%` + 1, 4-digit pad.

---

## 15. PO numbering

FY: April–March from order date (`M >= 4` → `Y-(Y+1)` else previous FY).  
`PO/{branchCode}/{FY}/{seq}` — seq max existing + 1, 4-digit pad.
