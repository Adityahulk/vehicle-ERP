import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Warehouse,
  ShoppingCart,
  IndianRupee,
  AlertTriangle,
  ShieldAlert,
  Plus,
  Car,
  Receipt,
  Loader2,
  FileText,
} from 'lucide-react';

const statusColors = {
  confirmed: 'success',
  draft: 'secondary',
  cancelled: 'destructive',
};

function StatCard({ title, value, icon: Icon, sub, color = 'text-primary' }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BranchDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const branchId = user?.branch_id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['branch-dashboard', branchId],
    queryFn: () => api.get(`/dashboard/branch/${branchId}`).then((r) => r.data),
    enabled: !!branchId,
    refetchInterval: 60_000,
  });

  if (!branchId) {
    return (
      <AppLayout>
        <div className="text-center py-32 text-muted-foreground">
          No branch assigned to your account. Contact your admin.
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="text-center py-32 text-destructive">Failed to load dashboard data.</div>
      </AppLayout>
    );
  }

  const { pending_tasks } = data;
  const overdueLoans = pending_tasks?.overdue_loans || [];
  const expiringInsurance = pending_tasks?.expiring_insurance || [];
  const totalTasks = overdueLoans.length + expiringInsurance.length;

  return (
    <AppLayout>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">{data.branch?.name || 'Branch'} Dashboard</h2>
        <p className="text-sm text-muted-foreground">Today's overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard title="In Stock" value={data.in_stock_count} icon={Warehouse} />
        <StatCard title="Sold Today" value={data.sold_today} icon={ShoppingCart} />
        <StatCard
          title="Revenue Today"
          value={formatCurrency(data.total_sales_today)}
          icon={IndianRupee}
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Button onClick={() => navigate('/sales')} className="gap-2">
          <Plus className="h-4 w-4" /> New Sale
        </Button>
        <Button variant="outline" onClick={() => navigate('/inventory')} className="gap-2">
          <Car className="h-4 w-4" /> Add Vehicle
        </Button>
        <Button variant="outline" onClick={() => navigate('/expenses')} className="gap-2">
          <Receipt className="h-4 w-4" /> Add Expense
        </Button>
        <Button variant="outline" onClick={() => navigate('/quotations/new')} className="gap-2">
          <FileText className="h-4 w-4" /> Add Quotation
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Pending tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Pending Tasks
              {totalTasks > 0 && (
                <Badge variant="destructive" className="ml-auto">{totalTasks}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalTasks === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">All clear — no pending tasks</p>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {overdueLoans.map((loan) => (
                  <div key={loan.id} className="flex items-start gap-3 p-2 rounded-lg bg-destructive/5 border border-destructive/10">
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Overdue Loan — {loan.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {loan.bank_name} · Due {formatDate(loan.due_date)} · Penalty {formatCurrency(loan.total_penalty_accrued || 0)}
                      </p>
                    </div>
                  </div>
                ))}
                {expiringInsurance.map((v) => (
                  <div key={v.id} className="flex items-start gap-3 p-2 rounded-lg bg-amber-50 border border-amber-200">
                    <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Insurance Expiring — {v.chassis_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.make} {v.model} · {v.insurance_company || 'Unknown'} · Expires {formatDate(v.insurance_expiry)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expense summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Month Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{formatCurrency(data.expense_total_this_month)}</p>
            <p className="text-xs text-muted-foreground mt-1">Total expenses this month</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium text-muted-foreground">Invoice #</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Customer</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Vehicle</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-center py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.recent_invoices || []).map((inv) => (
                  <tr key={inv.id} className="border-b border-border/50">
                    <td className="py-2 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="py-2">{formatDate(inv.invoice_date)}</td>
                    <td className="py-2">{inv.customer_name || '—'}</td>
                    <td className="py-2">{inv.vehicle_make ? `${inv.vehicle_make} ${inv.vehicle_model}` : '—'}</td>
                    <td className="py-2 text-right font-medium">{formatCurrency(inv.total)}</td>
                    <td className="py-2 text-center">
                      <Badge variant={statusColors[inv.status] || 'secondary'}>{inv.status}</Badge>
                    </td>
                  </tr>
                ))}
                {(data.recent_invoices || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-muted-foreground">No invoices yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
