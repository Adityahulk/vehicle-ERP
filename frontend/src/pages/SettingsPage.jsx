import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  SelectRoot as Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { Building2, GitBranch, Users, Receipt, Loader2, Upload, Eye, EyeOff, RotateCcw, Plus, Pencil } from 'lucide-react';

const INDIAN_STATES = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' }, { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
];

// ──────────────────────────── Company Profile Tab ────────────────────────────
function CompanyTab() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [form, setForm] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['company', user?.company_id],
    queryFn: () => api.get(`/companies/${user.company_id}`).then((r) => r.data.company),
    enabled: !!user?.company_id,
    onSuccess: (c) => {
      if (!form) setForm({ name: c.name || '', gstin: c.gstin || '', address: c.address || '', phone: c.phone || '', email: c.email || '' });
    },
  });

  // Initialize form from data when loaded
  if (data && !form) {
    setForm({ name: data.name || '', gstin: data.gstin || '', address: data.address || '', phone: data.phone || '', email: data.email || '' });
  }

  const updateMut = useMutation({
    mutationFn: (body) => api.patch(`/companies/${user.company_id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company'] }),
  });

  const logoMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('logo', file);
      return api.post(`/companies/${user.company_id}/logo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company'] }),
  });

  const sigMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('signature', file);
      return api.post(`/companies/${user.company_id}/signature`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company'] }),
  });

  if (isLoading || !form) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company Details</CardTitle>
          <CardDescription>Update your company information shown on invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              updateMut.mutate(form);
            }}
          >
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input value={form.name} onChange={set('name')} required />
            </div>
            <div className="space-y-1.5">
              <Label>GSTIN</Label>
              <Input value={form.gstin} onChange={set('gstin')} maxLength={15} placeholder="e.g. 29ABCDE1234F1Z5" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={set('phone')} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={set('email')} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Address</Label>
              <Textarea value={form.address} onChange={set('address')} rows={2} />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={updateMut.isPending}>
                {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Changes
              </Button>
            </div>
            {updateMut.isSuccess && <p className="md:col-span-2 text-sm text-emerald-600">Saved successfully</p>}
            {updateMut.isError && <p className="md:col-span-2 text-sm text-destructive">{updateMut.error?.response?.data?.error || 'Failed to save'}</p>}
          </form>
        </CardContent>
      </Card>

      {/* Logo + Signature uploads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Company Logo</CardTitle>
            <CardDescription>Appears on invoices and PDFs (max 2 MB)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.logo_url && (
              <img src={data.logo_url} alt="Logo" className="h-20 object-contain rounded border border-border p-2 bg-white" />
            )}
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="image/*"
                className="max-w-xs"
                onChange={(e) => e.target.files?.[0] && logoMut.mutate(e.target.files[0])}
              />
              {logoMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {logoMut.isSuccess && <p className="text-sm text-emerald-600">Logo uploaded</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Digital Signature</CardTitle>
            <CardDescription>Appears at the bottom of invoices (max 1 MB)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.signature_url && (
              <img src={data.signature_url} alt="Signature" className="h-16 object-contain rounded border border-border p-2 bg-white" />
            )}
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="image/*"
                className="max-w-xs"
                onChange={(e) => e.target.files?.[0] && sigMut.mutate(e.target.files[0])}
              />
              {sigMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {sigMut.isSuccess && <p className="text-sm text-emerald-600">Signature uploaded</p>}
          </CardContent>
        </Card>
      </div>

      {/* Invoice preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice Preview</CardTitle>
          <CardDescription>How your company details appear on invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-lg p-6 bg-white max-w-lg">
            <div className="flex items-start gap-4">
              {data?.logo_url ? (
                <img src={data.logo_url} alt="Logo" className="h-14 w-14 object-contain" />
              ) : (
                <div className="h-14 w-14 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">Logo</div>
              )}
              <div>
                <p className="font-bold text-lg">{data?.name || 'Company Name'}</p>
                <p className="text-sm text-muted-foreground">{data?.address || 'Address'}</p>
                <p className="text-sm text-muted-foreground">GSTIN: {data?.gstin || '—'}</p>
                <p className="text-sm text-muted-foreground">{data?.phone || ''} {data?.email ? `· ${data.email}` : ''}</p>
              </div>
            </div>
            {data?.signature_url && (
              <div className="mt-6 pt-4 border-t border-dashed border-border flex justify-end">
                <div className="text-center">
                  <img src={data.signature_url} alt="Signature" className="h-10 object-contain mb-1" />
                  <p className="text-xs text-muted-foreground">Authorized Signatory</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────── Branches Tab ────────────────────────────
function BranchesTab() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(null); // null | { mode: 'add' | 'edit', branch? }
  const [form, setForm] = useState({ name: '', address: '', phone: '', manager_id: '' });

  const { data: branchData, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.branches),
  });

  const { data: usersList } = useQuery({
    queryKey: ['users-list-for-manager'],
    queryFn: () => api.get('/users?limit=200').then((r) => r.data.users),
  });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/branches', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['branches'] }); setDialog(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/branches/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['branches'] }); setDialog(null); },
  });

  const openAdd = () => {
    setForm({ name: '', address: '', phone: '', manager_id: '' });
    setDialog({ mode: 'add' });
  };

  const openEdit = (b) => {
    setForm({ name: b.name || '', address: b.address || '', phone: b.phone || '', manager_id: b.manager_id || '' });
    setDialog({ mode: 'edit', branch: b });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const body = { ...form, manager_id: form.manager_id || null };
    if (dialog.mode === 'edit') {
      updateMut.mutate({ id: dialog.branch.id, ...body });
    } else {
      createMut.mutate(body);
    }
  };

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const mut = dialog?.mode === 'edit' ? updateMut : createMut;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Branches</h3>
        <Button size="sm" onClick={openAdd} className="gap-1.5"><Plus className="h-4 w-4" /> Add Branch</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Address</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Phone</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Manager</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(branchData || []).map((b) => (
                    <tr key={b.id} className="border-b border-border/50">
                      <td className="py-2 font-medium">{b.name}</td>
                      <td className="py-2 text-muted-foreground max-w-[200px] truncate">{b.address || '—'}</td>
                      <td className="py-2">{b.phone || '—'}</td>
                      <td className="py-2">{b.manager_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(b)} className="gap-1">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(branchData || []).length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No branches yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add / Edit Branch Dialog */}
      <Dialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'edit' ? 'Edit Branch' : 'Add Branch'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Branch Name *</Label>
              <Input value={form.name} onChange={set('name')} required />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Textarea value={form.address} onChange={set('address')} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={set('phone')} />
            </div>
            <div className="space-y-1.5">
              <Label>Assign Manager</Label>
              <Select value={form.manager_id} onValueChange={(v) => setForm((p) => ({ ...p, manager_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(usersList || [])
                    .filter((u) => ['company_admin', 'branch_manager'].includes(u.role) && u.is_active)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {mut.isError && <p className="text-sm text-destructive">{mut.error?.response?.data?.error || 'Failed'}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {dialog?.mode === 'edit' ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ──────────────────────────── Users Tab ────────────────────────────
function UsersTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', phone: '', role: 'staff', branch_id: '' });
  const [resetResult, setResetResult] = useState(null);

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users-settings'],
    queryFn: () => api.get('/users?limit=200').then((r) => r.data.users),
  });

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.branches),
  });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/users', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-settings'] });
      setShowAdd(false);
      setAddForm({ name: '', email: '', password: '', phone: '', role: 'staff', branch_id: '' });
    },
  });

  const toggleMut = useMutation({
    mutationFn: (id) => api.patch(`/users/${id}/toggle-active`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users-settings'] }),
  });

  const resetMut = useMutation({
    mutationFn: (id) => api.post(`/users/${id}/reset-password`),
    onSuccess: (res) => setResetResult(res.data),
  });

  const setAdd = (k) => (e) => setAddForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Users</h3>
        <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Add User</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Email</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Role</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Branch</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(usersData || []).map((u) => (
                    <tr key={u.id} className="border-b border-border/50">
                      <td className="py-2 font-medium">{u.name}</td>
                      <td className="py-2">{u.email}</td>
                      <td className="py-2"><Badge variant="outline">{u.role}</Badge></td>
                      <td className="py-2">{u.branch_name || '—'}</td>
                      <td className="py-2 text-center">
                        <Badge variant={u.is_active ? 'success' : 'destructive'}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleMut.mutate(u.id)}
                            disabled={toggleMut.isPending}
                            title={u.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {u.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resetMut.mutate(u.id)}
                            disabled={resetMut.isPending}
                            title="Reset Password"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(usersData || []).length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Password reset result dialog */}
      <Dialog open={!!resetResult} onOpenChange={(v) => !v && setResetResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Reset</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">New temporary password for <strong>{resetResult?.user_name}</strong>:</p>
            <div className="bg-muted rounded-lg p-3 font-mono text-lg text-center tracking-wider select-all">
              {resetResult?.temp_password}
            </div>
            <p className="text-xs text-muted-foreground">Share this password with the user. They should change it after logging in.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => {
              navigator.clipboard.writeText(resetResult?.temp_password || '');
              setResetResult(null);
            }}>
              Copy & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const body = { ...addForm, branch_id: addForm.branch_id || undefined };
              createMut.mutate(body);
            }}
          >
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input value={addForm.name} onChange={setAdd('name')} required />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={addForm.email} onChange={setAdd('email')} required />
            </div>
            <div className="space-y-1.5">
              <Label>Temporary Password *</Label>
              <Input value={addForm.password} onChange={setAdd('password')} required minLength={6} placeholder="Min 6 characters" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={addForm.phone} onChange={setAdd('phone')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={addForm.role} onValueChange={(v) => setAddForm((p) => ({ ...p, role: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="branch_manager">Branch Manager</SelectItem>
                    <SelectItem value="company_admin">Company Admin</SelectItem>
                    <SelectItem value="ca">CA (Chartered Accountant)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <Select value={addForm.branch_id} onValueChange={(v) => setAddForm((p) => ({ ...p, branch_id: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {(branches || []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {createMut.isError && <p className="text-sm text-destructive">{createMut.error?.response?.data?.error || 'Failed to create user'}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ──────────────────────────── GST Settings Tab ────────────────────────────
function GSTTab() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [form, setForm] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['company', user?.company_id],
    queryFn: () => api.get(`/companies/${user.company_id}`).then((r) => r.data.company),
    enabled: !!user?.company_id,
  });

  if (data && !form) {
    setForm({
      state_code: data.state_code || '',
      default_hsn_code: data.default_hsn_code || '8703',
      default_gst_rate: data.default_gst_rate != null ? String(data.default_gst_rate) : '28',
    });
  }

  const updateMut = useMutation({
    mutationFn: (body) => api.patch(`/companies/${user.company_id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company'] }),
  });

  if (isLoading || !form) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const stateName = INDIAN_STATES.find((s) => s.code === form.state_code)?.name || '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">GST Configuration</CardTitle>
        <CardDescription>Defaults used when creating invoices</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            updateMut.mutate({
              state_code: form.state_code,
              default_hsn_code: form.default_hsn_code,
              default_gst_rate: parseFloat(form.default_gst_rate),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label>Company State (for CGST/SGST vs IGST determination)</Label>
            <Select value={form.state_code} onValueChange={(v) => setForm((p) => ({ ...p, state_code: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stateName && <p className="text-xs text-muted-foreground">Selected: {stateName}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Default HSN Code for Vehicles</Label>
            <Input
              value={form.default_hsn_code}
              onChange={(e) => setForm((p) => ({ ...p, default_hsn_code: e.target.value }))}
              placeholder="e.g. 8703"
            />
            <p className="text-xs text-muted-foreground">HSN 8703 = Motor cars and vehicles for transport of persons</p>
          </div>

          <div className="space-y-1.5">
            <Label>Default GST Rate (%)</Label>
            <Select value={form.default_gst_rate} onValueChange={(v) => setForm((p) => ({ ...p, default_gst_rate: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="12">12%</SelectItem>
                <SelectItem value="18">18%</SelectItem>
                <SelectItem value="28">28%</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="p-3 rounded-lg bg-muted text-sm">
            <p className="font-medium mb-1">Preview for intra-state sale:</p>
            <p className="text-muted-foreground">
              CGST @ {(parseFloat(form.default_gst_rate) / 2).toFixed(1)}% + SGST @ {(parseFloat(form.default_gst_rate) / 2).toFixed(1)}% = {form.default_gst_rate}%
            </p>
            <p className="font-medium mt-2 mb-1">Preview for inter-state sale:</p>
            <p className="text-muted-foreground">IGST @ {form.default_gst_rate}%</p>
          </div>

          <Button type="submit" disabled={updateMut.isPending}>
            {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save GST Settings
          </Button>
          {updateMut.isSuccess && <p className="text-sm text-emerald-600">Saved successfully</p>}
          {updateMut.isError && <p className="text-sm text-destructive">{updateMut.error?.response?.data?.error || 'Failed to save'}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────── Main Settings Page ────────────────────────────
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('company');

  return (
    <AppLayout>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage company, branches, users, and GST configuration</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="company" className="gap-1.5">
            <Building2 className="h-4 w-4" /> Company
          </TabsTrigger>
          <TabsTrigger value="branches" className="gap-1.5">
            <GitBranch className="h-4 w-4" /> Branches
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="h-4 w-4" /> Users
          </TabsTrigger>
          <TabsTrigger value="gst" className="gap-1.5">
            <Receipt className="h-4 w-4" /> GST Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company"><CompanyTab /></TabsContent>
        <TabsContent value="branches"><BranchesTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="gst"><GSTTab /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}
