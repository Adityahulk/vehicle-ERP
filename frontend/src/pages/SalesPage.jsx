import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Plus, Loader2, Search, FileText, Download, X, ChevronLeft, ChevronRight,
  Check, ArrowRight, ArrowLeft, Trash2, Ban,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';

const INV_STATUS_BADGE = {
  draft: 'warning', confirmed: 'success', cancelled: 'destructive',
};

// ─── Hooks ───────────────────────────────────────────────────

function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.branches),
  });
}

function useInvoices(filters) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: () => api.get('/invoices', { params: filters }).then((r) => r.data),
    keepPreviousData: true,
  });
}

function useInStockVehicles() {
  return useQuery({
    queryKey: ['vehicles', 'in_stock_all'],
    queryFn: () => api.get('/vehicles', { params: { status: 'in_stock', limit: 500 } }).then((r) => r.data.vehicles),
  });
}

function useCustomerSearch(search) {
  return useQuery({
    queryKey: ['customers', search],
    queryFn: () => api.get('/customers', { params: { search, limit: 20 } }).then((r) => r.data.customers),
    enabled: search.length >= 2,
  });
}

// ─── New Sale Multi-Step Dialog ──────────────────────────────

const EMPTY_CUSTOMER = { name: '', phone: '', email: '', address: '', gstin: '' };
const EMPTY_LINE = { description: '', hsn_code: '8708', quantity: 1, unit_price_display: '', gst_rate: 28 };

function NewSaleDialog({ open, onOpenChange }) {
  const [step, setStep] = useState(1);
  const [customerMode, setCustomerMode] = useState('search'); // search | new
  const [customerSearch, setCustSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newCustomer, setNewCustomer] = useState(EMPTY_CUSTOMER);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [lineItems, setLineItems] = useState([]);
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const { data: searchResults } = useCustomerSearch(customerSearch);
  const { data: vehicles } = useInStockVehicles();

  useEffect(() => {
    if (open) {
      setStep(1); setCustomerMode('search'); setCustSearch('');
      setSelectedCustomer(null); setNewCustomer(EMPTY_CUSTOMER);
      setSelectedVehicle(null); setVehicleSearch('');
      setLineItems([]); setDiscount(''); setNotes(''); setError('');
    }
  }, [open]);

  // Auto-add vehicle as first line item when selected
  useEffect(() => {
    if (selectedVehicle && lineItems.length === 0) {
      setLineItems([{
        description: `${selectedVehicle.make || ''} ${selectedVehicle.model || ''} ${selectedVehicle.variant || ''}`.trim() || 'Vehicle',
        hsn_code: '8703',
        quantity: 1,
        unit_price_display: (selectedVehicle.selling_price / 100).toString(),
        gst_rate: 28,
      }]);
    }
  }, [selectedVehicle]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredVehicles = vehicles?.filter((v) => {
    if (!vehicleSearch) return true;
    const s = vehicleSearch.toLowerCase();
    return v.chassis_number?.toLowerCase().includes(s)
      || v.make?.toLowerCase().includes(s)
      || v.model?.toLowerCase().includes(s);
  }) || [];

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/invoices', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      onOpenChange(false);
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to create invoice'),
  });

  const handleSubmit = (status) => {
    setError('');
    const items = lineItems.filter((l) => l.description && l.unit_price_display).map((l) => ({
      description: l.description,
      hsn_code: l.hsn_code || '8703',
      quantity: l.quantity || 1,
      unit_price: Math.round(Number(l.unit_price_display) * 100),
      gst_rate: Number(l.gst_rate) || 28,
    }));

    if (items.length === 0) {
      setError('Add at least one line item');
      return;
    }

    const payload = {
      items,
      discount: discount ? Math.round(Number(discount) * 100) : 0,
      status,
      notes: notes || undefined,
      vehicle_id: selectedVehicle?.id,
    };

    if (selectedCustomer) {
      payload.customer_id = selectedCustomer.id;
    } else {
      payload.customer = { ...newCustomer };
    }

    createMutation.mutate(payload);
  };

  // Calculate totals for preview
  const subtotal = lineItems.reduce((s, l) => {
    const price = Number(l.unit_price_display) || 0;
    return s + price * (l.quantity || 1);
  }, 0);
  const discountAmt = Number(discount) || 0;
  const gstTotal = lineItems.reduce((s, l) => {
    const price = Number(l.unit_price_display) || 0;
    const gstRate = Number(l.gst_rate) || 0;
    return s + (price * (l.quantity || 1) * gstRate) / 100;
  }, 0);
  const grandTotal = subtotal - discountAmt + gstTotal;

  const setField = (idx, field, value) => {
    setLineItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const addLine = () => setLineItems((p) => [...p, { ...EMPTY_LINE }]);
  const removeLine = (idx) => setLineItems((p) => p.filter((_, i) => i !== idx));

  const canProceed = () => {
    if (step === 1) return selectedCustomer || newCustomer.name;
    if (step === 2) return true; // vehicle is optional
    if (step === 3) return lineItems.some((l) => l.description && l.unit_price_display);
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Sale — Step {step} of 4</DialogTitle>
          <DialogDescription>
            {step === 1 && 'Select or create a customer'}
            {step === 2 && 'Select a vehicle (optional)'}
            {step === 3 && 'Add line items (vehicle, accessories, insurance, RTO)'}
            {step === 4 && 'Review GST breakup and confirm'}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>}

        {/* Step 1: Customer */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={customerMode === 'search' ? 'default' : 'outline'} size="sm" onClick={() => setCustomerMode('search')}>
                Search Existing
              </Button>
              <Button variant={customerMode === 'new' ? 'default' : 'outline'} size="sm" onClick={() => setCustomerMode('new')}>
                New Customer
              </Button>
            </div>

            {customerMode === 'search' ? (
              <div className="space-y-2">
                <Input placeholder="Search by name or phone..." value={customerSearch}
                  onChange={(e) => { setCustSearch(e.target.value); setSelectedCustomer(null); }} />
                {searchResults && searchResults.length > 0 && (
                  <div className="border rounded-md max-h-48 overflow-y-auto">
                    {searchResults.map((c) => (
                      <button key={c.id} type="button"
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between ${selectedCustomer?.id === c.id ? 'bg-primary/10' : ''}`}
                        onClick={() => setSelectedCustomer(c)}>
                        <span>{c.name}</span>
                        <span className="text-muted-foreground">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedCustomer && (
                  <Card>
                    <CardContent className="pt-4 text-sm space-y-1">
                      <p><strong>{selectedCustomer.name}</strong></p>
                      <p>{selectedCustomer.phone} {selectedCustomer.email && `| ${selectedCustomer.email}`}</p>
                      {selectedCustomer.gstin && <p>GSTIN: {selectedCustomer.gstin}</p>}
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Name *</Label><Input value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Phone</Label><Input value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Email</Label><Input value={newCustomer.email} onChange={(e) => setNewCustomer((c) => ({ ...c, email: e.target.value }))} /></div>
                <div className="space-y-1"><Label>GSTIN</Label><Input value={newCustomer.gstin} onChange={(e) => setNewCustomer((c) => ({ ...c, gstin: e.target.value }))} placeholder="22AAAAA0000A1Z5" /></div>
                <div className="space-y-1 col-span-2"><Label>Address</Label><Textarea value={newCustomer.address} onChange={(e) => setNewCustomer((c) => ({ ...c, address: e.target.value }))} rows={2} /></div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Vehicle */}
        {step === 2 && (
          <div className="space-y-3">
            <Input placeholder="Search chassis, make, model..." value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} />
            <div className="border rounded-md max-h-60 overflow-y-auto">
              <button type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-accent border-b ${!selectedVehicle ? 'bg-primary/10' : ''}`}
                onClick={() => setSelectedVehicle(null)}>
                <span className="text-muted-foreground">No vehicle (service / accessories only)</span>
              </button>
              {filteredVehicles.map((v) => (
                <button key={v.id} type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent border-b flex justify-between ${selectedVehicle?.id === v.id ? 'bg-primary/10' : ''}`}
                  onClick={() => setSelectedVehicle(v)}>
                  <span className="font-medium">{v.make} {v.model} {v.variant}</span>
                  <span className="text-muted-foreground text-xs font-mono">{v.chassis_number} — {formatCurrency(v.selling_price)}</span>
                </button>
              ))}
              {filteredVehicles.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground text-center">No in-stock vehicles</p>}
            </div>
          </div>
        )}

        {/* Step 3: Line Items */}
        {step === 3 && (
          <div className="space-y-3">
            {lineItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4 space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input value={item.description} onChange={(e) => setField(idx, 'description', e.target.value)} placeholder="Vehicle / Insurance / RTO" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">HSN</Label>
                  <Input value={item.hsn_code} onChange={(e) => setField(idx, 'hsn_code', e.target.value)} placeholder="8703" />
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" min="1" value={item.quantity} onChange={(e) => setField(idx, 'quantity', Number(e.target.value))} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Price (₹)</Label>
                  <Input type="number" step="0.01" min="0" value={item.unit_price_display} onChange={(e) => setField(idx, 'unit_price_display', e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">GST %</Label>
                  <Select value={item.gst_rate} onChange={(e) => setField(idx, 'gst_rate', Number(e.target.value))}>
                    <option value={28}>28%</option>
                    <option value={18}>18%</option>
                    <option value={12}>12%</option>
                    <option value={5}>5%</option>
                    <option value={0}>0%</option>
                  </Select>
                </div>
                <div className="col-span-1">
                  <Button variant="ghost" size="icon" onClick={() => removeLine(idx)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addLine}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
            </Button>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <Label>Discount (₹)</Label>
                <Input type="number" step="0.01" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Customer</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">{selectedCustomer?.name || newCustomer.name}</p>
                <p className="text-muted-foreground">{selectedCustomer?.phone || newCustomer.phone}</p>
              </CardContent>
            </Card>

            {selectedVehicle && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Vehicle</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  <p className="font-medium">{selectedVehicle.make} {selectedVehicle.model} {selectedVehicle.variant}</p>
                  <p className="text-muted-foreground font-mono text-xs">Chassis: {selectedVehicle.chassis_number}</p>
                </CardContent>
              </Card>
            )}

            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.filter((l) => l.description).map((l, i) => {
                    const price = Number(l.unit_price_display) || 0;
                    const qty = l.quantity || 1;
                    const gstAmt = (price * qty * (Number(l.gst_rate) || 0)) / 100;
                    return (
                      <TableRow key={i}>
                        <TableCell>{l.description} {qty > 1 && `×${qty}`}</TableCell>
                        <TableCell>{l.hsn_code}</TableCell>
                        <TableCell className="text-right">₹{(price * qty).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">{l.gst_rate}% = ₹{gstAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-medium">₹{(price * qty + gstAmt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                {discountAmt > 0 && <div className="flex justify-between text-destructive"><span>Discount</span><span>- ₹{discountAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>}
                <div className="flex justify-between"><span>GST</span><span>₹{gstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between font-bold text-base border-t pt-1"><span>Total</span><span>₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step < 4 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleSubmit('draft')} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Save Draft
              </Button>
              <Button onClick={() => handleSubmit('confirmed')} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                <Check className="h-4 w-4 mr-1" /> Confirm Sale
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Sales Page ─────────────────────────────────────────

export default function SalesPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [saleOpen, setSaleOpen] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 25, status: '', customer_search: '' });
  const [searchInput, setSearchInput] = useState('');
  const { data: branches } = useBranches();

  const { data, isLoading } = useInvoices(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
  );

  const invoices = data?.invoices || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / filters.limit) || 1;

  const debouncedSearch = useCallback(() => {
    setFilters((f) => ({ ...f, page: 1, customer_search: searchInput }));
  }, [searchInput]);

  useEffect(() => {
    const t = setTimeout(debouncedSearch, 400);
    return () => clearTimeout(t);
  }, [debouncedSearch]);

  const cancelMutation = useMutation({
    mutationFn: (id) => api.patch(`/invoices/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (id) => api.patch(`/invoices/${id}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const downloadPdf = async (invoiceId, invoiceNumber) => {
    try {
      const response = await api.get(`/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${invoiceNumber}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('PDF download failed. Ensure Chrome/Chromium is installed on the server.');
    }
  };

  const canManage = ['super_admin', 'company_admin', 'branch_manager'].includes(user?.role);

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-semibold">Sales & Invoices</h2>
        <Button onClick={() => setSaleOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Sale
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customer name or phone..." className="pl-8"
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <Select className="w-40" value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, page: 1, status: e.target.value }))}>
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No invoices found</TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                  <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                  <TableCell>
                    <div>{inv.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{inv.customer_phone}</div>
                  </TableCell>
                  <TableCell>
                    {inv.vehicle_make
                      ? `${inv.vehicle_make} ${inv.vehicle_model}`
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={INV_STATUS_BADGE[inv.status]}>{inv.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(inv.total)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {inv.status === 'confirmed' && (
                        <Button variant="ghost" size="sm" onClick={() => downloadPdf(inv.id, inv.invoice_number)} title="Download PDF">
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {inv.status === 'draft' && (
                        <Button variant="ghost" size="sm" title="Confirm"
                          onClick={() => confirmMutation.mutate(inv.id)}
                          disabled={confirmMutation.isPending}>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                      )}
                      {inv.status !== 'cancelled' && canManage && (
                        <Button variant="ghost" size="sm" title="Cancel Invoice"
                          onClick={() => { if (window.confirm('Cancel this invoice?')) cancelMutation.mutate(inv.id); }}
                          disabled={cancelMutation.isPending}>
                          <Ban className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">{total} invoice{total !== 1 ? 's' : ''}</span>
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

      <NewSaleDialog open={saleOpen} onOpenChange={setSaleOpen} />
    </AppLayout>
  );
}
