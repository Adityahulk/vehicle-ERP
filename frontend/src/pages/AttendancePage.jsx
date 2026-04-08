import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { formatDate, cn } from '@/lib/utils';
import {
  Clock, LogIn, LogOut, Users, Download, Loader2,
  CheckCircle2, XCircle, MinusCircle,
} from 'lucide-react';

function formatTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatHours(h) {
  if (h == null) return '—';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
}

// ────────────────────────── Clock Card ──────────────────────────

function ClockCard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['my-attendance'],
    queryFn: () => api.get('/attendance/me').then((r) => r.data.record),
    refetchInterval: 30_000,
  });

  const clockInMut = useMutation({
    mutationFn: () => api.post('/attendance/clockin'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-attendance'] }),
  });

  const clockOutMut = useMutation({
    mutationFn: () => api.post('/attendance/clockout'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-attendance'] }),
  });

  const isClockedIn = data?.clock_in && !data?.clock_out;
  const isClockedOut = data?.clock_in && data?.clock_out;
  const notClockedIn = !data;

  return (
    <Card className="overflow-hidden">
      <div className={cn(
        'h-1.5',
        isClockedIn && 'bg-emerald-500',
        isClockedOut && 'bg-blue-500',
        notClockedIn && 'bg-muted-foreground/30',
      )} />
      <CardContent className="pt-6 pb-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* Status */}
          <div className="flex-1 text-center sm:text-left">
            <div className="flex items-center gap-2 justify-center sm:justify-start mb-1">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Today's Attendance</span>
            </div>

            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto sm:mx-0" />
            ) : isClockedIn ? (
              <div>
                <p className="text-lg font-semibold text-emerald-600">Clocked in at {formatTime(data.clock_in)}</p>
                <p className="text-sm text-muted-foreground">Currently working</p>
              </div>
            ) : isClockedOut ? (
              <div>
                <p className="text-lg font-semibold text-blue-600">Day complete</p>
                <p className="text-sm text-muted-foreground">
                  {formatTime(data.clock_in)} — {formatTime(data.clock_out)}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-semibold text-muted-foreground">Not clocked in today</p>
                <p className="text-sm text-muted-foreground">Tap the button to start your day</p>
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="shrink-0">
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
            {isClockedOut && (
              <Badge variant="secondary" className="text-sm py-1.5 px-3">
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Done for today
              </Badge>
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

// ────────────────────────── Today's Branch Attendance ──────────────────────────

function TodayTable() {
  const { user } = useAuthStore();
  const branchId = user?.branch_id;

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-today', branchId],
    queryFn: () => api.get(`/attendance/today/${branchId}`).then((r) => r.data),
    enabled: !!branchId,
    refetchInterval: 60_000,
  });

  if (!branchId) return null;

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!data) return null;

  const { summary, users } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Today's Branch Attendance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-4">
          <Badge variant="default">{summary.total} Total</Badge>
          <Badge variant="success">{summary.clocked_in} Working</Badge>
          <Badge variant="secondary">{summary.clocked_out} Done</Badge>
          <Badge variant="destructive">{summary.absent} Absent</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-medium text-muted-foreground">Name</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Role</th>
                <th className="text-center py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Clock In</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Clock Out</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isIn = u.clock_in && !u.clock_out;
                const isDone = u.clock_in && u.clock_out;
                const isAbsent = !u.clock_in;

                return (
                  <tr key={u.id} className={cn('border-b border-border/50', isAbsent && 'bg-destructive/5')}>
                    <td className="py-2 font-medium">{u.name}</td>
                    <td className="py-2"><Badge variant="outline">{u.role}</Badge></td>
                    <td className="py-2 text-center">
                      {isIn && <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Working</Badge>}
                      {isDone && <Badge variant="secondary" className="gap-1"><MinusCircle className="h-3 w-3" /> Done</Badge>}
                      {isAbsent && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Absent</Badge>}
                    </td>
                    <td className="py-2">{formatTime(u.clock_in)}</td>
                    <td className="py-2">{formatTime(u.clock_out)}</td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No staff in this branch</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────── Attendance Report ──────────────────────────

function ReportSection() {
  const { user } = useAuthStore();
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const today = now.toISOString().split('T')[0];

  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState('');

  const isManager = ['branch_manager', 'company_admin', 'super_admin'].includes(user?.role);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.branches),
    enabled: isManager,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['attendance-report', from, to, branchId],
    queryFn: () => {
      let url = `/attendance/report?from=${from}&to=${to}`;
      if (branchId) url += `&branch_id=${branchId}`;
      return api.get(url).then((r) => r.data);
    },
    enabled: false,
  });

  const handleExportCSV = () => {
    if (!data?.records?.length) return;
    const header = ['Date', 'Name', 'Role', 'Branch', 'Clock In', 'Clock Out', 'Hours Worked'].join(',');
    const rows = data.records.map((r) => [
      r.date,
      `"${r.user_name}"`,
      r.user_role,
      `"${r.branch_name || ''}"`,
      r.clock_in ? new Date(r.clock_in).toLocaleTimeString('en-IN') : '',
      r.clock_out ? new Date(r.clock_out).toLocaleTimeString('en-IN') : '',
      r.hours_worked != null ? r.hours_worked : '',
    ].join(','));

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `attendance_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!isManager) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Attendance Report</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label>Branch</Label>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-44">
              <option value="">All Branches</option>
              {(branches || []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </div>
          <Button onClick={() => refetch()} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Generate
          </Button>
          {data?.records?.length > 0 && (
            <Button variant="outline" onClick={handleExportCSV} className="gap-1.5">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          )}
        </div>

        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Name</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Role</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Branch</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Clock In</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Clock Out</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2">{formatDate(r.date)}</td>
                    <td className="py-2 font-medium">{r.user_name}</td>
                    <td className="py-2"><Badge variant="outline">{r.user_role}</Badge></td>
                    <td className="py-2">{r.branch_name || '—'}</td>
                    <td className="py-2">{formatTime(r.clock_in)}</td>
                    <td className="py-2">{formatTime(r.clock_out)}</td>
                    <td className={cn(
                      'py-2 text-right font-medium',
                      r.hours_worked != null && r.hours_worked < 6 && 'text-amber-600',
                      r.hours_worked != null && r.hours_worked >= 8 && 'text-emerald-600',
                    )}>
                      {formatHours(r.hours_worked)}
                    </td>
                  </tr>
                ))}
                {data.records.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!data && !isLoading && (
          <p className="text-sm text-muted-foreground text-center py-8">Select a date range and click Generate</p>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────── Main Page ──────────────────────────

export default function AttendancePage() {
  return (
    <AppLayout>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Attendance</h2>
        <p className="text-sm text-muted-foreground">Track daily clock in/out and generate reports</p>
      </div>

      <div className="space-y-6">
        <ClockCard />
        <TodayTable />
        <ReportSection />
      </div>
    </AppLayout>
  );
}
