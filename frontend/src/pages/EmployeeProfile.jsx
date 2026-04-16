import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { formatCurrency, formatDate, formatNumber, cn, toInputDate } from '@/lib/utils';
import { Loader2, ArrowDownRight, ArrowUpRight, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';

const EMP_TYPE_LABEL = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  probation: 'Probation',
};

function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p[1]?.[0] || '')).toUpperCase();
}

function tenurePhrase(joinStr) {
  if (!joinStr) return '—';
  const j = new Date(`${String(joinStr).slice(0, 10)}T12:00:00Z`);
  const now = new Date();
  let months = (now.getFullYear() - j.getFullYear()) * 12 + (now.getMonth() - j.getMonth());
  if (now.getDate() < j.getDate()) months -= 1;
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y > 0) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m > 0) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' ') : 'Less than a month';
}

function statusForProfile(profile) {
  if (profile.resigned_at) return { label: 'Resigned', className: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' };
  if (!profile.is_active) return { label: 'Inactive', variant: 'secondary' };
  const probEnd = profile.probation_end_date?.slice?.(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (profile.employment_type === 'probation' || (probEnd && today <= probEnd)) {
    return { label: 'Probation', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' };
  }
  return { label: 'Active', variant: 'success' };
}

function rupeesFromPaise(paise) {
  return Number(paise) / 100;
}

export default function EmployeeProfile() {
  const { userId } = useParams();
  const { user: auth } = useAuthStore();
  const qc = useQueryClient();
  const isAdmin = ['company_admin', 'super_admin'].includes(auth?.role);
  const profileAllowed = isAdmin || auth?.id === userId;
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [salaryForm, setSalaryForm] = useState({ annual_salary: '', salary_effective_date: '', salary_change_reason: '' });
  const [resignOpen, setResignOpen] = useState(false);
  const [resignForm, setResignForm] = useState({ resigned_at: toInputDate(new Date().toISOString()), resignation_reason: '' });
  const [notesLocal, setNotesLocal] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['employee-profile', userId],
    queryFn: () => api.get(`/employees/${userId}`).then((r) => r.data),
    enabled: !!userId && profileAllowed,
  });

  const attQuery = useQuery({
    queryKey: ['employee-attendance-summary', userId],
    queryFn: () => api.get(`/employees/${userId}/attendance-summary`).then((r) => r.data),
    enabled: !!userId && profileAllowed && !!data,
  });

  const leaveQuery = useQuery({
    queryKey: ['employee-leave-balances', userId],
    queryFn: () => api.get(`/employees/${userId}/leave-balances`).then((r) => r.data),
    enabled: !!userId && profileAllowed && !!data,
  });

  const profile = data?.profile;
  const u = data?.user;
  const history = data?.salary_history || [];

  useEffect(() => {
    if (!data?.profile) return;
    const p = data.profile;
    setNotesLocal(Object.prototype.hasOwnProperty.call(p, 'notes') ? (p.notes ?? '') : '');
  }, [data?.profile]);

  const patchMut = useMutation({
    mutationFn: (body) => api.patch(`/employees/${userId}`, body),
    onSuccess: (_d, vars) => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['employee-profile', userId] });
      qc.invalidateQueries({ queryKey: ['employees-list'] });
      if (vars && Object.prototype.hasOwnProperty.call(vars, 'annual_salary')) setSalaryOpen(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const resignMut = useMutation({
    mutationFn: (body) => api.post(`/employees/${userId}/resign`, body),
    onSuccess: () => {
      toast.success('Marked as resigned');
      setResignOpen(false);
      qc.invalidateQueries({ queryKey: ['employee-profile', userId] });
      qc.invalidateQueries({ queryKey: ['employees-list'] });
      qc.invalidateQueries({ queryKey: ['users-settings'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  if (!profileAllowed) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (error?.response?.status === 404 || !data) {
    const backTo =
      auth?.role === 'company_admin' || auth?.role === 'super_admin'
        ? '/settings'
        : auth?.role === 'branch_manager'
          ? '/branch-dashboard'
          : '/my-attendance';
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto py-16 text-center space-y-3">
          <p className="text-muted-foreground">No employee profile for this user.</p>
          <Button variant="outline" asChild>
            <Link to={backTo}>Go back</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const annualRupees = rupeesFromPaise(profile.annual_salary);
  const monthlyRupees = annualRupees / 12;
  const dailyRupees = annualRupees / 365;
  const probEnd = profile.probation_end_date?.slice?.(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const probationDone = probEnd && probEnd < todayStr;
  const st = statusForProfile(profile);
  const att = attQuery.data?.summary;

  const settingsHref =
    auth?.role === 'company_admin' || auth?.role === 'super_admin'
      ? '/settings'
      : auth?.role === 'branch_manager'
        ? '/branch-dashboard'
        : '/my-attendance';

  const attendanceHref = u?.branch_id
    ? `/attendance?branch_id=${u.branch_id}&user_id=${userId}&tab=monthly`
    : `/attendance?user_id=${userId}&tab=monthly`;

  return (
    <AppLayout>
      <div className="mb-6">
        <Button variant="ghost" size="sm" className="gap-1 -ml-2 mb-2" asChild>
          <Link to={settingsHref}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Employee profile</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <Card>
            <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
              <div className="h-16 w-16 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xl font-semibold">
                {initials(u.name)}
              </div>
              <div>
                <h2 className="text-xl font-bold">{u.name}</h2>
                <p className="font-mono text-sm text-muted-foreground">{profile.employee_code}</p>
              </div>
              <Badge variant="outline">{profile.designation}</Badge>
              <div className="flex flex-wrap justify-center gap-1.5">
                {profile.department && <Badge variant="secondary">{profile.department}</Badge>}
                {u.branch_name && <Badge variant="outline">{u.branch_name}</Badge>}
                <Badge variant="outline">{EMP_TYPE_LABEL[profile.employment_type] || profile.employment_type}</Badge>
                {'className' in st && st.className ? (
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-md', st.className)}>{st.label}</span>
                ) : (
                  <Badge variant={st.variant}>{st.label}</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Contact</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p><span className="text-muted-foreground">Phone</span> · {u.phone || '—'}</p>
              <p><span className="text-muted-foreground">Email</span> · {u.email}</p>
              <p><span className="text-muted-foreground">Address</span> · {profile.address || '—'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Emergency contact</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {profile.emergency_contact_name || profile.emergency_contact_phone ? (
                <p>
                  {profile.emergency_contact_name || '—'}
                  {profile.emergency_contact_phone ? ` · ${profile.emergency_contact_phone}` : ''}
                </p>
              ) : (
                <p className="text-muted-foreground">Not provided</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-8">
          <Tabs defaultValue="employment">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="employment">Employment</TabsTrigger>
              <TabsTrigger value="salary">Salary history</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
              <TabsTrigger value="leave">Leave balances</TabsTrigger>
              <TabsTrigger value="docs">Documents</TabsTrigger>
            </TabsList>

            <TabsContent value="employment" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <CardTitle className="text-base">Employment details</CardTitle>
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setSalaryForm({
                        annual_salary: String(Math.round(annualRupees)),
                        salary_effective_date: toInputDate(new Date().toISOString()),
                        salary_change_reason: '',
                      });
                      setSalaryOpen(true);
                    }}>
                      Revise salary
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="text-sm space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-muted-foreground text-xs">Joining date</p>
                      <p className="font-medium">{formatDate(profile.joining_date)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Tenure: {tenurePhrase(profile.joining_date)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Probation end</p>
                      <p className="font-medium">{probEnd ? formatDate(probEnd) : '—'}</p>
                      {probationDone && <p className="text-xs text-emerald-600 mt-0.5">Probation completed</p>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-4 bg-muted/30">
                    <p className="text-xs text-muted-foreground">Annual salary</p>
                    <p className="text-2xl font-semibold tracking-tight">{formatCurrency(profile.annual_salary)}<span className="text-sm font-normal text-muted-foreground">/year</span></p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Monthly <span className="font-medium text-foreground">{formatNumber(Math.round(monthlyRupees))}</span>
                      {' · '}
                      Daily <span className="font-medium text-foreground">{formatNumber(Math.round(dailyRupees))}</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="salary" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Salary revisions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {history.length === 0 && <p className="text-sm text-muted-foreground">No revisions yet.</p>}
                  {history.map((row) => {
                    const oldR = rupeesFromPaise(row.old_salary);
                    const newR = rupeesFromPaise(row.new_salary);
                    const pct = oldR ? (((newR - oldR) / oldR) * 100).toFixed(1) : '0';
                    const up = newR >= oldR;
                    return (
                      <div key={row.id} className="border border-border rounded-lg p-3 text-sm space-y-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-medium">{formatDate(row.effective_date)}</span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {up ? <ArrowUpRight className="h-4 w-4 text-emerald-600" /> : <ArrowDownRight className="h-4 w-4 text-red-600" />}
                            {up ? '+' : ''}{pct}%
                          </span>
                        </div>
                        <p>
                          {formatCurrency(row.old_salary)} → {formatCurrency(row.new_salary)}
                          <span className="text-muted-foreground"> ({formatNumber(Math.round(newR - oldR))} ₹)</span>
                        </p>
                        {row.reason && <p className="text-muted-foreground">{row.reason}</p>}
                        <p className="text-xs text-muted-foreground">By {row.revised_by_name || '—'}</p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attendance" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">This month</CardTitle>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={attendanceHref}>Open attendance grid</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {attQuery.isLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Present</p>
                        <p className="text-xl font-semibold">{att?.present ?? '—'}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Absent</p>
                        <p className="text-xl font-semibold">{att?.absent ?? '—'}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">On leave</p>
                        <p className="text-xl font-semibold">{att?.on_leave ?? '—'}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Hours (month)</p>
                        <p className="text-xl font-semibold">{att?.hours_month ?? '—'}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="leave" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Leave balances ({leaveQuery.data?.year ?? new Date().getFullYear()})</CardTitle>
                </CardHeader>
                <CardContent>
                  {leaveQuery.isLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <div className="space-y-2 text-sm">
                      {(leaveQuery.data?.balances || []).map((b) => (
                        <div key={b.leave_type_id} className="flex justify-between border-b border-border/50 py-2">
                          <span>{b.name} <span className="text-muted-foreground">({b.code})</span></span>
                          <span>
                            {b.unlimited ? 'Unlimited' : (
                              <>
                                <span className="font-medium">{b.available != null ? Number(b.available).toFixed(1) : '—'}</span>
                                <span className="text-muted-foreground"> / {b.days_per_year} d · used {Number(b.used).toFixed(1)}</span>
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="docs" className="mt-4">
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                  Document upload coming soon
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {isAdmin && (
            <Card className="mt-6 border-dashed">
              <CardHeader>
                <CardTitle className="text-base text-amber-900 dark:text-amber-200">HR (admin only)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>HR notes</Label>
                  <Textarea
                    rows={3}
                    value={notesLocal}
                    onChange={(e) => setNotesLocal(e.target.value)}
                    onBlur={() => {
                      if (notesLocal !== (profile.notes || '')) {
                        patchMut.mutate({ notes: notesLocal });
                      }
                    }}
                    placeholder="Internal notes — not visible to the employee"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Bank</p>
                    <p>{profile.bank_name || '—'}</p>
                    <p className="font-mono">{profile.bank_account_number || '—'}</p>
                    <p className="font-mono text-xs">{profile.bank_ifsc || '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">PAN</p>
                    <p className="font-mono">{profile.pan_number || '—'}</p>
                    <p className="text-muted-foreground text-xs mt-2">Aadhar</p>
                    <p className="font-mono">{profile.aadhar_number || '—'}</p>
                  </div>
                </div>
                <Button variant="destructive" size="sm" onClick={() => setResignOpen(true)} disabled={!!profile.resigned_at}>
                  Mark as resigned
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={salaryOpen} onOpenChange={setSalaryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revise salary</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Current <span className="font-medium text-foreground">{formatCurrency(profile.annual_salary)}</span>
              {' → '}
              New{' '}
              <span className="font-medium text-foreground">
                {salaryForm.annual_salary ? formatCurrency(Math.round(Number(salaryForm.annual_salary) * 100)) : '—'}
              </span>
            </p>
            {salaryForm.annual_salary && Number(salaryForm.annual_salary) !== annualRupees && annualRupees > 0 && (
              <p className="text-xs text-muted-foreground">
                Change:{' '}
                {(
                  ((Number(salaryForm.annual_salary) - annualRupees) / annualRupees) *
                  100
                ).toFixed(1)}
                % · {formatNumber(Math.round(Number(salaryForm.annual_salary) - annualRupees))} ₹ / year
              </p>
            )}
            <div className="space-y-1.5">
              <Label>New annual salary (₹)</Label>
              <Input
                type="number"
                min={0}
                value={salaryForm.annual_salary}
                onChange={(e) => setSalaryForm((s) => ({ ...s, annual_salary: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Effective date</Label>
              <Input
                type="date"
                value={salaryForm.salary_effective_date}
                onChange={(e) => setSalaryForm((s) => ({ ...s, salary_effective_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason (required)</Label>
              <Textarea
                rows={2}
                value={salaryForm.salary_change_reason}
                onChange={(e) => setSalaryForm((s) => ({ ...s, salary_change_reason: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setSalaryOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={patchMut.isPending}
              onClick={() => {
                const ar = Number(salaryForm.annual_salary);
                if (!Number.isFinite(ar) || ar < 0) {
                  toast.error('Enter a valid salary');
                  return;
                }
                if (!salaryForm.salary_effective_date || !salaryForm.salary_change_reason.trim()) {
                  toast.error('Effective date and reason are required');
                  return;
                }
                patchMut.mutate({
                  annual_salary: ar,
                  salary_effective_date: salaryForm.salary_effective_date,
                  salary_change_reason: salaryForm.salary_change_reason.trim(),
                });
              }}
            >
              Save revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resignOpen} onOpenChange={setResignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark employee as resigned</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Resigned on</Label>
              <Input
                type="date"
                value={resignForm.resigned_at}
                onChange={(e) => setResignForm((r) => ({ ...r, resigned_at: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                rows={2}
                value={resignForm.resignation_reason}
                onChange={(e) => setResignForm((r) => ({ ...r, resignation_reason: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setResignOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              type="button"
              disabled={resignMut.isPending}
              onClick={() => resignMut.mutate(resignForm)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
