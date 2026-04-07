import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import EmptyState from '@/components/EmptyState';
import SortableTableHead, { sortData } from '@/components/SortableTableHead';
import { Plus, ArrowRightLeft, Loader2, Search, ChevronLeft, ChevronRight, Car } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/lib/utils';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';

const STATUSES = ['in_stock', 'sold', 'transferred', 'scrapped'];

const STATUS_BADGE = {
  in_stock: 'success',
  sold: 'default',
  transferred: 'warning',
  scrapped: 'destructive',
};

const STATUS_LABEL = {
  in_stock: 'In Stock',
  sold: 'Sold',
  transferred: 'Transferred',
  scrapped: 'Scrapped',
};

// ─── Hooks ───────────────────────────────────────────────────

function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.branches),
  });
}

function useVehicles(filters) {
  return useQuery({
    queryKey: ['vehicles', filters],
    queryFn: () => api.get('/vehicles', { params: filters }).then((r) => r.data),
    keepPreviousData: true,
  });
}

// ─── Add Vehicle Form ────────────────────────────────────────

const emptyForm = {
  chassis_number: '', engine_number: '', make: '', model: '', variant: '',
  color: '', year: '', purchase_price: '', selling_price: '', branch_id: '',
  rto_number: '', insurance_company: '', insurance_number: '',
};

function AddVehicleSheet({ open, onOpenChange, branches }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (open) {
      setForm({ ...emptyForm, branch_id: user?.branch_id || '' });
      setError('');
    }
  }, [open, user?.branch_id]);

  const mutation = useMutation({
    mutationFn: (data) => api.post('/vehicles', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      onOpenChange(false);
      toast.success('Vehicle added successfully');
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to add vehicle'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const payload = {
      ...form,
      year: form.year ? Number(form.year) : undefined,
      purchase_price: form.purchase_price ? Math.round(Number(form.purchase_price) * 100) : 0,
      selling_price: form.selling_price ? Math.round(Number(form.selling_price) * 100) : 0,
    };
    if (!payload.branch_id) delete payload.branch_id;
    mutation.mutate(payload);
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add Vehicle</SheetTitle>
          <SheetDescription>Enter vehicle details below</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Chassis No. *</Label>
              <Input value={form.chassis_number} onChange={set('chassis_number')} required />
            </div>
            <div className="space-y-1">
              <Label>Engine No. *</Label>
              <Input value={form.engine_number} onChange={set('engine_number')} required />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Make</Label>
              <Input value={form.make} onChange={set('make')} placeholder="Honda" />
            </div>
            <div className="space-y-1">
              <Label>Model</Label>
              <Input value={form.model} onChange={set('model')} placeholder="City" />
            </div>
            <div className="space-y-1">
              <Label>Variant</Label>
              <Input value={form.variant} onChange={set('variant')} placeholder="VX" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Color</Label>
              <Input value={form.color} onChange={set('color')} />
            </div>
            <div className="space-y-1">
              <Label>Year</Label>
              <Input type="number" value={form.year} onChange={set('year')} placeholder="2025" />
            </div>
            <div className="space-y-1">
              <Label>Branch</Label>
              <Select value={form.branch_id} onChange={set('branch_id')}>
                <option value="">Select</option>
                {branches?.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Purchase Price (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.purchase_price} onChange={set('purchase_price')} />
            </div>
            <div className="space-y-1">
              <Label>Selling Price (₹)</Label>
              <Input type="number" step="0.01" min="0" value={form.selling_price} onChange={set('selling_price')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>RTO Number</Label>
              <Input value={form.rto_number} onChange={set('rto_number')} placeholder="KA01AB1234" />
            </div>
            <div className="space-y-1">
              <Label>Insurance Company</Label>
              <Input value={form.insurance_company} onChange={set('insurance_company')} />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Vehicle
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Transfer Modal ──────────────────────────────────────────

function TransferDialog({ open, onOpenChange, vehicle, branches }) {
  const [toBranch, setToBranch] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) { setToBranch(''); setNotes(''); setError(''); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (data) => api.post(`/vehicles/${vehicle.id}/transfer`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      onOpenChange(false);
      toast.success('Vehicle transferred successfully');
    },
    onError: (err) => setError(err.response?.data?.error || 'Transfer failed'),
  });

  const available = branches?.filter((b) => b.id !== vehicle?.branch_id) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer Vehicle</DialogTitle>
          <DialogDescription>
            {vehicle?.make} {vehicle?.model} — {vehicle?.chassis_number}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>From Branch</Label>
            <Input value={vehicle?.branch_name || '—'} disabled />
          </div>
          <div className="space-y-1">
            <Label>To Branch *</Label>
            <Select value={toBranch} onChange={(e) => setToBranch(e.target.value)} required>
              <option value="">Select branch</option>
              {available.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!toBranch || mutation.isPending}
            onClick={() => mutation.mutate({ to_branch_id: toBranch, notes: notes || undefined })}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Inventory Page ─────────────────────────────────────

export default function InventoryPage() {
  const user = useAuthStore((s) => s.user);
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const [filters, setFilters] = useState({ page: 1, limit: 25, branch_id: '', status: '', search: '' });
  const [searchInput, setSearchInput] = useState('');

  const { data: branches } = useBranches();
  const { data, isLoading } = useVehicles(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
  );

  const rawVehicles = data?.vehicles || [];
  const vehicles = sortKey ? sortData(rawVehicles, sortKey, sortDir) : rawVehicles;
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / filters.limit) || 1;

  const handleSort = (key, dir) => { setSortKey(key); setSortDir(dir); };

  const canManage = ['super_admin', 'company_admin', 'branch_manager'].includes(user?.role);

  const debouncedSearch = useCallback(() => {
    setFilters((f) => ({ ...f, page: 1, search: searchInput }));
  }, [searchInput]);

  useEffect(() => {
    const t = setTimeout(debouncedSearch, 400);
    return () => clearTimeout(t);
  }, [debouncedSearch]);

  const openTransfer = (v) => {
    setSelectedVehicle(v);
    setTransferOpen(true);
  };

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-semibold">Inventory</h2>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Vehicle
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search chassis, make, model..."
            className="pl-8"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          className="w-44"
          value={filters.branch_id}
          onChange={(e) => setFilters((f) => ({ ...f, page: 1, branch_id: e.target.value }))}
        >
          <option value="">All Branches</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, page: 1, status: e.target.value }))}
        >
          <option value="">All Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={8} columns={7} /></div>
        ) : vehicles.length === 0 ? (
          <EmptyState
            icon={Car}
            title="No vehicles found"
            description="Add your first vehicle or adjust filters to see results."
            actionLabel="Add Vehicle"
            onAction={() => setAddOpen(true)}
          />
        ) : (
        <Table>
          <thead className="[&_tr]:border-b">
            <tr>
              <SortableTableHead sortKey="chassis_number" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Chassis No.</SortableTableHead>
              <SortableTableHead sortKey="make" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Vehicle</SortableTableHead>
              <SortableTableHead sortKey="color" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Color</SortableTableHead>
              <SortableTableHead sortKey="year" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Year</SortableTableHead>
              <SortableTableHead sortKey="branch_name" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Branch</SortableTableHead>
              <SortableTableHead sortKey="status" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort}>Status</SortableTableHead>
              <SortableTableHead sortKey="selling_price" currentSort={sortKey} currentDirection={sortDir} onSort={handleSort} className="text-right">Selling Price</SortableTableHead>
              {canManage && <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">Actions</th>}
            </tr>
          </thead>
          <TableBody>
            {
              vehicles.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/vehicles/${v.id}`} className="text-primary hover:underline">
                      {v.chassis_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{v.make} {v.model}</span>
                    {v.variant && <span className="text-muted-foreground text-xs ml-1">{v.variant}</span>}
                  </TableCell>
                  <TableCell>{v.color || '—'}</TableCell>
                  <TableCell>{v.year || '—'}</TableCell>
                  <TableCell>{v.branch_name || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(v.selling_price)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {v.status === 'in_stock' && (
                        <Button variant="ghost" size="sm" onClick={() => openTransfer(v)} title="Transfer">
                          <ArrowRightLeft className="h-3.5 w-3.5" />
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

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">
              {total} vehicle{total !== 1 ? 's' : ''} total
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>
                Page {filters.page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page >= totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <AddVehicleSheet open={addOpen} onOpenChange={setAddOpen} branches={branches} />
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        vehicle={selectedVehicle}
        branches={branches}
      />
    </AppLayout>
  );
}
