import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { IndianRupee, TrendingUp, Warehouse, AlertTriangle, Loader2 } from 'lucide-react';
import PendingWhatsAppTasks from '@/components/PendingWhatsAppTasks';

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

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-sm font-medium">{d.label}</p>
      <p className="text-sm text-muted-foreground">{d.sold_count} sold</p>
    </div>
  );
}

export default function AdminDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => api.get('/dashboard/admin').then((r) => r.data),
    refetchInterval: 60_000,
  });

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

  const chartData = (data.top_selling_models || []).map((m) => ({
    label: `${m.make} ${m.model}`,
    sold_count: m.sold_count,
  }));

  return (
    <AppLayout>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Admin Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Overview for {data.period?.from} — {data.period?.to}
        </p>
      </div>

      <div className="mb-6">
        <PendingWhatsAppTasks />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Sales This Month"
          value={formatCurrency(data.total_sales_this_month)}
          icon={IndianRupee}
          sub={`${data.invoice_count_this_month} invoices`}
        />
        <StatCard
          title="Total Profit This Month"
          value={formatCurrency(data.total_profit_this_month)}
          icon={TrendingUp}
          color={data.total_profit_this_month >= 0 ? 'text-emerald-600' : 'text-destructive'}
        />
        <StatCard
          title="Total Stock"
          value={data.total_stock}
          icon={Warehouse}
        />
        <StatCard
          title="Overdue Loans"
          value={data.overdue_loans_count}
          icon={AlertTriangle}
          color={data.overdue_loans_count > 0 ? 'text-destructive' : 'text-emerald-600'}
        />
      </div>

      {/* Stock by branch + Top models chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock by Branch</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium text-muted-foreground">Branch</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">In Stock</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">Sold This Month</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.stock_by_branch || []).map((b) => (
                    <tr key={b.branch_id} className="border-b border-border/50">
                      <td className="py-2 font-medium">{b.branch_name}</td>
                      <td className="py-2 text-right">{b.in_stock}</td>
                      <td className="py-2 text-right">{b.sold_this_month}</td>
                    </tr>
                  ))}
                  {(data.stock_by_branch || []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-muted-foreground">No branches found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Selling Models</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="sold_count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">No sales this month</p>
            )}
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
