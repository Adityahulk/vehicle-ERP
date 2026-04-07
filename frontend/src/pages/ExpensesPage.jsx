import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import EmptyState from '@/components/EmptyState';
import SortableTableHead, { sortData } from '@/components/SortableTableHead';
import { Loader2, Plus, ChevronLeft, ChevronRight, Receipt } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';

const CATEGORIES = ['Tea/Coffee', 'Electricity', 'Salary', 'Rent', 'Maintenance', 'Transport', 'Other'];

const CATEGORY_COLORS = {
  'Tea/Coffee': 'bg-amber-100 text-amber-800',
  'Electricity': 'bg-yellow-100 text-yellow-800',
  'Salary': 'bg-blue-100 text-blue-800',
  'Rent': 'bg-purple-100 text-purple-800',
  'Maintenance': 'bg-orange-100 text-orange-800',
  'Transport': 'bg-teal-100 text-teal-800',
  'Other': 'bg-gray-100 text-gray-800',
};

function getMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  return { from, to };
}

function useExpenses(filters) {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => api.get('/expenses', { params: filters }).then((r) => r.data),
    keepPreviousData: true,
  });
}

function useExpenseSummary(params) {
  return useQuery({
    queryKey: ['expense-summary', params],
    queryFn: () => api.get('/expenses/summary', { params }).then((r) => r.data),
  });
}

// ─── Add Expense Dialog ──────────────────────────────────────

function AddExpenseDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({
    category: '', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0],
  });
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setForm({ category: '', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0] });
      setError('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (data) => api.post('/expenses', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      onOpenChange(false);
      toast.success('Expense added successfully');
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to add expense'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      category: form.category,
      description: form.description || undefined,
      amount: Math.round(Number(form.amount) * 100),
      expense_date: form.expense_date,
    });
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>}

          <div className="space-y-1">
            <Label>Category *</Label>
            <Select value={form.category} onChange={set('category')} required>
              <option value="">Select category</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={form.description} onChange={set('description')} placeholder="Optional details" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input type="number" step="0.01" min="0.01" value={form.amount} onChange={set('amount')} required />
            </div>
            <div className="space-y-1">
              <Label>Date *</Label>
              <Input type="date" value={form.expense_date} onChange={set('expense_date')} required />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Expenses Page ──────────────────────────────────────

export default function ExpensesPage() {
  const user = useAuthStore((s) => s.user);
  const [addOpen, setAddOpen] = useState(false);
  const monthRange = getMonthRange();
  const [dateFrom, setDateFrom] = useState(monthRange.from);
  const [dateTo, setDateTo] = useState(monthRange.to);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const listFilters = {
    page, limit,
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
    ...(category && { category }),
  };

  const summaryFilters = {
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  };

  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const { data, isLoading } = useExpenses(listFilters);
  const { data: summaryData } = useExpenseSummary(summaryFilters);

  const rawExpenses = data?.expenses || [];
  const expenses = sortKey ? sortData(rawExpenses, sortKey, sortDir) : rawExpenses;
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;
  const handleSort = (key, dir) => { setSortKey(key); setSortDir(dir); };
  const summary = summaryData?.summary || [];
  const grandTotal = summaryData?.grand_total || 0;

  const canManage = ['super_admin', 'company_admin', 'branch_manager'].includes(user?.role);

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-semibold">Expenses</h2>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Expense
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <Card className="col-span-2 sm:col-span-1 lg:col-span-2">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal uppercase tracking-wide">Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold">{formatCurrency(grandTotal)}</p>
          </CardContent>
        </Card>
        {summary.map((s) => (
          <Card key={s.category}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-normal truncate">{s.category}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-sm font-semibold">{formatCurrency(Number(s.total))}</p>
              <p className="text-xs text-muted-foreground">{s.count} entries</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-40" />
        </div>
        <Select className="w-40" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} columns={6} /></div>
        ) : expenses.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses found" description="No expenses match your filters. Add one to get started." actionLabel={canManage ? 'Add Expense' : undefined} onAction={canManage ? () => setAddOpen(true) : undefined} />
        ) : (
        <Table>
          <thead className="[&_tr]:border-b">
            <tr>
              <SortableTableHead sortKey="expense_date" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Date</SortableTableHead>
              <SortableTableHead sortKey="category" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Category</SortableTableHead>
              <SortableTableHead>Description</SortableTableHead>
              <SortableTableHead sortKey="branch_name" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Branch</SortableTableHead>
              <SortableTableHead sortKey="created_by_name" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Added By</SortableTableHead>
              <SortableTableHead sortKey="amount" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort} className="text-right">Amount</SortableTableHead>
            </tr>
          </thead>
          <TableBody>
            {expenses.map((exp) => (
                <TableRow key={exp.id}>
                  <TableCell>{formatDate(exp.expense_date)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.Other}`}>
                      {exp.category}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{exp.description || '—'}</TableCell>
                  <TableCell>{exp.branch_name || '—'}</TableCell>
                  <TableCell>{exp.created_by_name}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(exp.amount)}</TableCell>
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">{total} expense{total !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <AddExpenseDialog open={addOpen} onOpenChange={setAddOpen} />
    </AppLayout>
  );
}
