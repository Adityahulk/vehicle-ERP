import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
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
  Check, ArrowRight, ArrowLeft, Trash2, Ban, ShieldCheck, ShieldX, Upload, Eye, Pencil,
  Landmark,
} from 'lucide-react';
import BulkImport from '@/components/BulkImport';
import InvoicePreviewModal from '@/components/InvoicePreviewModal';
import WhatsAppSendDialog, { WhatsAppIconButton } from '@/components/WhatsAppSendDialog';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '@/lib/utils';
import api from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ReadOnlyBadge from '@/components/ReadOnlyBadge';

const INV_STATUS_BADGE = {
  draft: 'warning', confirmed: 'success', cancelled: 'destructive',
};

// ─── Hooks ───────────────────────────────────────────────────

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
const EMPTY_LINE = {
  description: '',
  hsn_code: '8703',
  quantity: 1,
  unit_price_display: '',
  gst_rate: 5,
  price_includes_tax: true,
};
const PAYMENT_TYPES = ['Cash', 'UPI', 'NEFT', 'RTGS', 'Cheque', 'Credit', 'Card', 'Other'];

function emptyLoanForm() {
  return {
    bank_name: '',
    loan_amount_rupees: '',
    interest_rate: '9.5',
    tenure_months: '60',
    disbursement_date: new Date().toISOString().split('T')[0],
    grace_period_days: '0',
    penalty_per_day_rupees: '0',
    penalty_cap_rupees: '0',
  };
}

function emiPreviewFromRupees(principalRupees, annualRate, tenureMonths) {
  const p = Math.round(Number(principalRupees) * 100);
  if (!Number.isFinite(p) || p <= 0 || tenureMonths <= 0 || annualRate <= 0) return 0;
  const r = annualRate / 12 / 100;
  const n = tenureMonths;
  return Math.round(p * r * (1 + r) ** n / ((1 + r) ** n - 1));
}

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
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [addLoan, setAddLoan] = useState(false);
  const [loanForm, setLoanForm] = useState(emptyLoanForm);
  const queryClient = useQueryClient();

  const { data: searchResults } = useCustomerSearch(customerSearch);
  const { data: vehicles } = useInStockVehicles();

  useEffect(() => {
    if (open) {
      setStep(1); setCustomerMode('search'); setCustSearch('');
      setSelectedCustomer(null); setNewCustomer(EMPTY_CUSTOMER);
      setSelectedVehicle(null); setVehicleSearch('');
      setLineItems([]); setDiscount(''); setNotes(''); setError('');
      setInvoiceDate(new Date().toISOString().split('T')[0]); setPaymentType('Cash');
      setAddLoan(false); setLoanForm(emptyLoanForm());
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
        gst_rate: 5,
        price_includes_tax: true,
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
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      if (res.data?.loan) {
        toast.success('Sale confirmed — bank loan recorded. View it under Loans.');
      } else if (res.data?.invoice?.status === 'confirmed') {
        toast.success('Sale confirmed');
      } else {
        toast.success('Draft saved');
      }
      onOpenChange(false);
    },
    onError: (err) => {
      const d = err.response?.data;
      const details = d?.details;
      if (Array.isArray(details) && details.length) {
        setError(details.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; '));
      } else {
        setError(d?.error || 'Failed to create invoice');
      }
    },
  });

  const handleSubmit = (status) => {
    setError('');
    const items = lineItems.filter((l) => l.description && l.unit_price_display).map((l) => {
      const gstRate = Number(l.gst_rate) || 0;
      const enteredRupees = Number(l.unit_price_display) || 0;
      const enteredPaise = Math.round(enteredRupees * 100);
      const unitPriceExclusivePaise = l.price_includes_tax
        ? Math.round(enteredPaise / (1 + (gstRate / 100)))
        : enteredPaise;
      return {
        description: l.description,
        hsn_code: l.hsn_code || '8703',
        quantity: l.quantity || 1,
        unit_price: unitPriceExclusivePaise,
        gst_rate: gstRate,
      };
    });

    if (items.length === 0) {
      setError('Add at least one line item');
      return;
    }

    let loanPayload;
    if (status === 'confirmed' && addLoan) {
      if (!loanForm.bank_name.trim()) {
        setError('Enter bank name for the loan');
        return;
      }
      const principal = Math.round(Number(loanForm.loan_amount_rupees) * 100);
      if (!Number.isFinite(principal) || principal < 1) {
        setError('Enter a valid loan amount (₹)');
        return;
      }
      const pp = loanForm.penalty_per_day_rupees === '' ? 0 : Math.round(Number(loanForm.penalty_per_day_rupees) * 100);
      if (pp > 0 && pp < 100) {
        setError('Daily penalty must be 0 or at least ₹1/day');
        return;
      }
      const tenure = Number(loanForm.tenure_months);
      const rate = Number(loanForm.interest_rate);
      if (!Number.isFinite(tenure) || tenure < 1 || tenure > 360) {
        setError('Tenure must be between 1 and 360 months');
        return;
      }
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        setError('Interest rate must be between 0 and 100');
        return;
      }
      if (!loanForm.disbursement_date) {
        setError('Choose loan disbursement date');
        return;
      }
      loanPayload = {
        bank_name: loanForm.bank_name.trim(),
        loan_amount: principal,
        interest_rate: rate,
        tenure_months: tenure,
        disbursement_date: loanForm.disbursement_date,
        penalty_per_day: pp,
        grace_period_days: Number(loanForm.grace_period_days) || 0,
        penalty_cap: Math.round((Number(loanForm.penalty_cap_rupees) || 0) * 100),
      };
    }

    const payload = {
      items,
      discount: discount ? Math.round(Number(discount) * 100) : 0,
      invoice_date: invoiceDate || undefined,
      payment_type: paymentType || 'Cash',
      status,
      notes: notes || undefined,
      vehicle_id: selectedVehicle?.id,
    };

    if (loanPayload) payload.loan = loanPayload;

    if (selectedCustomer) {
      payload.customer_id = selectedCustomer.id;
    } else {
      payload.customer = { ...newCustomer };
    }

    createMutation.mutate(payload);
  };

  // Calculate totals for preview
  const subtotal = lineItems.reduce((s, l) => {
    const entered = Number(l.unit_price_display) || 0;
    const qty = l.quantity || 1;
    const gstRate = Number(l.gst_rate) || 0;
    const baseUnit = l.price_includes_tax ? (entered / (1 + (gstRate / 100))) : entered;
    return s + (baseUnit * qty);
  }, 0);
  const discountAmt = Number(discount) || 0;
  const gstTotal = lineItems.reduce((s, l) => {
    const entered = Number(l.unit_price_display) || 0;
    const qty = l.quantity || 1;
    const gstRate = Number(l.gst_rate) || 0;
    const baseUnit = l.price_includes_tax ? (entered / (1 + (gstRate / 100))) : entered;
    return s + (baseUnit * qty * gstRate) / 100;
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
                <div className="col-span-3 space-y-1">
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
                  <Label className="text-xs">Unit Price (₹)</Label>
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
                <div className="col-span-1 flex items-center justify-center">
                  <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!item.price_includes_tax}
                      onChange={(e) => setField(idx, 'price_includes_tax', e.target.checked)}
                    />
                    Incl GST
                  </label>
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
                <Label>Invoice date</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Payment type</Label>
                <Select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                  {PAYMENT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
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
                {(selectedCustomer?.gstin || newCustomer.gstin) ? (
                  <p className="text-muted-foreground">GSTIN: {selectedCustomer?.gstin || newCustomer.gstin}</p>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Invoice details</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <p><strong>Date:</strong> {invoiceDate || '-'}</p>
                <p><strong>Payment type:</strong> {paymentType}</p>
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
                    const entered = Number(l.unit_price_display) || 0;
                    const qty = l.quantity || 1;
                    const gstRate = Number(l.gst_rate) || 0;
                    const taxableUnit = l.price_includes_tax ? (entered / (1 + (gstRate / 100))) : entered;
                    const taxable = taxableUnit * qty;
                    const gstAmt = (taxable * gstRate) / 100;
                    return (
                      <TableRow key={i}>
                        <TableCell>{l.description} {qty > 1 && `×${qty}`}</TableCell>
                        <TableCell>{l.hsn_code}</TableCell>
                        <TableCell className="text-right">₹{taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">{l.gst_rate}% = ₹{gstAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-medium">₹{(taxable + gstAmt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
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

            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Landmark className="h-4 w-4" /> Bank loan (optional)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addLoan}
                    onChange={(e) => {
                      const c = e.target.checked;
                      setAddLoan(c);
                      if (c) {
                        setLoanForm((f) => ({
                          ...f,
                          loan_amount_rupees: f.loan_amount_rupees || (Math.round(grandTotal * 100) / 100).toFixed(2),
                        }));
                      }
                    }}
                    className="mt-1 rounded border-input"
                  />
                  <span>
                    Record a bank loan with this sale (only when you click <strong>Confirm Sale</strong>). Same data as the{' '}
                    <Link to="/loans" className="text-primary underline font-medium">Loans</Link> page — EMI, due date, and penalties apply automatically.
                  </span>
                </label>
                {addLoan && (
                  <>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Bank name *</Label>
                        <Input
                          value={loanForm.bank_name}
                          onChange={(e) => setLoanForm((f) => ({ ...f, bank_name: e.target.value }))}
                          placeholder="e.g. HDFC Bank"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Loan principal (₹) *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={loanForm.loan_amount_rupees}
                          onChange={(e) => setLoanForm((f) => ({ ...f, loan_amount_rupees: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Interest rate (% p.a.) *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={loanForm.interest_rate}
                          onChange={(e) => setLoanForm((f) => ({ ...f, interest_rate: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Tenure (months) *</Label>
                        <Input
                          type="number"
                          min="1"
                          max="360"
                          value={loanForm.tenure_months}
                          onChange={(e) => setLoanForm((f) => ({ ...f, tenure_months: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Disbursement date *</Label>
                        <Input
                          type="date"
                          value={loanForm.disbursement_date}
                          onChange={(e) => setLoanForm((f) => ({ ...f, disbursement_date: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Grace period (days)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={loanForm.grace_period_days}
                          onChange={(e) => setLoanForm((f) => ({ ...f, grace_period_days: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Penalty per day (₹)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={loanForm.penalty_per_day_rupees}
                          onChange={(e) => setLoanForm((f) => ({ ...f, penalty_per_day_rupees: e.target.value }))}
                        />
                        <p className="text-[11px] text-muted-foreground">0 = none. If set, minimum ₹1/day.</p>
                      </div>
                      <div className="space-y-1">
                        <Label>Max penalty cap (₹)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={loanForm.penalty_cap_rupees}
                          onChange={(e) => setLoanForm((f) => ({ ...f, penalty_cap_rupees: e.target.value }))}
                        />
                        <p className="text-[11px] text-muted-foreground">0 = no cap</p>
                      </div>
                    </div>
                    {(() => {
                      const emi = emiPreviewFromRupees(
                        loanForm.loan_amount_rupees,
                        Number(loanForm.interest_rate),
                        Number(loanForm.tenure_months),
                      );
                      return emi > 0 ? (
                        <p className="text-xs bg-muted/50 rounded-md px-3 py-2">
                          Estimated EMI: <span className="font-semibold">{formatCurrency(emi)}</span>/month
                        </p>
                      ) : null;
                    })()}
                  </>
                )}
              </CardContent>
            </Card>
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
  const queryClient = useQueryClient();
  const [saleOpen, setSaleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [filters, setFilters] = useState({ page: 1, limit: 25, status: '', customer_search: '' });
  const [searchInput, setSearchInput] = useState('');
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [waDialog, setWaDialog] = useState(null);
  const [waMeta, setWaMeta] = useState({});
  const [pdfTemplateChoice, setPdfTemplateChoice] = useState({});


  const markInvoiceWaSent = useCallback((invoiceId) => {
    const now = Date.now();
    setWaMeta((u) => ({ ...u, [invoiceId]: { lastSent: now, flash: true } }));
    setTimeout(() => {
      setWaMeta((u) => {
        const cur = u[invoiceId];
        if (!cur) return u;
        return { ...u, [invoiceId]: { ...cur, flash: false } };
      });
    }, 3000);
  }, []);
  const { data: invoiceTemplates = [] } = useQuery({
    queryKey: ['invoice-templates'],
    queryFn: () => api.get('/invoice-templates').then((r) => r.data.templates),
  });

  /** Prefer full trade layout (MVG-style) for PDFs when that template exists. */
  const preferredPdfTemplateId = useMemo(() => {
    const trade = invoiceTemplates.find((t) => t.template_key === 'trade');
    if (trade?.id) return trade.id;
    const def = invoiceTemplates.find((t) => t.is_default);
    return def?.id || invoiceTemplates[0]?.id || '';
  }, [invoiceTemplates]);

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

  const { data: eInvoiceStatus } = useQuery({
    queryKey: ['einvoice-status'],
    queryFn: () => api.get('/invoices/einvoice/status').then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  });

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

  const generateEInvoiceMutation = useMutation({
    mutationFn: (id) => api.post(`/invoices/${id}/einvoice/generate`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(`E-Invoice generated! IRN: ${res.data?.data?.irn?.substring(0, 20)}...`);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'E-Invoice generation failed'),
  });

  const cancelEInvoiceMutation = useMutation({
    mutationFn: (id) => api.post(`/invoices/${id}/einvoice/cancel`, { reason: '2', remark: 'Data entry mistake' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('E-Invoice IRN cancelled');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'E-Invoice cancellation failed'),
  });

  const downloadPdf = async (invoiceId, invoiceNumber, templateId) => {
    try {
      const tid = templateId || preferredPdfTemplateId || undefined;
      const params = tid ? { templateId: tid } : {};
      const response = await api.get(`/invoices/${invoiceId}/pdf`, { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${invoiceNumber}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('PDF download failed. Ensure Chrome/Chromium is installed on the server.');
    }
  };

  const { canWrite, isCA } = usePermissions();

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h2 className="text-2xl font-semibold">Sales & Invoices</h2>
          {isCA ? <ReadOnlyBadge /> : null}
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Import
            </Button>
            <Button onClick={() => setSaleOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New Sale
            </Button>
          </div>
        )}
      </div>

      {canWrite && (
        <BulkImport
          type="sales"
          open={importOpen}
          onOpenChange={setImportOpen}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['vehicles'] });
          }}
        />
      )}

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
              <TableHead>Payment</TableHead>
              <TableHead>e-Invoice</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No invoices found</TableCell>
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
                  <TableCell>
                    <Badge variant="outline">{inv.payment_type || 'Cash'}</Badge>
                  </TableCell>
                  <TableCell>
                    {inv.irn_status === 'generated' && (
                      <Badge variant="success" className="gap-1">
                        <ShieldCheck className="h-3 w-3" /> IRN
                      </Badge>
                    )}
                    {inv.irn_status === 'cancelled' && (
                      <Badge variant="destructive" className="gap-1 text-[10px]">
                        <ShieldX className="h-3 w-3" /> Cancelled
                      </Badge>
                    )}
                    {inv.irn_status === 'failed' && (
                      <Badge variant="destructive" className="text-[10px]">Failed</Badge>
                    )}
                    {(!inv.irn_status || inv.irn_status === 'pending') && inv.status === 'confirmed' && (
                      <span className="text-xs text-muted-foreground">Pending</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(inv.total)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1 max-w-[220px] ml-auto">
                      {inv.status !== 'cancelled' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Preview HTML"
                          onClick={() => setPreviewInvoice({ id: inv.id, invoice_number: inv.invoice_number })}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canWrite && inv.status !== 'cancelled' && (
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          title="Edit invoice"
                        >
                          <Link to={`/sales/${inv.id}/edit`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                      {inv.status === 'confirmed' && (
                        <>
                          <Select
                            className="h-8 w-[9.5rem] text-xs shrink-0"
                            value={pdfTemplateChoice[inv.id] ?? preferredPdfTemplateId ?? ''}
                            onChange={(e) => setPdfTemplateChoice((p) => ({ ...p, [inv.id]: e.target.value }))}
                            title="Template for PDF download"
                          >
                            {invoiceTemplates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                                {t.id === preferredPdfTemplateId ? ' (PDF default)' : ''}
                              </option>
                            ))}
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => downloadPdf(
                              inv.id,
                              inv.invoice_number,
                              (pdfTemplateChoice[inv.id] ?? preferredPdfTemplateId) || undefined,
                            )}
                            title="Download PDF"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {canWrite && (
                            <WhatsAppIconButton
                              title="Send invoice on WhatsApp"
                              lastSentAt={waMeta[inv.id]?.lastSent}
                              flashCheck={waMeta[inv.id]?.flash}
                              onClick={() => setWaDialog({
                                id: inv.id,
                                name: inv.customer_name,
                              })}
                            />
                          )}
                        </>
                      )}
                      {inv.status === 'confirmed' && (!inv.irn_status || inv.irn_status === 'pending' || inv.irn_status === 'failed') && canWrite && (
                        <Button variant="ghost" size="sm" title={eInvoiceStatus?.enabled ? 'Generate e-Invoice (IRN)' : 'TaxPro e-invoice is not configured on the server'}
                          onClick={() => { if (window.confirm('Generate e-Invoice for this invoice?')) generateEInvoiceMutation.mutate(inv.id); }}
                          disabled={generateEInvoiceMutation.isPending || !eInvoiceStatus?.enabled}>
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                      )}
                      {inv.irn_status === 'generated' && canWrite && (
                        <Button variant="ghost" size="sm" title="Cancel e-Invoice IRN"
                          onClick={() => { if (window.confirm('Cancel the e-Invoice IRN? This is only possible within 24 hours.')) cancelEInvoiceMutation.mutate(inv.id); }}
                          disabled={cancelEInvoiceMutation.isPending || !eInvoiceStatus?.enabled}>
                          <ShieldX className="h-3.5 w-3.5 text-amber-600" />
                        </Button>
                      )}
                      {inv.irn_status === 'generated' && (!inv.eway_bill_status || inv.eway_bill_status !== 'generated') && canWrite && eInvoiceStatus?.ewayConfigured && (
                        <Button variant="ghost" size="sm" title="Generate E-Way Bill (TaxPro)"
                          onClick={() => { 
                            const distance = window.prompt("Enter Distance (km):", "100");
                            if (!distance) return;
                            const vehNo = window.prompt("Enter Vehicle Number (e.g. MH12AB1234):", "");
                            if (!vehNo) return;
                            const transId = window.prompt("Enter Transporter ID (GSTIN):", "27AAAAA0000A1Z5");
                            if (!transId) return;

                            api.post(`/invoices/${inv.id}/ewaybill/generate`, {
                              distance_km: parseInt(distance),
                              vehicle_no: vehNo,
                              transporter_id: transId,
                              transport_mode: "1"
                            }).then(() => {
                              queryClient.invalidateQueries({ queryKey: ['invoices'] });
                              toast.success('E-Way bill generated.');
                            }).catch(err => toast.error(err.response?.data?.error || 'E-Way bill generation failed'));
                          }}>
                          <FileText className="h-3.5 w-3.5 text-blue-600" />
                          <span className="sr-only">E-Way Bill</span>
                        </Button>
                      )}
                      {inv.eway_bill_status === 'generated' && (
                        <Button variant="ghost" size="sm" title="E-Way Bill Details" onClick={() => {
                          const msg = `E-Way Bill No: ${inv.eway_bill_no}\nValid Until: ${formatDate(inv.eway_bill_valid_until)}`;
                          window.alert(msg);
                        }}>
                          <FileText className="h-3.5 w-3.5 text-blue-800" />
                        </Button>
                      )}
                      {inv.status === 'draft' && canWrite && (
                        <Button variant="ghost" size="sm" title="Confirm"
                          onClick={() => confirmMutation.mutate(inv.id)}
                          disabled={confirmMutation.isPending}>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                      )}
                      {inv.status !== 'cancelled' && canWrite && (
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

      <InvoicePreviewModal
        open={!!previewInvoice}
        onOpenChange={(o) => { if (!o) setPreviewInvoice(null); }}
        invoiceId={previewInvoice?.id}
        invoiceNumber={previewInvoice?.invoice_number}
        templates={invoiceTemplates}
        defaultTemplateId={preferredPdfTemplateId || undefined}
      />



      <WhatsAppSendDialog
        key={waDialog ? `wa-inv-${waDialog.id}` : 'wa-inv-closed'}
        open={!!waDialog}
        onOpenChange={(o) => { if (!o) setWaDialog(null); }}
        kind="invoice"
        entityId={waDialog?.id}
        customerName={waDialog?.name}
        onAppSendSuccess={({ kind, entityId }) => {
          if (kind === 'invoice' && entityId) markInvoiceWaSent(entityId);
        }}
      />
    </AppLayout>
  );
}
