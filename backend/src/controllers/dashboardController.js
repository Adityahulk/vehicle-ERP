const { query } = require('../config/db');

async function adminDashboard(req, res) {
  try {
    const company_id = req.user.company_id;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const salesResult = await query(
      `SELECT COALESCE(SUM(total), 0)::bigint AS total_sales,
              COUNT(*)::int AS invoice_count
       FROM invoices
       WHERE company_id = $1 AND status = 'confirmed' AND is_deleted = FALSE
         AND invoice_date >= $2 AND invoice_date <= $3`,
      [company_id, monthStart, monthEnd],
    );

    const profitResult = await query(
      `SELECT COALESCE(SUM(i.total - COALESCE(v.purchase_price, 0)), 0)::bigint AS total_profit
       FROM invoices i
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date <= $3`,
      [company_id, monthStart, monthEnd],
    );

    const stockResult = await query(
      `SELECT b.id AS branch_id, b.name AS branch_name,
              COUNT(v.id) FILTER (WHERE v.status = 'in_stock')::int AS in_stock,
              (
                SELECT COUNT(*)::int FROM invoices inv
                WHERE inv.branch_id = b.id AND inv.company_id = $1 AND inv.is_deleted = FALSE AND inv.status = 'confirmed'
                  AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
              ) AS sold_this_month
       FROM branches b
       LEFT JOIN vehicles v ON v.branch_id = b.id AND v.company_id = $1 AND v.is_deleted = FALSE
       WHERE b.company_id = $1 AND b.is_deleted = FALSE
       GROUP BY b.id, b.name
       ORDER BY b.name`,
      [company_id, monthStart, monthEnd],
    );

    const recentInvoices = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total, i.status,
              c.name AS customer_name,
              v.make AS vehicle_make, v.model AS vehicle_model
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.company_id = $1 AND i.is_deleted = FALSE
       ORDER BY i.created_at DESC LIMIT 10`,
      [company_id],
    );

    const overdueResult = await query(
      `SELECT COUNT(*)::int AS overdue_count
       FROM loans
       WHERE company_id = $1 AND is_deleted = FALSE
         AND status IN ('active', 'overdue') AND due_date < CURRENT_DATE`,
      [company_id],
    );

    const topModels = await query(
      `SELECT v.make, v.model, COUNT(*)::int AS sold_count
       FROM invoices i
       JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.company_id = $1 AND i.status = 'confirmed' AND i.is_deleted = FALSE
         AND i.invoice_date >= $2 AND i.invoice_date <= $3
       GROUP BY v.make, v.model
       ORDER BY sold_count DESC
       LIMIT 10`,
      [company_id, monthStart, monthEnd],
    );

    const totalStockResult = await query(
      `SELECT COUNT(*)::int AS total_stock
       FROM vehicles
       WHERE company_id = $1 AND status = 'in_stock' AND is_deleted = FALSE`,
      [company_id],
    );

    res.json({
      total_sales_this_month: Number(salesResult.rows[0].total_sales),
      invoice_count_this_month: salesResult.rows[0].invoice_count,
      total_profit_this_month: Number(profitResult.rows[0].total_profit),
      total_stock: totalStockResult.rows[0].total_stock,
      overdue_loans_count: overdueResult.rows[0].overdue_count,
      stock_by_branch: stockResult.rows,
      recent_invoices: recentInvoices.rows,
      top_selling_models: topModels.rows,
      period: { from: monthStart, to: monthEnd },
    });
  } catch (err) {
    console.error('adminDashboard error:', err.message);
    res.status(500).json({ error: 'Failed to load admin dashboard' });
  }
}

async function branchDashboard(req, res) {
  try {
    const company_id = req.user.company_id;
    const { branchId } = req.params;
    const { role, branch_id: userBranch } = req.user;

    if ((role === 'staff' || role === 'branch_manager') && String(userBranch) !== String(branchId)) {
      return res.status(403).json({ error: 'Access denied: You can only view your officially assigned branch dashboard.' });
    }

    const branchCheck = await query(
      `SELECT id, name FROM branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [branchId, company_id],
    );
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const stockResult = await query(
      `SELECT COUNT(*)::int AS in_stock_count
       FROM vehicles
       WHERE branch_id = $1 AND company_id = $2 AND status = 'in_stock' AND is_deleted = FALSE`,
      [branchId, company_id],
    );

    const soldTodayResult = await query(
      `SELECT COUNT(*)::int AS sold_today,
              COALESCE(SUM(i.total), 0)::bigint AS total_sales_today
       FROM invoices i
       WHERE i.branch_id = $1 AND i.company_id = $2 AND i.status = 'confirmed'
         AND i.is_deleted = FALSE AND i.invoice_date = $3`,
      [branchId, company_id, today],
    );

    const recentInvoices = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total, i.status,
              c.name AS customer_name,
              v.make AS vehicle_make, v.model AS vehicle_model
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE i.branch_id = $1 AND i.company_id = $2 AND i.is_deleted = FALSE
       ORDER BY i.created_at DESC LIMIT 5`,
      [branchId, company_id],
    );

    const overdueLoans = await query(
      `SELECT l.id, l.bank_name, l.due_date, l.total_penalty_accrued, l.loan_amount,
              c.name AS customer_name, c.phone AS customer_phone
       FROM loans l
       JOIN invoices i ON i.id = l.invoice_id
       JOIN customers c ON c.id = l.customer_id
       WHERE i.branch_id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE
         AND l.status IN ('active', 'overdue') AND l.due_date < CURRENT_DATE
       ORDER BY l.due_date ASC LIMIT 10`,
      [branchId, company_id],
    );

    const expiringInsurance = await query(
      `SELECT id, chassis_number, make, model, insurance_company, insurance_expiry
       FROM vehicles
       WHERE branch_id = $1 AND company_id = $2 AND is_deleted = FALSE
         AND status = 'in_stock'
         AND insurance_expiry IS NOT NULL
         AND insurance_expiry BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
       ORDER BY insurance_expiry ASC LIMIT 10`,
      [branchId, company_id],
    );

    const expenseResult = await query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS expense_total
       FROM expenses
       WHERE branch_id = $1 AND company_id = $2 AND is_deleted = FALSE
         AND expense_date >= $3 AND expense_date <= $4`,
      [branchId, company_id, monthStart, monthEnd],
    );

    res.json({
      branch: branchCheck.rows[0],
      in_stock_count: stockResult.rows[0].in_stock_count,
      sold_today: soldTodayResult.rows[0].sold_today,
      total_sales_today: Number(soldTodayResult.rows[0].total_sales_today),
      expense_total_this_month: Number(expenseResult.rows[0].expense_total),
      recent_invoices: recentInvoices.rows,
      pending_tasks: {
        overdue_loans: overdueLoans.rows,
        expiring_insurance: expiringInsurance.rows,
      },
    });
  } catch (err) {
    console.error('branchDashboard error:', err.message);
    res.status(500).json({ error: 'Failed to load branch dashboard' });
  }
}

module.exports = { adminDashboard, branchDashboard };
