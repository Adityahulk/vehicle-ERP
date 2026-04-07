import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import EmptyState from '@/components/EmptyState';
import SortableTableHead, { sortData } from '@/components/SortableTableHead';
import { Loader2, CheckCircle, ChevronLeft, ChevronRight, AlertTriangle, Landmark } from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';

const STATUS_BADGE = { active: 'success', overdue: 'destructive', closed: 'secondary' };

function useLoans(filters) {
  return useQuery({
    queryKey: ['loans', filters],
    queryFn: () => api.get('/loans', { params: filters }).then((r) => r.data),
    keepPreviousData: true,
  });
}

// ─── Add Loan Dialog ─────────────────────────────────────────

function AddLoanDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({
    invoice_id: '', bank_name: '', loan_amount: '', interest_rate: '',
    tenure_months: '', disbursement_date: '', penalty_per_day: '',
  });
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setForm({ invoice_id: '', bank_name: '', loan_amount: '', interest_rate: '',
        tenure_months: '', disbursement_date: '', penalty_per_day: '' });
      setError('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (data) => api.post('/loans', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      onOpenChange(false);
      toast.success('Loan created successfully');
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to create loan'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      invoice_id: form.invoice_id,
      bank_name: form.bank_name,
      loan_amount: Math.round(Number(form.loan_amount) * 100),
      interest_rate: Number(form.interest_rate),
      tenure_months: Number(form.tenure_months),
      disbursement_date: form.disbursement_date,
      penalty_per_day: form.penalty_per_day ? Math.round(Number(form.penalty_per_day) * 100) : 0,
    });
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // EMI preview
  const principal = Number(form.loan_amount) * 100 || 0;
  const rate = Number(form.interest_rate) || 0;
  const tenure = Number(form.tenure_months) || 0;
  let emiPreview = 0;
  if (principal > 0 && rate > 0 && tenure > 0) {
    const r = rate / 12 / 100;
    emiPreview = principal * r * Math.pow(1 + r, tenure) / (Math.pow(1 + r, tenure) - 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Loan</DialogTitle>
          <DialogDescription>Link a loan to a confirmed invoice</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>}

          <div className="space-y-1">
            <Label>Invoice ID *</Label>
            <Input value={form.invoice_id} onChange={set('invoice_id')} placeholder="Paste confirmed invoice UUID" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Bank Name *</Label>
              <Input value={form.bank_name} onChange={set('bank_name')} required />
            </div>
            <div className="space-y-1">
              <Label>Loan Amount (₹) *</Label>
              <Input type="number" step="0.01" min="0" value={form.loan_amount} onChange={set('loan_amount')} required />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Interest Rate (%) *</Label>
              <Input type="number" step="0.01" min="0" max="100" value={form.interest_rate} onChange={set('interest_rate')} required />
            </div>
            <div className="space-y-1">
              <Label>Tenure (months) *</Label>
              <Input type="number" min="1" value={form.tenure_months} onChange={set('tenure_months')} required />
            </div>
            <div className="space-y-1">
              <Label>Penalty/Day (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.penalty_per_day} onChange={set('penalty_per_day')} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Disbursement Date *</Label>
            <Input type="date" value={form.disbursement_date} onChange={set('disbursement_date')} required />
          </div>

          {emiPreview > 0 && (
            <div className="bg-muted rounded-md p-3 text-sm">
              <span className="text-muted-foreground">Estimated EMI: </span>
              <span className="font-semibold">{formatCurrency(Math.round(emiPreview))}</span>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Loan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Loans Page ─────────────────────────────────────────

export default function LoansPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 25, status: '', overdue: '' });
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const { data, isLoading } = useLoans(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
  );

  const rawLoans = data?.loans || [];
  const loans = sortKey ? sortData(rawLoans, sortKey, sortDir) : rawLoans;
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / filters.limit) || 1;

  const canManage = ['super_admin', 'company_admin', 'branch_manager'].includes(user?.role);
  const handleSort = (key, dir) => { setSortKey(key); setSortDir(dir); };

  const closeMutation = useMutation({
    mutationFn: (id) => api.patch(`/loans/${id}/close`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      toast.success('Loan marked as closed');
    },
  });

  const isOverdue = (loan) => {
    return loan.status === 'overdue' || (loan.status === 'active' && new Date(loan.due_date) < new Date());
  };

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-semibold">Loans</h2>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>Add Loan</Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <Select className="w-40" value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, page: 1, status: e.target.value, overdue: '' }))}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="overdue">Overdue</option>
          <option value="closed">Closed</option>
        </Select>
        <Button variant={filters.overdue === 'true' ? 'destructive' : 'outline'} size="sm"
          onClick={() => setFilters((f) => ({
            ...f, page: 1, overdue: f.overdue === 'true' ? '' : 'true', status: '',
          }))}>
          <AlertTriangle className="h-4 w-4 mr-1" /> Overdue Only
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} columns={8} /></div>
        ) : loans.length === 0 ? (
          <EmptyState icon={Landmark} title="No loans found" description="No loan records match your filters." />
        ) : (
        <Table>
          <thead className="[&_tr]:border-b">
            <tr>
              <SortableTableHead sortKey="customer_name" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Customer</SortableTableHead>
              <SortableTableHead sortKey="vehicle_make" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Vehicle</SortableTableHead>
              <SortableTableHead sortKey="bank_name" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Bank</SortableTableHead>
              <SortableTableHead sortKey="loan_amount" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort} className="text-right">Loan Amt</SortableTableHead>
              <SortableTableHead sortKey="emi_amount" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort} className="text-right">EMI</SortableTableHead>
              <SortableTableHead sortKey="due_date" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Due Date</SortableTableHead>
              <SortableTableHead sortKey="status" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Status</SortableTableHead>
              <SortableTableHead sortKey="total_penalty_accrued" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort} className="text-right">Penalty</SortableTableHead>
              {canManage && <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">Actions</th>}
            </tr>
          </thead>
          <TableBody>
            {loans.map((loan) => (
                <TableRow key={loan.id} className={cn(isOverdue(loan) && loan.status !== 'closed' && 'bg-red-50')}>
                  <TableCell>
                    <div className="font-medium">{loan.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{loan.customer_phone}</div>
                  </TableCell>
                  <TableCell>
                    {loan.vehicle_make
                      ? <span>{loan.vehicle_make} {loan.vehicle_model}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{loan.bank_name}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(loan.loan_amount)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(loan.emi_amount)}</TableCell>
                  <TableCell className={cn(isOverdue(loan) && loan.status !== 'closed' && 'text-destructive font-medium')}>
                    {formatDate(loan.due_date)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[loan.status]}>{loan.status}</Badge>
                  </TableCell>
                  <TableCell className={cn('text-right font-mono', Number(loan.total_penalty_accrued) > 0 && 'text-destructive font-medium')}>
                    {Number(loan.total_penalty_accrued) > 0 ? formatCurrency(loan.total_penalty_accrued) : '—'}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {loan.status !== 'closed' && (
                        <Button variant="ghost" size="sm" title="Mark Closed"
                          disabled={closeMutation.isPending}
                          onClick={() => { if (window.confirm('Close this loan?')) closeMutation.mutate(loan.id); }}>
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">{total} loan{total !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>Page {filters.page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={filters.page >= totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <AddLoanDialog open={addOpen} onOpenChange={setAddOpen} />
    </AppLayout>
  );
}
