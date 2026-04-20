# Reports & GST — logic for CA and filing roles

**Who can access:** `super_admin`, `company_admin`, and `ca` (routes under `/api/reports/*`). Data is always scoped to **`req.user.company_id`**.

**Money:** Stored amounts are **paise** unless the export divides by 100 for display (noted per report).

**Indian FY (where used):** April 1 → March 31. `startYear = calendar year if month ≥ 4 else previous year`; FY end date = March 31 of `startYear + 1`.

---

## 1. GSTR-1 (JSON) — `GET /reports/gstr1?month=&year=`

**Period:** `[year-month-01, first day of next month)` (half-open).

**Source:** `invoices` with `status = 'confirmed'`, `is_deleted = FALSE`, `invoice_date` in range; join `customers`, `vehicles`.

**Per invoice**

- `taxable_value = subtotal − discount` (paise)
- `cgst, sgst, igst` = header fields from invoice (paise)
- `total` = invoice total (paise)

**Classification (invoice level)**

| Bucket | Rule |
|--------|------|
| **B2B** | `customer_gstin` present and `length ≥ 15` |
| **B2C large** | Not B2B, and `igst_amount > 0`, and `total > 25000000` paise (₹2,50,000) |
| **B2C small** | Everything else |

**Section summary** (each of B2B, B2C large, B2C small, and **totals**):  
`count`, `Σ taxable_value`, `Σ cgst`, `Σ sgst`, `Σ igst`, `Σ total` (all paise in API JSON).

---

## 2. GSTR-1 (Excel export) — `GET /reports/gstr1/export?month=&year=`

**Period:** Same as §1.

**Source:** `invoice_items` joined to confirmed invoices in range (line-level).

**Invoice-level category (first line of each `invoice_number` seeds the group)**

- `hasGstin` = customer GSTIN length ≥ 15 → **B2B**
- Else `isInterstate` = `igst_amount > 0` on that line; `isLarge` = invoice `total > 25000000` paise  
  - If `!hasGstin && isInterstate && isLarge` → **B2CL**  
  - Else → **B2CS**

**Place of supply (POS) — informational string in sheet**

- B2B: `customer_gstin.substring(0,2) + '-State'`
- Else if interstate: `'97-Other Territory'`
- Else: `'00-Local'`

**Rate bucket per invoice:** `rate = cgst_rate + sgst_rate + igst_rate` (from line). Taxable accumulated per rate: **`Σ (unit_price × quantity) / 100`** (i.e. line pre-tax in **rupees** for the sheet). *Invoice-level discount is not re-apportioned in this export (comment in code).*

**B2CS aggregation key:** `OE|{pos}|{rate}` → summed **taxable** (rupees).

**HSN sheet (per `hsn_code`, default `8703`)**

- `qty` += line quantity  
- `taxable` += `(unit_price × quantity) / 100`  
- `igst/cgst/sgst` += respective tax amounts `/ 100`  
- `total_val` += `(item line pre-tax + all line taxes) / 100`

**Cess:** Always `0` / `'0.00'` in utility columns.

**Output:** Multi-sheet XLSX: `b2b`, `b2cl`, `b2cs`, `hsn` (column names aligned to common offline-utility style).

---

## 3. GSTR-3B summary (CSV) — `GET /reports/gstr3b/export?month=&year=`

**Period:** Same month window as GSTR-1.

**Outward (sales)**

- `taxable = Σ (subtotal − discount)` over confirmed, non-deleted invoices in range  
- `tax = Σ (cgst_amount + sgst_amount + igst_amount)` same filters  

**Inward / ITC (purchases)**

- `taxable = Σ (subtotal − discount)` over `purchase_orders` with `is_deleted = FALSE`, `status <> 'cancelled'`, `order_date` in range  
- `itc = Σ (cgst_amount + sgst_amount + igst_amount)` same  

**Net (file line):** `net_tax_payable = outward_tax − itc` (all converted to ₹ string via `paise/100` formatting in CSV).

*Note: This is a **simplified** 3B-style helper, not a full statutory GSTR-3B form.*

---

## 4. Sales summary — `GET /reports/sales-summary?from=&to=&branch_id=`

**Filters:** Confirmed invoices; optional `branch_id` on invoice.

**Aggregates**

- `total_invoices` = count  
- `total_sales` = `Σ total`  
- `total_gst` = `Σ (cgst + sgst + igst)`  
- `total_profit` = `Σ (total − vehicle.purchase_price)` with `purchase_price` null treated as 0  

**Top vehicles / customers / daily_sales:** standard `GROUP BY` sums in same date window.

---

## 5. Sales register (Excel) — `GET /reports/sales-register/export?from=&to=`

**Source:** All `invoice_items` for invoices (any **status**) with `invoice_date` in `[from, to]` inclusive.

**Columns:** Invoice meta + per line: qty, unit and line total and CGST/SGST/IGST as **`amount_paise / 100`** (rupees).

---

## 6. Purchase register (Excel) — `GET /reports/purchase-register/export?from=&to=`

**Source:** `purchase_order_items` joined to POs with `order_date` in `[from, to]`.

**Columns:** PO, supplier, branch, line amounts; taxes as **paise / 100**.

---

## 7. Expense register (Excel) — `GET /reports/expenses/export?from=&to=`

**Source:** `expenses` not deleted, `expense_date` in range.

**Amount:** `amount / 100` as rupees.

---

## 8. P&L summary (PDF) — `GET /reports/pl-summary/pdf`

**FY:** `fyBounds()` → April 1–March 31 for current Indian FY.

**Lines (all sums in paise, displayed as ₹)**

- Sales: `Σ invoice.total` (confirmed, not deleted)  
- GST on sales: `Σ (cgst+sgst+igst)` on those invoices  
- Purchases: `Σ purchase_orders.total` (not deleted, not cancelled)  
- GST on purchases: `Σ (cgst+sgst+igst)` on those POs  
- Expenses: `Σ expenses.amount`  
- **Gross profit (label in PDF):** `sales − purchases − expenses` *(all inclusive totals as stored on documents; not tax-exclusive P&L)*

---

## 9. CA dashboard — `GET /dashboard/ca` (role `ca` only)

**`monthMetrics(y,m)`** (calendar month, half-open `[start, endExclusive)`)

- Sales: `Σ total`, `Σ (cgst+sgst+igst)` — confirmed invoices  
- Purchases: `Σ total`, `Σ taxes` — POs not cancelled  
- Expenses: `Σ amount`  
- `gross_profit = total_sales − total_purchases − total_expenses`  
- `net_gst_liability = total_gst_collected − total_gst_paid` (invoice taxes minus PO taxes)

**`this_fy`:** Same FY as §8; separate queries for FY sales, purchases, GST collected on sales, expenses.

**`gstr1MonthSummary` (last 3 months, rolling)**

- Pulls same invoices as GSTR-1 for that month  
- Per invoice: `taxable += subtotal − discount`, `tax += cgst+sgst+igst`  
- `b2b_count` if GSTIN length ≥ 15, else `b2c_count`  
- Returns `invoice_count`, counts, `total_taxable_value`, `total_tax`

**`overdue_loans` (approximation — not `penaltyService`)**

- Loans: `status = 'active'`, `due_date < CURRENT_DATE`, not deleted  
- `penalty` aggregate in SQL: **`Σ (penalty_per_day × GREATEST(0, CURRENT_DATE − due_date))`** in **paise**  
  - *This is a rough calendar-day product; it ignores `grace_period_days`, caps, and waivers used elsewhere.*

**Other:** Expense by category (current month), top expenses, union of large sales + purchases by amount.

---

## 10. GSTIN usage in reports

- **B2B detection:** Length ≥ 15 on **customer** GSTIN (string check only, not checksum).  
- **POS in Excel export:** First **2 characters** of customer GSTIN treated as state code for B2B POS label.  
- **Interstate proxy in exports:** `igst_amount > 0` on a line implies interstate treatment for B2CL/B2CS split.  
- Company GSTIN is **not** re-validated in these reports; filing data is only as stored on invoices/POs.

---

## 11. Documents excluded from typical GST totals here

- **Draft / cancelled** invoices: excluded from GSTR-1 and most sales tax sums (only confirmed where stated).  
- **Quotations:** not in GSTR-1 or registers unless converted to invoice.  
- **TCS on PO:** included in `purchase_orders.total` if stored there; GSTR-3B CSV uses header tax columns only, not a separate TCS line.

---

## 12. UI entry points

- **Reports & Filing:** `/reports` (company admin / super admin / CA).  
- **CA dashboard:** GSTR-1 download links use the same export API; net GST figures use §9 month metrics.

For **tax computation on each document** (how `cgst`/`sgst`/`igst` are derived before they appear in reports), see **`docs/CALCULATION_LOGIC_REPORT.md`**.
