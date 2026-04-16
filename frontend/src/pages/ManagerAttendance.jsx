import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { formatDate, cn, istYmd } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Users, Loader2, CheckCircle2, XCircle, MinusCircle, Plane, Download,
  ChevronDown, ChevronRight,
} from 'lucide-react';

function formatTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function statusBadge(workStatus) {
  if (workStatus === 'on_leave') return { label: 'On Leave', variant: 'default', className: 'bg-blue-600' };
  if (workStatus === 'present') return { label: 'Present', variant: 'success' };
  if (workStatus === 'working') return { label: 'Present', variant: 'success' };
  if (workStatus === 'not_clocked') return { label: 'Not yet clocked in', variant: 'secondary' };
  return { label: 'Absent', variant: 'destructive' };
}

function TodayTab({ branchId }) {
  const qc = useQueryClient();
  const [openUser, setOpenUser] = useState(null);
  const [form, setForm] = useState({ date: '', clock_in: '', clock_out: '', note: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-branch-today', branchId],
    queryFn: () => api.get(`/attendance/branch/${branchId}/today`).then((r) => r.data),
    enabled: !!branchId,
    refetchInterval: 60_000,
  });

  const regMut = useMutation({
    mutationFn: (body) => api.post('/attendance/regularize', body),
    onSuccess: () => {
      toast.success('Attendance updated');
      setOpenUser(null);
      setForm({ date: '', clock_in: '', clock_out: '', note: '' });
      qc.invalidateQueries({ queryKey: ['attendance-branch-today', branchId] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  if (!branchId) return <p className="text-sm text-muted-foreground">Select a branch</p>;
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const users = data?.users || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Today — {data?.date}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 font-medium text-muted-foreground">Name</th>
              <th className="text-left py-2 font-medium text-muted-foreground">Status</th>
              <th className="text-left py-2 font-medium text-muted-foreground">Clock in</th>
              <th className="text-left py-2 font-medium text-muted-foreground">Clock out</th>
              <th className="text-left py-2 font-medium text-muted-foreground">Hours</th>
              <th className="text-right py-2 font-medium text-muted-foreground">Regularize</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const sb = statusBadge(u.work_status);
              let hrs = '—';
              if (u.clock_in && u.clock_out) {
                const ms = new Date(u.clock_out) - new Date(u.clock_in);
                hrs = `${(ms / 3600000).toFixed(2)}h`;
              }
              return (
                <Fragment key={u.id}>
                  <tr className="border-b border-border/50">
                    <td className="py-2 font-medium">{u.name}</td>
                    <td className="py-2">
                      <Badge variant={sb.variant} className={cn('gap-1', sb.className)}>
                        {u.work_status === 'present' && <CheckCircle2 className="h-3 w-3" />}
                        {u.work_status === 'working' && <CheckCircle2 className="h-3 w-3" />}
                        {u.work_status === 'on_leave' && <Plane className="h-3 w-3" />}
                        {u.work_status === 'absent' && <XCircle className="h-3 w-3" />}
                        {u.work_status === 'not_clocked' && <MinusCircle className="h-3 w-3" />}
                        {sb.label}
                      </Badge>
                    </td>
                    <td className="py-2">{formatTime(u.clock_in)}</td>
                    <td className="py-2">{formatTime(u.clock_out)}</td>
                    <td className="py-2">{hrs}</td>
                    <td className="py-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => {
                          if (openUser === u.id) {
                            setOpenUser(null);
                          } else {
                            setOpenUser(u.id);
                            setForm({
                              date: data?.date || '',
                              clock_in: '',
                              clock_out: '',
                              note: '',
                            });
                          }
                        }}
                      >
                        Regularize
                      </Button>
                    </td>
                  </tr>
                  {openUser === u.id && (
                    <tr className="bg-muted/40">
                      <td colSpan={6} className="py-4 px-2">
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl">
                          <div className="space-y-1">
                            <Label className="text-xs">Date</Label>
                            <Input
                              type="date"
                              value={form.date}
                              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Clock in (ISO / datetime-local)</Label>
                            <Input
                              placeholder="2026-04-09T09:15"
                              value={form.clock_in}
                              onChange={(e) => setForm((f) => ({ ...f, clock_in: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Clock out</Label>
                            <Input
                              placeholder="2026-04-09T18:30"
                              value={form.clock_out}
                              onChange={(e) => setForm((f) => ({ ...f, clock_out: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-xs">Note</Label>
                            <Input
                              value={form.note}
                              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={regMut.isPending}
                            onClick={() => {
                              const d = form.date || data?.date;
                              const toIso = (t) => {
                                if (!t) return null;
                                if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
                                  if (/[zZ]$/.test(t) || /[+-]\d{2}:\d{2}$/.test(t)) return t;
                                  return `${t}+05:30`;
                                }
                                const timePart = t.length <= 5 ? `${t}:00` : t;
                                return `${d}T${timePart}+05:30`;
                              };
                              regMut.mutate({
                                user_id: u.id,
                                date: d,
                                clock_in: toIso(form.clock_in),
                                clock_out: toIso(form.clock_out),
                                note: form.note || undefined,
                              });
                            }}
                          >
                            Save
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setOpenUser(null)}>
                            Cancel
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function MonthlyTab({ branchId }) {
  const [searchParams] = useSearchParams();
  const filterUserId = searchParams.get('user_id');
  const now = new Date();
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-branch-month', branchId, y, m],
    queryFn: () => api.get(`/attendance/branch/${branchId}?year=${y}&month=${m}`).then((r) => r.data),
    enabled: !!branchId,
  });

  const lastDay = useMemo(() => new Date(y, m, 0).getDate(), [y, m]);

  const grid = useMemo(() => {
    if (!data?.users) return [];
    const users = filterUserId ? data.users.filter((u) => u.id === filterUserId) : data.users;
    const todayIst = istYmd();
    return users.map((u) => {
      const row = { user: u, cells: [] };
      for (let d = 1; d <= lastDay; d += 1) {
        const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dow = new Date(y, m - 1, d).getDay();
        let code = 'A';
        let title = 'Absent';
        if (dow === 0) {
          code = 'S';
          title = 'Sunday';
        } else if (ds > todayIst) {
          code = 'F';
          title = 'Upcoming';
        } else {
          const rec = data.attendanceByUser?.[u.id]?.[ds];
          if (rec?.status === 'on_leave') {
            code = 'L';
            title = 'On leave';
          } else if (rec?.clock_in) {
            code = 'P';
            title = `Present · ${formatTime(rec.clock_in)}–${formatTime(rec.clock_out)}`;
          } else if (ds === todayIst) {
            code = 'T';
            title = 'Today — pending clock-in';
          }
        }
        row.cells.push({ d, code, title, ds });
      }
      return row;
    });
  }, [data, y, m, lastDay, filterUserId]);

  const exportCsv = () => {
    if (!data?.users?.length) return;
    const header = ['Name', ...Array.from({ length: lastDay }, (_, i) => String(i + 1))];
    const lines = [header.join(',')];
    for (const r of grid) {
      const name = `"${r.user.name.replace(/"/g, '""')}"`;
      const codes = r.cells.map((c) => c.code);
      lines.push([name, ...codes].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `attendance_${branchId === 'all' ? 'all' : branchId}_${y}_${m}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!branchId) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Monthly grid</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="number" className="w-24 h-9" value={y} onChange={(e) => setY(Number(e.target.value))} min={2020} max={2035} />
          <Select value={String(m)} onChange={(e) => setM(Number(e.target.value))} className="w-28 h-9">
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>{new Date(2000, i, 1).toLocaleString('en', { month: 'short' })}</option>
            ))}
          </Select>
          <Button variant="outline" size="sm" type="button" className="gap-1" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : (
          <table className="text-xs border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card border p-2 text-left font-medium">Name</th>
                {Array.from({ length: lastDay }, (_, i) => (
                  <th key={i} className="border p-1 w-8 text-center font-medium text-muted-foreground">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((r) => (
                <tr key={r.user.id}>
                  <td className="sticky left-0 z-10 bg-card border p-2 font-medium whitespace-nowrap">{r.user.name}</td>
                  {r.cells.map((c) => (
                    <td
                      key={c.ds}
                      title={c.title}
                      className={cn(
                        'border p-1 text-center font-semibold',
                        c.code === 'P' && 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
                        c.code === 'A' && 'bg-red-50 text-red-800 dark:bg-red-950/50',
                        c.code === 'L' && 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
                        c.code === 'S' && 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800',
                        c.code === 'F' && 'bg-muted/40 text-muted-foreground',
                        c.code === 'T' && 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
                      )}
                    >
                      {c.code}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          P present · A absent · L leave · S Sunday · F upcoming · T today (pending)
        </p>
      </CardContent>
    </Card>
  );
}

function LeaveRequestsTab({ branchId }) {
  const { user } = useAuthStore();
  const isCompanyAdmin = ['company_admin', 'super_admin'].includes(user?.role);
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [filterStaff, setFilterStaff] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const { data: pendingData, isLoading: loadP } = useQuery({
    queryKey: ['leave-pending', branchId],
    queryFn: () => api.get('/attendance/leave/pending').then((r) => r.data.applications),
    enabled: !!branchId,
  });

  const { data: allData, isLoading: loadA } = useQuery({
    queryKey: ['leave-all', branchId, filterStaff, filterType, filterStatus, filterFrom, filterTo, showAll],
    queryFn: () => {
      const q = new URLSearchParams();
      if (filterStaff) q.set('staff_id', filterStaff);
      if (filterType) q.set('leave_type_id', filterType);
      if (filterStatus) q.set('status', filterStatus);
      if (filterFrom) q.set('from', filterFrom);
      if (filterTo) q.set('to', filterTo);
      return api.get(`/attendance/leave/all?${q}`).then((r) => r.data.applications);
    },
    enabled: !!branchId && showAll,
  });

  const { data: types } = useQuery({
    queryKey: ['leave-types-balance', branchId],
    queryFn: () => api.get(`/attendance/leave/my?year=${new Date().getFullYear()}`).then((r) => r.data.balances),
    enabled: showAll && !!branchId,
  });

  const { data: staffUsers } = useQuery({
    queryKey: ['users-for-leave-filter', branchId, isCompanyAdmin],
    queryFn: () => {
      if (isCompanyAdmin && branchId === 'all') {
        return api.get('/users?limit=200').then((r) => r.data.users);
      }
      if (isCompanyAdmin) {
        return api.get(`/users?branch_id=${branchId}&limit=200`).then((r) => r.data.users);
      }
      return api.get('/users?limit=200').then((r) => r.data.users);
    },
    enabled: showAll && !!branchId,
  });

  const approveMut = useMutation({
    mutationFn: (id) => api.patch(`/attendance/leave/${id}/approve`),
    onSuccess: () => {
      toast.success('Approved');
      qc.invalidateQueries({ queryKey: ['leave-pending'] });
      qc.invalidateQueries({ queryKey: ['leave-all'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, note }) => api.patch(`/attendance/leave/${id}/reject`, { review_note: note }),
    onSuccess: () => {
      toast.success('Rejected');
      setRejecting(null);
      setRejectNote('');
      qc.invalidateQueries({ queryKey: ['leave-pending'] });
      qc.invalidateQueries({ queryKey: ['leave-all'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const pending = pendingData || [];
  const pendingCount = pending.length;

  return (
    <div className="space-y-6">
      {loadP ? <Loader2 className="h-6 w-6 animate-spin" /> : null}

      {pendingCount > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pending</h3>
          {pending.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border p-4 transition-all duration-300"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-medium">{row.user_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.leave_type_name} · {formatDate(row.from_date)} – {formatDate(row.to_date)} · {row.total_days}d
                  </p>
                  <p className="text-sm mt-2">{row.reason}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Staff has{' '}
                    {row.balance_unlimited ? 'unlimited' : `${(row.balance_available ?? 0).toFixed(1)}`}{' '}
                    {row.leave_type_code} days available
                  </p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      type="button"
                      disabled={approveMut.isPending}
                      onClick={() => approveMut.mutate(row.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      type="button"
                      onClick={() => setRejecting(rejecting === row.id ? null : row.id)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
              {rejecting === row.id && (
                <div className="mt-4 space-y-2 border-t pt-3">
                  <Label className="text-xs">Reason for rejection (required)</Label>
                  <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} />
                  <Button
                    size="sm"
                    variant="destructive"
                    type="button"
                    disabled={!rejectNote.trim() || rejectMut.isPending}
                    onClick={() => rejectMut.mutate({ id: row.id, note: rejectNote })}
                  >
                    Confirm reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border rounded-lg">
        <button
          type="button"
          className="w-full flex items-center justify-between p-4 text-left font-medium"
          onClick={() => setShowAll((v) => !v)}
        >
          <span>All applications</span>
          {showAll ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showAll && (
          <div className="p-4 border-t space-y-4">
            <div className="flex flex-wrap gap-2">
              <Select value={filterStaff} onChange={(e) => setFilterStaff(e.target.value)} className="min-w-[10rem] max-w-xs">
                <option value="">All staff</option>
                {(staffUsers || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-44">
                <option value="">All types</option>
                {(types || []).map((t) => (
                  <option key={t.leave_type_id} value={t.leave_type_id}>{t.code}</option>
                ))}
              </Select>
              <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-36">
                <option value="">All status</option>
                <option value="pending">pending</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
                <option value="cancelled">cancelled</option>
              </Select>
              <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="w-40" />
              <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="w-40" />
            </div>
            {loadA ? <Loader2 className="h-5 w-5 animate-spin" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Name</th>
                      <th className="text-left py-2">Type</th>
                      <th className="text-left py-2">Dates</th>
                      <th className="text-left py-2">Days</th>
                      <th className="text-left py-2">Status</th>
                      <th className="text-left py-2">Reviewed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(allData || []).map((r) => (
                      <tr key={r.id} className="border-b border-border/50">
                        <td className="py-2">{r.user_name}</td>
                        <td className="py-2">{r.leave_type_code}</td>
                        <td className="py-2">{formatDate(r.from_date)} – {formatDate(r.to_date)}</td>
                        <td className="py-2">{r.total_days}</td>
                        <td className="py-2"><Badge variant="outline">{r.status}</Badge></td>
                        <td className="py-2">{r.reviewed_by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ManagerAttendance() {
  const { user } = useAuthStore();
  const isAdmin = ['company_admin', 'super_admin'].includes(user?.role);
  const [searchParams] = useSearchParams();

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.branches),
    enabled: isAdmin,
  });

  const [branchId, setBranchId] = useState('');

  useEffect(() => {
    if (isAdmin) {
      const fromUrl = searchParams.get('branch_id');
      setBranchId(fromUrl || 'all');
    } else if (user?.branch_id) {
      setBranchId(user.branch_id);
    }
  }, [isAdmin, user?.branch_id, searchParams]);

  const { data: pendingList } = useQuery({
    queryKey: ['leave-pending', branchId],
    queryFn: () => api.get('/attendance/leave/pending').then((r) => r.data.applications),
    enabled: !!branchId,
  });
  const pendingTabBadge = pendingList?.length ?? 0;
  const defaultTab = searchParams.get('tab') === 'monthly' ? 'monthly' : 'today';

  return (
    <AppLayout>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Attendance</h2>
        <p className="text-sm text-muted-foreground">Today, monthly grid, and leave approvals for your branch.</p>
        {isAdmin && branches?.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Branch</Label>
            <Select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="max-w-sm"
            >
              <option value="all">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <Tabs defaultValue={defaultTab} key={`${defaultTab}-${searchParams.toString()}`}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="leaves">
            Leave Requests{pendingTabBadge > 0 ? ` (${pendingTabBadge})` : ''}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <TodayTab branchId={branchId} />
        </TabsContent>
        <TabsContent value="monthly">
          <MonthlyTab branchId={branchId} />
        </TabsContent>
        <TabsContent value="leaves">
          <LeaveRequestsTab branchId={branchId} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
