const XLSX = require('xlsx');
const { query } = require('../config/db');
const { htmlToPdfBuffer } = require('../services/pdfService');

function fyBounds(ref = new Date()) {
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  return { start: `${startYear}-04-01`, end: `${endYear}-03-31`, label: `${startYear}-${String(endYear).slice(-2)}` };
}

function fmtMoneyPaise(p) {
  return (Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ────────────────────────── GSTR-1 Report ──────────────────────────

async function gstr1(req, res) {
  try {
    const company_id = req.user.company_id;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ error: 'month and year are required' });
    }

    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const { rows: invoices } = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.subtotal, i.discount,
              i.cgst_amount, i.sgst_amount, i.igst_amount, i.total,
              c.name AS customer_name, c.gstin AS customer_gstin,
              c.address AS customer_address,
              v.chassis_number
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date < $3
       ORDER BY i.invoice_date, i.invoice_number`,
      [company_id, startDate, endDate],
    );

    const b2b = [];
    const b2cLarge = [];
    const b2cSmall = [];

    for (const inv of invoices) {
      const entry = {
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        customer_name: inv.customer_name,
        customer_gstin: inv.customer_gstin,
        taxable_value: Number(inv.subtotal) - Number(inv.discount),
        cgst: Number(inv.cgst_amount),
        sgst: Number(inv.sgst_amount),
        igst: Number(inv.igst_amount),
        total: Number(inv.total),
        chassis_number: inv.chassis_number,
      };

      if (inv.customer_gstin && inv.customer_gstin.length >= 15) {
        b2b.push(entry);
      } else if (Number(inv.igst_amount) > 0 && Number(inv.total) > 250000_00) {
        b2cLarge.push(entry);
      } else {
        b2cSmall.push(entry);
      }
    }

    const sumSection = (arr) => ({
      count: arr.length,
      taxable_value: arr.reduce((s, e) => s + e.taxable_value, 0),
      cgst: arr.reduce((s, e) => s + e.cgst, 0),
      sgst: arr.reduce((s, e) => s + e.sgst, 0),
      igst: arr.reduce((s, e) => s + e.igst, 0),
      total: arr.reduce((s, e) => s + e.total, 0),
    });

    res.json({
      period: { month: m, year: y },
      b2b: { summary: sumSection(b2b), invoices: b2b },
      b2c_large: { summary: sumSection(b2cLarge), invoices: b2cLarge },
      b2c_small: { summary: sumSection(b2cSmall), invoices: b2cSmall },
      totals: sumSection([...b2b, ...b2cLarge, ...b2cSmall]),
    });
  } catch (err) {
    console.error('gstr1 error:', err.message);
    res.status(500).json({ error: 'Failed to generate GSTR-1 report' });
  }
}

async function gstr1Export(req, res) {
  try {
    const company_id = req.user.company_id;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ error: 'month and year are required' });
    }

    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const { rows: items } = await query(
      `SELECT i.invoice_number, i.invoice_date, i.total, i.discount,
              c.name AS customer_name, c.gstin AS customer_gstin,
              ii.hsn_code, ii.description, ii.quantity, ii.unit_price, 
              (ii.unit_price * ii.quantity) AS item_total,
              ii.cgst_rate, ii.sgst_rate, ii.igst_rate,
              ii.cgst_amount, ii.sgst_amount, ii.igst_amount
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id AND i.is_deleted = FALSE AND ii.is_deleted = FALSE
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.company_id = $1 AND i.status = 'confirmed'
         AND i.invoice_date >= $2 AND i.invoice_date < $3
       ORDER BY i.invoice_date, i.invoice_number`,
      [company_id, startDate, endDate],
    );

    const b2b = [];
    const b2cl = [];
    const b2csMap = {};
    const hsnMap = {};
    const invoiceGroups = {};

    for (const item of items) {
      const invKey = item.invoice_number;
      if (!invoiceGroups[invKey]) {
        const isInterstate = Number(item.igst_amount) > 0;
        const hasGstin = item.customer_gstin && item.customer_gstin.length >= 15;
        const isLarge = Number(item.total) > 25000000;
        let category = 'B2CS';
        if (hasGstin) category = 'B2B';
        else if (isInterstate && isLarge) category = 'B2CL';

        const pos = hasGstin ? item.customer_gstin.substring(0, 2) + '-State' : (isInterstate ? '97-Other Territory' : '00-Local');

        invoiceGroups[invKey] = {
          invoice_number: item.invoice_number,
          invoice_date: item.invoice_date,
          customer_name: item.customer_name,
          customer_gstin: item.customer_gstin,
          total: item.total,
          category,
          pos,
          rates: {}
        };
      }

      const inv = invoiceGroups[invKey];
      const rate = Number(item.cgst_rate || 0) + Number(item.sgst_rate || 0) + Number(item.igst_rate || 0);
      
      if (!inv.rates[rate]) inv.rates[rate] = { taxable: 0, cess: 0 };
      
      // We must distribute invoice-level discount proportionally or just apply loosely. We will assume item_total acts purely on item cost.
      inv.rates[rate].taxable += (Number(item.item_total) / 100);

      // HSN grouping
      const hsn = item.hsn_code || '8703';
      if (!hsnMap[hsn]) {
        hsnMap[hsn] = { desc: item.description || 'Goods', uqc: 'NOS', qty: 0, total_val: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      }
      hsnMap[hsn].qty += Number(item.quantity || 1);
      hsnMap[hsn].taxable += (Number(item.item_total) / 100);
      hsnMap[hsn].igst += (Number(item.igst_amount) / 100);
      hsnMap[hsn].cgst += (Number(item.cgst_amount) / 100);
      hsnMap[hsn].sgst += (Number(item.sgst_amount) / 100);
      hsnMap[hsn].total_val += (Number(item.item_total) + Number(item.igst_amount) + Number(item.cgst_amount) + Number(item.sgst_amount)) / 100;
    }

    for (const invKey of Object.keys(invoiceGroups)) {
      const inv = invoiceGroups[invKey];
      const dateObj = new Date(inv.invoice_date);
      const formattedDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

      for (const rateStr of Object.keys(inv.rates)) {
        const rData = inv.rates[rateStr];
        
        if (inv.category === 'B2B') {
          b2b.push({
            'GSTIN/UIN of Recipient': inv.customer_gstin,
            'Receiver Name': inv.customer_name,
            'Invoice Number': inv.invoice_number,
            'Invoice date': formattedDate,
            'Invoice Value': (Number(inv.total) / 100).toFixed(2),
            'Place Of Supply': inv.pos,
            'Reverse Charge': 'N',
            'Applicable % of Tax Rate': '',
            'Invoice Type': 'Regular B2B',
            'E-Commerce GSTIN': '',
            'Rate': rateStr,
            'Taxable Value': rData.taxable.toFixed(2),
            'Cess Amount': '0.00'
          });
        } else if (inv.category === 'B2CL') {
          b2cl.push({
            'Invoice Number': inv.invoice_number,
            'Invoice date': formattedDate,
            'Invoice Value': (Number(inv.total) / 100).toFixed(2),
            'Place Of Supply': inv.pos,
            'Applicable % of Tax Rate': '',
            'Rate': rateStr,
            'Taxable Value': rData.taxable.toFixed(2),
            'Cess Amount': '0.00',
            'E-Commerce GSTIN': ''
          });
        } else {
          const key = `OE|${inv.pos}|${rateStr}`;
          if (!b2csMap[key]) {
            b2csMap[key] = { type: 'OE', pos: inv.pos, rate: rateStr, taxable: 0 };
          }
          b2csMap[key].taxable += rData.taxable;
        }
      }
    }

    const b2cs = Object.values(b2csMap).map(b => ({
      'Type': b.type,
      'Place Of Supply': b.pos,
      'Applicable % of Tax Rate': '',
      'Rate': b.rate,
      'Taxable Value': b.taxable.toFixed(2),
      'Cess Amount': '0.00',
      'E-Commerce GSTIN': ''
    }));

    const hsnSheet = Object.keys(hsnMap).map(hsn => ({
      'HSN': hsn,
      'Description': hsnMap[hsn].desc,
      'UQC': hsnMap[hsn].uqc,
      'Total Quantity': hsnMap[hsn].qty,
      'Total Value': hsnMap[hsn].total_val.toFixed(2),
      'Taxable Value': hsnMap[hsn].taxable.toFixed(2),
      'Integrated Tax Amount': hsnMap[hsn].igst.toFixed(2),
      'Central Tax Amount': hsnMap[hsn].cgst.toFixed(2),
      'State/UT Tax Amount': hsnMap[hsn].sgst.toFixed(2),
      'Cess Amount': '0.00'
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(b2b.length ? b2b : [{'GSTIN/UIN of Recipient': ''}]), 'b2b');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(b2cl.length ? b2cl : [{'Invoice Number': ''}]), 'b2cl');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(b2cs.length ? b2cs : [{'Type': ''}]), 'b2cs');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hsnSheet.length ? hsnSheet : [{'HSN': ''}]), 'hsn');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR1_Offline_Utility_${y}_${String(m).padStart(2, '0')}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('gstr1Export error:', err.message);
    res.status(500).json({ error: 'Failed to export GSTR-1 Excel' });
  }
}

// ────────────────────────── Sales Summary ──────────────────────────

async function salesSummary(req, res) {
  try {
    const company_id = req.user.company_id;
    const { from, to, branch_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const branchFilter = branch_id ? 'AND i.branch_id = $4' : '';
    const params = [company_id, from, to];
    if (branch_id) params.push(branch_id);

    const salesResult = await query(
      `SELECT COUNT(*)::int AS total_invoices,
              COALESCE(SUM(i.total), 0)::bigint AS total_sales,
              COALESCE(SUM(i.cgst_amount + i.sgst_amount + i.igst_amount), 0)::bigint AS total_gst,
              COALESCE(SUM(i.total - COALESCE(v.purchase_price, 0)), 0)::bigint AS total_profit
       FROM invoices i
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date <= $3 ${branchFilter}`,
      params,
    );

    const topVehicles = await query(
      `SELECT v.make, v.model, v.variant, COUNT(*)::int AS sold_count,
              COALESCE(SUM(i.total), 0)::bigint AS revenue
       FROM invoices i
       JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date <= $3 ${branchFilter}
       GROUP BY v.make, v.model, v.variant
       ORDER BY sold_count DESC
       LIMIT 10`,
      params,
    );

    const topCustomers = await query(
      `SELECT c.name, c.phone, COUNT(*)::int AS purchase_count,
              COALESCE(SUM(i.total), 0)::bigint AS total_spent
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date <= $3 ${branchFilter}
       GROUP BY c.id, c.name, c.phone
       ORDER BY total_spent DESC
       LIMIT 10`,
      params,
    );

    const dailySales = await query(
      `SELECT i.invoice_date::text AS date,
              COUNT(*)::int AS count,
              COALESCE(SUM(i.total), 0)::bigint AS amount
       FROM invoices i
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date <= $3 ${branchFilter}
       GROUP BY i.invoice_date
       ORDER BY i.invoice_date`,
      params,
    );

    res.json({
      period: { from, to, branch_id: branch_id || null },
      summary: {
        total_invoices: salesResult.rows[0].total_invoices,
        total_sales: Number(salesResult.rows[0].total_sales),
        total_gst: Number(salesResult.rows[0].total_gst),
        total_profit: Number(salesResult.rows[0].total_profit),
      },
      top_vehicles: topVehicles.rows,
      top_customers: topCustomers.rows,
      daily_sales: dailySales.rows,
    });
  } catch (err) {
    console.error('salesSummary error:', err.message);
    res.status(500).json({ error: 'Failed to generate sales summary' });
  }
}

// ────────────────────────── Stock Aging ──────────────────────────

async function stockAging(req, res) {
  try {
    const company_id = req.user.company_id;

    const { rows } = await query(
      `SELECT v.id, v.chassis_number, v.engine_number, v.make, v.model, v.variant,
              v.color, v.year, v.purchase_price, v.selling_price, v.created_at,
              b.name AS branch_name,
              EXTRACT(DAY FROM NOW() - v.created_at)::int AS days_in_stock
       FROM vehicles v
       LEFT JOIN branches b ON b.id = v.branch_id
       WHERE v.company_id = $1 AND v.status = 'in_stock' AND v.is_deleted = FALSE
       ORDER BY v.created_at ASC`,
      [company_id],
    );

    const buckets = {
      '0-30': [],
      '31-60': [],
      '61-90': [],
      '90+': [],
    };

    for (const v of rows) {
      const d = v.days_in_stock;
      if (d <= 30) buckets['0-30'].push(v);
      else if (d <= 60) buckets['31-60'].push(v);
      else if (d <= 90) buckets['61-90'].push(v);
      else buckets['90+'].push(v);
    }

    const summary = Object.entries(buckets).map(([range, items]) => ({
      range,
      count: items.length,
      total_value: items.reduce((s, v) => s + Number(v.purchase_price), 0),
    }));

    res.json({
      total_in_stock: rows.length,
      summary,
      buckets,
    });
  } catch (err) {
    console.error('stockAging error:', err.message);
    res.status(500).json({ error: 'Failed to generate stock aging report' });
  }
}

// ────────────────────────── CA quick exports ──────────────────────────

async function gstr3bExport(req, res) {
  try {
    const company_id = req.user.company_id;
    const now = new Date();
    const m = parseInt(req.query.month || String(now.getMonth() + 1), 10);
    const y = parseInt(req.query.year || String(now.getFullYear()), 10);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const outInv = await query(
      `SELECT COALESCE(SUM(subtotal - discount), 0)::bigint AS taxable,
              COALESCE(SUM(cgst_amount + sgst_amount + igst_amount), 0)::bigint AS tax
       FROM invoices
       WHERE company_id = $1 AND status = 'confirmed' AND is_deleted = FALSE
         AND invoice_date >= $2 AND invoice_date < $3`,
      [company_id, startDate, endDate],
    );
    const inPo = await query(
      `SELECT COALESCE(SUM(subtotal - discount), 0)::bigint AS taxable,
              COALESCE(SUM(cgst_amount + sgst_amount + igst_amount), 0)::bigint AS itc
       FROM purchase_orders
       WHERE company_id = $1 AND is_deleted = FALSE AND status <> 'cancelled'
         AND order_date >= $2 AND order_date < $3`,
      [company_id, startDate, endDate],
    );

    const outwardTax = Number(outInv.rows[0].tax);
    const itc = Number(inPo.rows[0].itc);
    const net = outwardTax - itc;

    const lines = [
      'Field,Amount (₹)',
      `Outward taxable value,${fmtMoneyPaise(Number(outInv.rows[0].taxable))}`,
      `Outward tax (CGST+SGST+IGST),${fmtMoneyPaise(outwardTax)}`,
      `Inward ITC (from purchases),${fmtMoneyPaise(itc)}`,
      `Net tax payable (outward - ITC),${fmtMoneyPaise(net)}`,
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR3B_${y}_${String(m).padStart(2, '0')}.csv"`);
    res.send(lines);
  } catch (err) {
    console.error('gstr3bExport error:', err.message);
    res.status(500).json({ error: 'Failed to export GSTR-3B summary' });
  }
}

async function purchaseRegisterExport(req, res) {
  try {
    const company_id = req.user.company_id;
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const { rows } = await query(
      `SELECT po.po_number, po.order_date::text, po.status, s.name AS supplier, b.name AS branch,
              poi.description, poi.quantity, poi.unit_price, poi.amount,
              poi.cgst_amount, poi.sgst_amount, poi.igst_amount
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.purchase_order_id AND po.is_deleted = FALSE
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN branches b ON b.id = po.branch_id
       WHERE po.company_id = $1 AND po.order_date >= $2::date AND po.order_date <= $3::date
       ORDER BY po.order_date, po.po_number`,
      [company_id, from, to],
    );

    const data = rows.map((r) => ({
      PO: r.po_number,
      Date: r.order_date,
      Status: r.status,
      Supplier: r.supplier,
      Branch: r.branch,
      Line: r.description,
      Qty: r.quantity,
      'Unit (₹)': Number(r.unit_price) / 100,
      'Line total (₹)': Number(r.amount) / 100,
      'CGST (₹)': Number(r.cgst_amount) / 100,
      'SGST (₹)': Number(r.sgst_amount) / 100,
      'IGST (₹)': Number(r.igst_amount) / 100,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Note: 'No rows' }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Register');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Purchase_Register.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('purchaseRegisterExport error:', err.message);
    res.status(500).json({ error: 'Failed to export purchase register' });
  }
}

async function salesRegisterExport(req, res) {
  try {
    const company_id = req.user.company_id;
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const { rows } = await query(
      `SELECT i.invoice_number, i.invoice_date::text, i.status, c.name AS customer, b.name AS branch,
              ii.description, ii.quantity, ii.unit_price, ii.amount,
              ii.cgst_amount, ii.sgst_amount, ii.igst_amount
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id AND i.is_deleted = FALSE AND ii.is_deleted = FALSE
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.company_id = $1 AND i.invoice_date >= $2::date AND i.invoice_date <= $3::date
       ORDER BY i.invoice_date, i.invoice_number`,
      [company_id, from, to],
    );

    const data = rows.map((r) => ({
      Invoice: r.invoice_number,
      Date: r.invoice_date,
      Status: r.status,
      Customer: r.customer,
      Branch: r.branch,
      Line: r.description,
      Qty: r.quantity,
      'Unit (₹)': Number(r.unit_price) / 100,
      'Line total (₹)': Number(r.amount) / 100,
      'CGST (₹)': Number(r.cgst_amount) / 100,
      'SGST (₹)': Number(r.sgst_amount) / 100,
      'IGST (₹)': Number(r.igst_amount) / 100,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Note: 'No rows' }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Register');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Sales_Register.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('salesRegisterExport error:', err.message);
    res.status(500).json({ error: 'Failed to export sales register' });
  }
}

async function expenseRegisterExport(req, res) {
  try {
    const company_id = req.user.company_id;
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const { rows } = await query(
      `SELECT e.expense_date::text, e.category, e.description, e.amount, b.name AS branch, u.name AS created_by
       FROM expenses e
       LEFT JOIN branches b ON b.id = e.branch_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.company_id = $1 AND e.is_deleted = FALSE
         AND e.expense_date >= $2::date AND e.expense_date <= $3::date
       ORDER BY e.expense_date DESC`,
      [company_id, from, to],
    );

    const data = rows.map((r) => ({
      Date: r.expense_date,
      Category: r.category,
      Description: r.description,
      'Amount (₹)': Number(r.amount) / 100,
      Branch: r.branch,
      'Created by': r.created_by,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Note: 'No rows' }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Expense_Report.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('expenseRegisterExport error:', err.message);
    res.status(500).json({ error: 'Failed to export expense report' });
  }
}

async function plSummaryPdf(req, res) {
  try {
    const company_id = req.user.company_id;
    const { rows: co } = await query(
      `SELECT name FROM companies WHERE id = $1`,
      [company_id],
    );
    const companyName = co[0]?.name || 'Company';

    const { start, end, label } = fyBounds();

    const [salesR, purchR, expR] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(total), 0)::bigint AS v,
                COALESCE(SUM(cgst_amount + sgst_amount + igst_amount), 0)::bigint AS gst
         FROM invoices WHERE company_id = $1 AND status = 'confirmed' AND is_deleted = FALSE
           AND invoice_date >= $2::date AND invoice_date <= $3::date`,
        [company_id, start, end],
      ),
      query(
        `SELECT COALESCE(SUM(total), 0)::bigint AS v,
                COALESCE(SUM(cgst_amount + sgst_amount + igst_amount), 0)::bigint AS gst
         FROM purchase_orders WHERE company_id = $1 AND is_deleted = FALSE AND status <> 'cancelled'
           AND order_date >= $2::date AND order_date <= $3::date`,
        [company_id, start, end],
      ),
      query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS v
         FROM expenses WHERE company_id = $1 AND is_deleted = FALSE
           AND expense_date >= $2::date AND expense_date <= $3::date`,
        [company_id, start, end],
      ),
    ]);

    const sales = Number(salesR.rows[0].v);
    const salesGst = Number(salesR.rows[0].gst);
    const purchases = Number(purchR.rows[0].v);
    const purchGst = Number(purchR.rows[0].gst);
    const expenses = Number(expR.rows[0].v);
    const gross = sales - purchases - expenses;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
      body{font-family:system-ui,sans-serif;padding:32px;color:#111}
      h1{font-size:20px;margin-bottom:4px} .sub{color:#666;font-size:13px;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{padding:10px 8px;text-align:left;border-bottom:1px solid #e5e5e5}
      th{background:#f4f4f5;font-size:12px;text-transform:uppercase}
      .num{text-align:right;font-variant-numeric:tabular-nums}
      .total{font-weight:700;font-size:15px}
    </style></head><body>
      <h1>Profit &amp; Loss Summary</h1>
      <p class="sub">${companyName} · FY ${label} (${start} to ${end})</p>
      <table>
        <thead><tr><th>Description</th><th class="num">Amount (₹)</th></tr></thead>
        <tbody>
          <tr><td>Total sales (incl. tax in totals)</td><td class="num">${fmtMoneyPaise(sales)}</td></tr>
          <tr><td>GST collected on sales</td><td class="num">${fmtMoneyPaise(salesGst)}</td></tr>
          <tr><td>Total purchases</td><td class="num">${fmtMoneyPaise(purchases)}</td></tr>
          <tr><td>GST on purchases (ITC)</td><td class="num">${fmtMoneyPaise(purchGst)}</td></tr>
          <tr><td>Total expenses</td><td class="num">${fmtMoneyPaise(expenses)}</td></tr>
          <tr class="total"><td>Gross profit (sales − purchases − expenses)</td><td class="num">${fmtMoneyPaise(gross)}</td></tr>
        </tbody>
      </table>
    </body></html>`;

    const buf = await htmlToPdfBuffer(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="PL_Summary_FY_${label}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('plSummaryPdf error:', err.message);
    res.status(500).json({ error: 'Failed to generate P&L PDF' });
  }
}

module.exports = {
  gstr1,
  gstr1Export,
  salesSummary,
  stockAging,
  gstr3bExport,
  purchaseRegisterExport,
  salesRegisterExport,
  expenseRegisterExport,
  plSummaryPdf,
};
