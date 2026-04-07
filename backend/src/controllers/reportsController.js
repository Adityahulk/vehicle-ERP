const { query } = require('../config/db');

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
      } else if (Number(inv.total) > 250000_00) {
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

    const { rows: invoices } = await query(
      `SELECT i.invoice_number, i.invoice_date, i.subtotal, i.discount,
              i.cgst_amount, i.sgst_amount, i.igst_amount, i.total,
              c.name AS customer_name, c.gstin AS customer_gstin,
              v.chassis_number
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date < $3
       ORDER BY i.invoice_date`,
      [company_id, startDate, endDate],
    );

    const header = [
      'Invoice Number', 'Invoice Date', 'Customer Name', 'Customer GSTIN', 'Type',
      'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total', 'Chassis Number',
    ].join(',');

    const rows = invoices.map((inv) => {
      const total = Number(inv.total);
      const hasGstin = inv.customer_gstin && inv.customer_gstin.length >= 15;
      let type = 'B2C Small';
      if (hasGstin) type = 'B2B';
      else if (total > 250000_00) type = 'B2C Large';

      const taxable = Number(inv.subtotal) - Number(inv.discount);
      return [
        inv.invoice_number,
        new Date(inv.invoice_date).toISOString().split('T')[0],
        `"${(inv.customer_name || '').replace(/"/g, '""')}"`,
        inv.customer_gstin || '',
        type,
        (taxable / 100).toFixed(2),
        (Number(inv.cgst_amount) / 100).toFixed(2),
        (Number(inv.sgst_amount) / 100).toFixed(2),
        (Number(inv.igst_amount) / 100).toFixed(2),
        (total / 100).toFixed(2),
        inv.chassis_number || '',
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR1_${y}_${String(m).padStart(2, '0')}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('gstr1Export error:', err.message);
    res.status(500).json({ error: 'Failed to export GSTR-1' });
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

module.exports = { gstr1, gstr1Export, salesSummary, stockAging };
