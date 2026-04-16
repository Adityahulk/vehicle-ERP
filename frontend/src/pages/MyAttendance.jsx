import { useEffect, useMemo, useState } from 'react';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { formatDate, cn, istYmd } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Clock, LogIn, LogOut, Loader2, CheckCircle2, CalendarPlus,
} from 'lucide-react';
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format as fmt,
  getDay,
} from 'date-fns';

function formatTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function countWorkingDaysMonSat(fromStr, toStr) {
  if (!fromStr || !toStr || fromStr > toStr) return 0;
  let n = 0;
  const cur = new Date(`${fromStr}T12:00:00`);
  const end = new Date(`${toStr}T12:00:00`);
  while (cur <= end) {
    if (cur.getDay() !== 0) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

const LEAVE_BADGE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'secondary',
};

function useNowTick(active) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return t;
}

function ClockSection() {
  const role = useAuthStore((s) => s.user?.role);
  const isCompanyAdmin = role === 'company_admin' || role === 'super_admin';

  if (isCompanyAdmin) {
    return (
      <Card>
        <CardContent className="pt-6 pb-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">No personal clock-in</p>
          <p>
            Company administrators are not expected to clock in or out. Use{' '}
            <strong>Team attendance</strong> to review and manage staff time.
          </p>
        </CardContent>
      </Card>
    );
  }

  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-attendance-today'],
    queryFn: () => api.get('/attendance/me').then((r) => r.data),
    refetchInterval: 30_000,
  });
  const record = data?.record;
  const hoursToday = data?.hours_today;

  const clockInMut = useMutation({
    mutationFn: () => api.post('/attendance/clockin'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-attendance-today'] }),
  });
  const clockOutMut = useMutation({
    mutationFn: () => api.post('/attendance/clockout'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-attendance-today'] }),
  });

  const isClockedIn = record?.clock_in && !record?.clock_out;
  const isClockedOut = record?.clock_in && record?.clock_out;
  const onLeave = record?.status === 'on_leave';
  const notClockedIn = !record && !onLeave;
  const tick = useNowTick(isClockedIn);

  let elapsedLabel = '';
  if (isClockedIn && record?.clock_in) {
    const ms = tick - new Date(record.clock_in).getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    elapsedLabel = `${h}h ${m}m ${s}s`;
  }

  return (
    <Card className="overflow-hidden">
      <div
        className={cn(
          'h-1.5',
          onLeave && 'bg-blue-500',
          isClockedIn && 'bg-emerald-500',
          isClockedOut && 'bg-emerald-600',
          notClockedIn && !onLeave && 'bg-muted-foreground/30',
        )}
      />
      <CardContent className="pt-6 pb-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="flex-1 text-center sm:text-left w-full">
            <div className="flex items-center gap-2 justify-center sm:justify-start mb-1">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Today</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {new Date().toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>

            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto sm:mx-0" />
            ) : onLeave ? (
              <div>
                <p className="text-lg font-semibold text-blue-600">On approved leave today</p>
                <p className="text-sm text-muted-foreground">Clock-in is not available</p>
              </div>
            ) : isClockedIn ? (
              <div>
                <p className="text-lg font-semibold text-emerald-600">Clocked in at {formatTime(record.clock_in)}</p>
                <p className="text-2xl font-mono font-semibold tabular-nums mt-2">{elapsedLabel}</p>
              </div>
            ) : isClockedOut ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 p-4">
                <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" /> Day complete
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatTime(record.clock_in)} — {formatTime(record.clock_out)}
                  {hoursToday != null && ` · ${Number(hoursToday).toFixed(2)} hrs`}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-semibold text-muted-foreground">Not clocked in</p>
                <p className="text-sm text-muted-foreground">Tap Clock In to start your day</p>
              </div>
            )}
          </div>

          <div className="shrink-0 flex flex-col items-center gap-2">
            {notClockedIn && (
              <Button
                size="lg"
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-6 text-base"
                onClick={() => clockInMut.mutate()}
                disabled={clockInMut.isPending}
              >
                {clockInMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                Clock In
              </Button>
            )}
            {isClockedIn && (
              <Button
                size="lg"
                variant="destructive"
                className="gap-2 px-8 py-6 text-base"
                onClick={() => clockOutMut.mutate()}
                disabled={clockOutMut.isPending}
              >
                {clockOutMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
                Clock Out
              </Button>
            )}
          </div>
        </div>
        {(clockInMut.isError || clockOutMut.isError) && (
          <p className="text-sm text-destructive mt-3 text-center">
            {clockInMut.error?.response?.data?.error || clockOutMut.error?.response?.data?.error || 'Something went wrong'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MiniCalendar() {
  const now = new Date();
  const [cursor, setCursor] = useState(now);
  const y = cursor.getFullYear();
  const m = cursor.getMonth() + 1;

  const { data } = useQuery({
    queryKey: ['my-attendance-month', y, m],
    queryFn: () => api.get(`/attendance/my?year=${y}&month=${m}`).then((r) => r.data),
  });

  const byDate = useMemo(() => {
    const map = {};
    (data?.days || []).forEach((d) => {
      const key = typeof d.date === 'string' ? d.date.slice(0, 10) : d.date?.slice?.(0, 10);
      if (key) map[key] = d;
    });
    return map;
  }, [data?.days]);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  const summary = data?.summary;

  const [tip, setTip] = useState(null);

  function cellMeta(ds, dow) {
    if (dow === 0) return { kind: 'sun' };
    const todayStr = istYmd();
    if (ds > todayStr) return { kind: 'upcoming', rec: null };
    const rec = byDate[ds];
    if (rec?.status === 'on_leave') return { kind: 'leave', rec };
    if (rec?.clock_in) return { kind: 'present', rec };
    if (ds === todayStr) return { kind: 'pending', rec: null };
    return { kind: 'absent', rec: null };
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Calendar</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" type="button" onClick={() => setCursor(new Date(y, m - 2, 1))}>
            Prev
          </Button>
          <span className="text-sm font-medium min-w-[8rem] text-center">
            {fmt(cursor, 'MMMM yyyy')}
          </span>
          <Button variant="outline" size="sm" type="button" onClick={() => setCursor(new Date(y, m, 1))}>
            Next
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-2">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((day) => {
            const ds = fmt(day, 'yyyy-MM-dd');
            const dow = getDay(day);
            const meta = cellMeta(ds, dow);

            let dot = 'bg-muted-foreground/25';
            if (meta.kind === 'sun') dot = 'bg-zinc-300 dark:bg-zinc-600';
            else if (meta.kind === 'leave') dot = 'bg-blue-500';
            else if (meta.kind === 'present') dot = 'bg-emerald-500';
            else if (meta.kind === 'absent') dot = 'bg-red-500';
            else if (meta.kind === 'upcoming') dot = 'bg-muted-foreground/20';
            else if (meta.kind === 'pending') dot = 'bg-amber-400';

            const title =
              meta.kind === 'sun'
                ? 'Sunday'
                : meta.kind === 'leave'
                  ? 'On leave'
                  : meta.kind === 'present'
                    ? `In ${formatTime(meta.rec.clock_in)} · Out ${formatTime(meta.rec.clock_out)}`
                    : meta.kind === 'upcoming'
                      ? 'Upcoming'
                      : meta.kind === 'pending'
                        ? 'Today — not clocked in yet'
                        : 'Absent';

            return (
              <button
                key={ds}
                type="button"
                title={title}
                onClick={() => setTip({ ds, meta })}
                className="aspect-square rounded-md border border-border/60 flex flex-col items-center justify-center gap-1 hover:bg-accent/50 text-sm relative"
              >
                <span>{fmt(day, 'd')}</span>
                <span className={cn('h-2 w-2 rounded-full', dot)} />
              </button>
            );
          })}
        </div>

        {tip && (
          <div className="mt-4 rounded-md border bg-card p-3 text-sm">
            <p className="font-medium mb-1">{tip.ds}</p>
            {tip.meta.kind === 'sun' && <p className="text-muted-foreground">Sunday</p>}
            {tip.meta.kind === 'leave' && <p className="text-blue-600">On leave</p>}
            {tip.meta.kind === 'upcoming' && <p className="text-muted-foreground">Upcoming day</p>}
            {tip.meta.kind === 'pending' && <p className="text-amber-700 dark:text-amber-400">Today — clock in when you start</p>}
            {tip.meta.kind === 'absent' && <p className="text-red-600">Absent / no clock-in</p>}
            {tip.meta.kind === 'present' && tip.meta.rec && (
              <p className="text-muted-foreground">
                In {formatTime(tip.meta.rec.clock_in)} · Out {formatTime(tip.meta.rec.clock_out)}
                {tip.meta.rec.hours_worked != null && ` · ${tip.meta.rec.hours_worked}h`}
              </p>
            )}
            <Button variant="ghost" size="sm" className="mt-2 h-7" type="button" onClick={() => setTip(null)}>
              Close
            </Button>
          </div>
        )}

        {summary && (
          <div className="mt-4 flex flex-wrap gap-3 text-sm border-t pt-4">
            <span><span className="text-muted-foreground">Present:</span> {summary.present}</span>
            <span><span className="text-muted-foreground">Absent:</span> {summary.absent}</span>
            <span><span className="text-muted-foreground">On leave:</span> {summary.on_leave}</span>
            <span><span className="text-muted-foreground">Hours:</span> {summary.hours_month}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LeavesTab() {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leave-my', year],
    queryFn: () => api.get(`/attendance/leave/my?year=${year}`).then((r) => r.data),
  });

  const applyMut = useMutation({
    mutationFn: () =>
      api.post('/attendance/leave/apply', {
        leave_type_id: leaveTypeId,
        from_date: from,
        to_date: to,
        reason,
        half_day: halfDay,
      }),
    onSuccess: () => {
      toast.success('Leave request submitted. Pending manager approval.');
      setSheetOpen(false);
      setFrom('');
      setTo('');
      setReason('');
      setHalfDay(false);
      qc.invalidateQueries({ queryKey: ['leave-my', year] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to submit'),
  });

  const cancelMut = useMutation({
    mutationFn: (id) => api.patch(`/attendance/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success('Cancelled');
      qc.invalidateQueries({ queryKey: ['leave-my', year] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Cannot cancel'),
  });

  const working = useMemo(() => {
    if (halfDay) return from && to && from === to ? 0.5 : 0;
    return countWorkingDaysMonSat(from, to);
  }, [from, to, halfDay]);

  function pillClass(b) {
    if (b.unlimited) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200';
    const a = b.available;
    if (a > 3) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200';
    if (a >= 1) return 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
    return 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200';
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-2 flex-1 min-w-0">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            (data?.balances || []).map((b) => (
              <span
                key={b.leave_type_id}
                className={cn('px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap', pillClass(b))}
              >
                {b.code}:{' '}
                {b.unlimited ? 'unlimited' : `${Math.max(0, b.available ?? 0).toFixed(1)}/${b.days_per_year}`}
              </span>
            ))
          )}
        </div>
        <Button className="gap-2 shrink-0" type="button" onClick={() => setSheetOpen(true)}>
          <CalendarPlus className="h-4 w-4" />
          Apply for Leave
        </Button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Apply for leave</SheetTitle>
            <SheetDescription>Your manager will be notified for approval.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1">
              <Label>Leave type</Label>
              <Select
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
                className="w-full"
              >
                <option value="">Select…</option>
                {(data?.balances || []).map((b) => (
                  <option key={b.leave_type_id} value={b.leave_type_id}>
                    {b.name}
                    {' — '}
                    {b.unlimited ? 'unlimited' : `${Math.max(0, b.available ?? 0).toFixed(1)} days left`}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
              Half day
            </label>
            <p className="text-sm text-muted-foreground">
              This uses <span className="font-medium text-foreground">{working}</span> working day(s) (Mon–Sat, no Sundays).
            </p>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Required" />
            </div>
            <Button
              disabled={!leaveTypeId || !from || !to || !reason.trim() || applyMut.isPending}
              onClick={() => applyMut.mutate()}
            >
              {applyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Submit
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My applications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.applications || []).map((row) => (
            <div key={row.id} className="rounded-lg border p-3 text-sm space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{row.leave_type_code}</Badge>
                <span className="text-muted-foreground">
                  {formatDate(row.from_date)} — {formatDate(row.to_date)}
                </span>
                <span className="text-xs">{row.total_days}d</span>
                <Badge variant={LEAVE_BADGE[row.status] || 'secondary'}>{row.status}</Badge>
              </div>
              <p className="text-muted-foreground line-clamp-2">{row.reason}</p>
              {row.status === 'rejected' && row.review_note && (
                <p className="text-xs text-destructive">{row.review_note}</p>
              )}
              {row.status === 'pending' && (
                <button
                  type="button"
                  className="text-xs text-primary underline"
                  onClick={() => cancelMut.mutate(row.id)}
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
          {!isLoading && (!data?.applications || data.applications.length === 0) && (
            <p className="text-sm text-muted-foreground">No applications this year.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function MyAttendance() {
  const role = useAuthStore((s) => s.user?.role);
  const isCompanyAdmin = role === 'company_admin' || role === 'super_admin';

  return (
    <AppLayout>
      <div className="mb-6 max-w-3xl">
        <h2 className="text-2xl font-semibold">Attendance</h2>
        <p className="text-sm text-muted-foreground">
          {isCompanyAdmin
            ? 'View your month and manage leave. Personal clock-in/out is not used for company admins — use Team attendance for staff.'
            : 'Clock in/out, view your month, and manage leave. Admins review everyone under Team attendance.'}
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        <Tabs defaultValue="attendance">
          <TabsList>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="leaves">My Leaves</TabsTrigger>
          </TabsList>
          <TabsContent value="attendance" className="space-y-6">
            <ClockSection />
            <MiniCalendar />
          </TabsContent>
          <TabsContent value="leaves">
            <LeavesTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
