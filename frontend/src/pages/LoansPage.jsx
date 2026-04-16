import { useState, useMemo } from 'react';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EmptyState from '@/components/EmptyState';
import SortableTableHead, { sortData } from '@/components/SortableTableHead';
import {
  Loader2, CheckCircle, ChevronLeft, ChevronRight, AlertTriangle, Landmark,
  Eye, ChevronDown, MessageCircle,
} from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import api from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ReadOnlyBadge from '@/components/ReadOnlyBadge';
import WhatsAppSendDialog from '@/components/WhatsAppSendDialog';

const STATUS_BADGE = { active: 'success', overdue: 'destructive', closed: 'secondary' };

function calendarDaysPastDue(dueDateStr) {
  if (!dueDateStr) return 0;
  const due = String(dueDateStr).slice(0, 10);
  const as = new Date().toISOString().slice(0, 10);
  const a = new Date(`${due}T12:00:00`);
  const b = new Date(`${as}T12:00:00`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

function netPenaltyPaise(loan) {
  const g = Number(loan.total_penalty_accrued || 0);
  const w = Number(loan.penalty_waived || 0);
  return Math.max(0, g - w);
}

function useLoans(filters) {
  return useQuery({
    queryKey: ['loans', filters],
    queryFn: () => api.get('/loans', { params: filters }).then((r) => r.data),
    keepPreviousData: true,
  });
}

function AddLoanDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({
    invoice_id: '', bank_name: '', loan_amount: '', interest_rate: '',
    tenure_months: '', disbursement_date: '', penalty_per_day: '', grace_period_days: '0',
    penalty_cap_rupees: '0',
  });
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data) => api.post('/loans', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      onOpenChange(false);
      toast.success('Loan created successfully');
    },
    onError: (err) => {
      const d = err.response?.data;
      const details = d?.details;
      let msg = d?.error || 'Failed to create loan';
      if (Array.isArray(details) && details.length) {
        msg = details.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ');
      }
      setError(msg);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const pp = form.penalty_per_day === '' ? 0 : Math.round(Number(form.penalty_per_day) * 100);
    if (pp > 0 && pp < 100) {
      setError('Daily penalty must be 0 or at least ₹1/day (enter 1.00 or more in rupees).');
      return;
    }
    mutation.mutate({
      invoice_id: form.invoice_id,
      bank_name: form.bank_name,
      loan_amount: Math.round(Number(form.loan_amount) * 100),
      interest_rate: Number(form.interest_rate),
      tenure_months: Number(form.tenure_months),
      disbursement_date: form.disbursement_date,
      penalty_per_day: pp,
      grace_period_days: Number(form.grace_period_days) || 0,
      penalty_cap: Math.round((Number(form.penalty_cap_rupees) || 0) * 100),
    });
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
              <Label>Disbursement Date *</Label>
              <Input type="date" value={form.disbursement_date} onChange={set('disbursement_date')} required />
            </div>
          </div>

          <div className="rounded-md border border-border p-3 space-y-3 bg-muted/30">
            <p className="text-sm font-semibold">Penalty Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Grace Period (days) *</Label>
                <Input type="number" min="0" value={form.grace_period_days} onChange={set('grace_period_days')} required />
                <p className="text-[11px] text-muted-foreground">Penalty starts after this many days past the due date</p>
              </div>
              <div className="space-y-1">
                <Label>Penalty Per Day (₹) *</Label>
                <Input type="number" step="0.01" min="0" value={form.penalty_per_day} onChange={set('penalty_per_day')} required />
                <p className="text-[11px] text-muted-foreground">Enter rupees (e.g. 100 for ₹100/day). Use 0 for no daily penalty; if set, minimum is ₹1/day.</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Max Penalty Cap (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.penalty_cap_rupees} onChange={set('penalty_cap_rupees')} />
              <p className="text-[11px] text-muted-foreground">0 = no maximum limit</p>
            </div>
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

function LoanPenaltySheet({
  loan,
  open,
  onOpenChange,
  isAdmin,
  canRemind,
}) {
  const qc = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [waiveAmount, setWaiveAmount] = useState('');
  const [waiveNote, setWaiveNote] = useState('');
  const [waOpen, setWaOpen] = useState(false);

  const { data: pen, isLoading: penLoading } = useQuery({
    queryKey: ['loan-penalty', loan?.id],
    queryFn: () => api.get(`/loans/${loan.id}/penalty`).then((r) => r.data),
    enabled: open && !!loan?.id,
  });

  const current = pen?.current;
  const gross = loan ? Number(loan.total_penalty_accrued || 0) : 0;
  const alreadyWaived = loan ? Number(loan.penalty_waived || 0) : 0;
  const maxWaivePaise = Math.max(0, gross - alreadyWaived);

  const waiveMutation = useMutation({
    mutationFn: (body) => api.post(`/loans/${loan.id}/penalty/waive`, body),
    onSuccess: () => {
      toast.success('Penalty waived');
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['loans-penalty-summary'] });
      qc.invalidateQueries({ queryKey: ['loan-penalty', loan.id] });
      setWaiveOpen(false);
      setWaiveAmount('');
      setWaiveNote('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Waive failed'),
  });

  const waiveAmountPaise = Math.round((Number(waiveAmount) || 0) * 100);
  const remainingAfter = Math.max(0, gross - alreadyWaived - waiveAmountPaise);

  if (!loan) return null;

  const showPenaltySection = current?.isOverdue && loan.status !== 'closed';

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Loan — {loan.customer_name}</SheetTitle>
            <p className="text-sm text-muted-foreground font-normal">
              {loan.vehicle_make ? `${loan.vehicle_make} ${loan.vehicle_model}` : '—'} · {loan.bank_name}
            </p>
          </SheetHeader>

          <div className="mt-6 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Due</span><div className="font-medium">{formatDate(loan.due_date)}</div></div>
              <div><span className="text-muted-foreground">Status</span><div><Badge variant={STATUS_BADGE[loan.status]}>{loan.status}</Badge></div></div>
            </div>

            {penLoading && (
              <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            )}

            {showPenaltySection && current && (
              <div className="rounded-lg border-2 border-red-300 bg-red-50/60 p-4 space-y-3">
                <p className="font-semibold text-red-900">Loan Overdue — {current.calendarDaysPastDue} day{current.calendarDaysPastDue === 1 ? '' : 's'}</p>
                <div className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Due Date</span><span>{formatDate(loan.due_date)}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Grace Period</span><span>{Number(loan.grace_period_days ?? 0)} days</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Penalty Started</span><span>{current.penaltyFirstAccrualDate ? formatDate(current.penaltyFirstAccrualDate) : '—'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Daily Penalty</span><span>₹{(Number(current.penaltyPerDay || 0) / 100).toLocaleString('en-IN')}/day</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Days (penalty period)</span><span>{current.overdueDays}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Total Penalty (capped)</span><span>{formatCurrency(current.cappedPenalty)}</span></div>
                  {Number(loan.penalty_waived || 0) > 0 && (
                    <div className="flex justify-between gap-2"><span className="text-muted-foreground">Penalty Waived</span><span className="text-emerald-700 font-medium">{formatCurrency(loan.penalty_waived)}</span></div>
                  )}
                  <div className="flex justify-between gap-2 border-t border-red-200 pt-2"><span className="font-medium">Net Penalty Due</span><span className="font-bold text-red-700">{formatCurrency(current.netPenalty)}</span></div>
                </div>
                {Number(loan.penalty_cap || 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Penalty capped at ₹{(Number(loan.penalty_cap) / 100).toLocaleString('en-IN')}
                  </p>
                )}
                {current.gracePeriodActive && (
                  <p className="text-xs text-amber-800">Currently in grace period — no penalty accruing yet.</p>
                )}

                {isAdmin && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setWaiveOpen(true)} disabled={current.cappedPenalty <= 0}>
                      Waive Penalty
                    </Button>
                    {canRemind && (
                      <Button type="button" size="sm" className="bg-[#25d366] hover:bg-[#20bd5a] text-white" onClick={() => setWaOpen(true)}>
                        <MessageCircle className="h-3.5 w-3.5 mr-1" /> Send Reminder
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {pen?.history?.length > 0 && (
              <div className="border rounded-md">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
                  onClick={() => setHistoryOpen((v) => !v)}
                >
                  {historyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  View penalty history (last 30 days)
                </button>
                {historyOpen && (
                  <div className="px-2 pb-2 overflow-x-auto">
                    <Table>
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="text-left p-2">Date</th>
                          <th className="text-right p-2">Days OD</th>
                          <th className="text-right p-2">Daily</th>
                          <th className="text-right p-2">Added</th>
                          <th className="text-right p-2">Running</th>
                        </tr>
                      </thead>
                      <TableBody>
                        {pen.history.map((h) => (
                          <TableRow key={`${h.calc_date}-${h.running_total}`}>
                            <TableCell className="text-xs">{formatDate(h.calc_date)}</TableCell>
                            <TableCell className="text-xs text-right">{h.overdue_days}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatCurrency(h.penalty_per_day)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatCurrency(h.penalty_added)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatCurrency(h.running_total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={waiveOpen} onOpenChange={setWaiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Waive penalty</DialogTitle>
            <DialogDescription>Waive part of the accrued penalty (gross capped balance). Requires a reason.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Amount to waive (₹)</Label>
              <Input type="number" step="0.01" min="0" value={waiveAmount} onChange={(e) => setWaiveAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Max you can waive now: {formatCurrency(maxWaivePaise)}. Net after this waiver: {formatCurrency(remainingAfter)}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Note (min 10 characters) *</Label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={waiveNote}
                onChange={(e) => setWaiveNote(e.target.value)}
                placeholder="Reason for waiver (audit trail)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setWaiveOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={waiveMutation.isPending || waiveAmountPaise <= 0 || waiveNote.trim().length < 10 || waiveAmountPaise > maxWaivePaise}
              onClick={() => waiveMutation.mutate({ amount: waiveAmountPaise, note: waiveNote.trim() })}
            >
              {waiveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm waiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WhatsAppSendDialog
        key={waOpen ? `wa-loan-${loan.id}` : 'wa-loan-closed'}
        open={waOpen}
        onOpenChange={(o) => { if (!o) setWaOpen(false); }}
        kind="loan"
        entityId={loan.id}
        customerName={loan.customer_name}
        onAppSendSuccess={() => {
          qc.invalidateQueries({ queryKey: ['loan-penalty', loan.id] });
          qc.invalidateQueries({ queryKey: ['loans'] });
        }}
      />
    </>
  );
}

export default function LoansPage() {
  const { canWrite, isCA, isAdmin } = usePermissions();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addLoanKey, setAddLoanKey] = useState(0);
  const [filters, setFilters] = useState({ page: 1, limit: 25, status: '', overdue: '' });
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [sheetLoan, setSheetLoan] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading } = useLoans(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
  );

  const { data: summary } = useQuery({
    queryKey: ['loans-penalty-summary'],
    queryFn: () => api.get('/loans/penalty/summary').then((r) => r.data),
    enabled: isAdmin,
  });

  const enriched = useMemo(() => {
    const rawLoans = data?.loans || [];
    return rawLoans.map((l) => ({
      ...l,
      _netPen: netPenaltyPaise(l),
      _daysPast: calendarDaysPastDue(l.due_date),
      _grace: Number(l.grace_period_days ?? 0),
    }));
  }, [data?.loans]);

  const loans = sortKey ? sortData(enriched, sortKey, sortDir) : enriched;
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / filters.limit) || 1;

  const handleSort = (key, dir) => { setSortKey(key); setSortDir(dir); };

  const closeMutation = useMutation({
    mutationFn: (id) => api.patch(`/loans/${id}/close`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['loans-penalty-summary'] });
      toast.success('Loan marked as closed');
    },
  });

  const isOverdue = (loan) => (
    loan.status === 'overdue' || (loan.status === 'active' && calendarDaysPastDue(loan.due_date) > 0)
  );

  const openSheet = (loan) => {
    setSheetLoan(loan);
    setSheetOpen(true);
  };

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold">Loans</h2>
          {isCA ? <ReadOnlyBadge /> : null}
        </div>
        {canWrite && (
          <Button onClick={() => { setAddLoanKey((k) => k + 1); setAddOpen(true); }}>Add Loan</Button>
        )}
      </div>

      {isAdmin && summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Overdue loans</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{summary.total_overdue_loans}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Net penalty outstanding</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold text-red-700">{formatCurrency(summary.total_penalty_outstanding)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total waived</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold text-emerald-700">{formatCurrency(summary.total_waived)}</CardContent>
          </Card>
        </div>
      )}

      {isAdmin && summary?.by_branch?.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">By branch</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <Table>
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left p-2">Branch</th>
                  <th className="text-right p-2">Overdue</th>
                  <th className="text-right p-2">Net penalty</th>
                </tr>
              </thead>
              <TableBody>
                {summary.by_branch.map((b) => (
                  <TableRow key={b.branch_name}>
                    <TableCell>{b.branch_name}</TableCell>
                    <TableCell className="text-right">{b.overdue_count}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(b.total_penalty)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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

      <div className="bg-card rounded-lg border border-border">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} columns={9} /></div>
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
              <SortableTableHead sortKey="_netPen" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort} className="text-right">Penalty</SortableTableHead>
              {canWrite && <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">Actions</th>}
            </tr>
          </thead>
          <TableBody>
            {loans.map((loan) => {
              const od = loan._daysPast;
              const g = loan._grace;
              const inGrace = loan.status !== 'closed' && od > 0 && od <= g;
              const net = loan._netPen;
              return (
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
                    <div>{formatDate(loan.due_date)}</div>
                    {loan.status !== 'closed' && od > 0 && (
                      <div className="text-xs text-red-600 font-medium">Overdue {od} day{od === 1 ? '' : 's'}</div>
                    )}
                    {inGrace && (
                      <div className="text-xs text-amber-700 mt-0.5">
                        In grace period ({Math.max(0, g - od)} day{Math.max(0, g - od) === 1 ? '' : 's'} left)
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[loan.status]}>{loan.status}</Badge>
                  </TableCell>
                  <TableCell className={cn('text-right font-mono text-sm', net > 0 && 'text-destructive font-medium')}>
                    {inGrace && net === 0 ? (
                      <span className="text-amber-700 font-normal">—</span>
                    ) : net > 0 ? (
                      <span>{formatCurrency(net)}</span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" title="Details" onClick={() => openSheet(loan)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {loan.status !== 'closed' && (
                          <Button variant="ghost" size="sm" title="Mark Closed"
                            disabled={closeMutation.isPending}
                            onClick={() => { if (window.confirm('Close this loan?')) closeMutation.mutate(loan.id); }}>
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
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

      <AddLoanDialog key={addLoanKey} open={addOpen} onOpenChange={setAddOpen} />

      <LoanPenaltySheet
        loan={sheetLoan}
        open={sheetOpen}
        onOpenChange={(o) => { setSheetOpen(o); if (!o) setSheetLoan(null); }}
        isAdmin={isAdmin}
        canRemind={isAdmin}
      />
    </AppLayout>
  );
}
