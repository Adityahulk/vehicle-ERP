import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';

const PAYMENT_TYPES = ['Cash', 'UPI', 'NEFT', 'RTGS', 'Cheque', 'Credit', 'Card', 'Other'];

function emptyLine() {
  return {
    description: '',
    hsn_code: '8703',
    quantity: 1,
    unit_price_display: '',
    gst_rate: 5,
    price_includes_tax: true,
  };
}

function linePreview(line) {
  const qty = Number(line.quantity) || 1;
  const entered = Number(line.unit_price_display) || 0;
  const gstRate = Number(line.gst_rate) || 0;
  const taxableUnit = line.price_includes_tax ? (entered / (1 + (gstRate / 100))) : entered;
  const taxable = taxableUnit * qty;
  const gst = taxable * gstRate / 100;
  return {
    taxable,
    gst,
    gross: taxable + gst,
  };
}

export default function InvoiceEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState('Cash');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [customer, setCustomer] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    gstin: '',
  });
  const [items, setItems] = useState([emptyLine()]);

  const { data, isLoading } = useQuery({
    queryKey: ['invoice-edit', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  useEffect(() => {
    if (!data?.invoice) return;
    const inv = data.invoice;
    const loadedItems = (data.items || []).map((it) => {
      const rate = Number(it.igst_rate) > 0
        ? Number(it.igst_rate)
        : (Number(it.cgst_rate) + Number(it.sgst_rate));
      const exclusiveRupees = Number(it.unit_price || 0) / 100;
      const inclusiveRupees = exclusiveRupees * (1 + (rate / 100));
      return {
        description: it.description || '',
        hsn_code: it.hsn_code || '8703',
        quantity: Number(it.quantity) || 1,
        unit_price_display: inclusiveRupees ? inclusiveRupees.toFixed(2) : '',
        gst_rate: rate || 5,
        price_includes_tax: true,
      };
    });

    setInvoiceDate(inv.invoice_date ? String(inv.invoice_date).split('T')[0] : new Date().toISOString().split('T')[0]);
    setPaymentType(inv.payment_type || 'Cash');
    setDiscount(((Number(inv.discount || 0)) / 100).toFixed(2));
    setNotes(inv.notes || '');
    setCustomer({
      name: inv.customer_name || '',
      phone: inv.customer_phone || '',
      email: inv.customer_email || '',
      address: inv.customer_address || '',
      gstin: inv.customer_gstin || '',
    });
    setItems(loadedItems.length ? loadedItems : [emptyLine()]);
  }, [data]);

  const updateMut = useMutation({
    mutationFn: (body) => api.patch(`/invoices/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-edit', id] });
      navigate('/sales');
    },
  });

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, it) => s + linePreview(it).taxable, 0);
    const gst = items.reduce((s, it) => s + linePreview(it).gst, 0);
    const disc = Number(discount) || 0;
    return {
      subtotal,
      gst,
      discount: disc,
      total: subtotal + gst - disc,
    };
  }, [items, discount]);

  const setItem = (idx, key, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  };

  const saveInvoice = () => {
    const payloadItems = items
      .filter((it) => it.description && it.unit_price_display)
      .map((it) => {
        const gstRate = Number(it.gst_rate) || 0;
        const enteredPaise = Math.round((Number(it.unit_price_display) || 0) * 100);
        const unitPriceExclusive = it.price_includes_tax
          ? Math.round(enteredPaise / (1 + (gstRate / 100)))
          : enteredPaise;
        return {
          description: it.description,
          hsn_code: it.hsn_code || '8703',
          quantity: Number(it.quantity) || 1,
          unit_price: unitPriceExclusive,
          gst_rate: gstRate,
        };
      });

    if (!payloadItems.length) return;

    updateMut.mutate({
      customer: {
        name: customer.name,
        phone: customer.phone || undefined,
        email: customer.email || '',
        address: customer.address || undefined,
        gstin: customer.gstin || undefined,
      },
      items: payloadItems,
      discount: Math.max(0, Math.round((Number(discount) || 0) * 100)),
      invoice_date: invoiceDate,
      payment_type: paymentType,
      notes: notes || undefined,
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/sales"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
        <h2 className="text-2xl font-semibold">Edit invoice</h2>
      </div>

      <div className="space-y-6 max-w-6xl">
        <Card>
          <CardHeader><CardTitle className="text-base">Customer details</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <div><Label>Name *</Label><Input value={customer.name} onChange={(e) => setCustomer((p) => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Phone</Label><Input value={customer.phone} onChange={(e) => setCustomer((p) => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>Email</Label><Input value={customer.email} onChange={(e) => setCustomer((p) => ({ ...p, email: e.target.value }))} /></div>
            <div><Label>GSTIN</Label><Input value={customer.gstin} onChange={(e) => setCustomer((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))} /></div>
            <div className="sm:col-span-2"><Label>Address</Label><Textarea rows={2} value={customer.address} onChange={(e) => setCustomer((p) => ({ ...p, address: e.target.value }))} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Invoice details</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <div><Label>Invoice date</Label><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
            <div>
              <Label>Payment type</Label>
              <Select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                {PAYMENT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
            <div><Label>Discount (₹)</Label><Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Line items</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, emptyLine()])}>
              <Plus className="h-4 w-4 mr-1" /> Add line
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.map((it, idx) => {
              const pv = linePreview(it);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end border rounded-md p-3">
                  <div className="col-span-3"><Label className="text-xs">Description</Label><Input value={it.description} onChange={(e) => setItem(idx, 'description', e.target.value)} /></div>
                  <div className="col-span-2"><Label className="text-xs">HSN</Label><Input value={it.hsn_code} onChange={(e) => setItem(idx, 'hsn_code', e.target.value)} /></div>
                  <div className="col-span-1"><Label className="text-xs">Qty</Label><Input type="number" min="1" value={it.quantity} onChange={(e) => setItem(idx, 'quantity', Number(e.target.value))} /></div>
                  <div className="col-span-2"><Label className="text-xs">Unit Price ₹</Label><Input type="number" step="0.01" min="0" value={it.unit_price_display} onChange={(e) => setItem(idx, 'unit_price_display', e.target.value)} /></div>
                  <div className="col-span-2">
                    <Label className="text-xs">GST %</Label>
                    <Select value={String(it.gst_rate)} onChange={(e) => setItem(idx, 'gst_rate', Number(e.target.value))}>
                      {[5, 12, 18, 28, 0].map((r) => <option key={r} value={r}>{r}%</option>)}
                    </Select>
                  </div>
                  <div className="col-span-1 text-center">
                    <label className="text-[10px] text-muted-foreground flex flex-col items-center gap-1">
                      <input type="checkbox" checked={!!it.price_includes_tax} onChange={(e) => setItem(idx, 'price_includes_tax', e.target.checked)} />
                      Incl GST
                    </label>
                  </div>
                  <div className="col-span-1 text-right">
                    <Button variant="ghost" size="icon" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="col-span-12 text-xs text-muted-foreground">
                    Taxable: ₹{pv.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | GST: ₹{pv.gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | Total: ₹{pv.gross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Totals</CardTitle></CardHeader>
          <CardContent className="w-full sm:w-80 ml-auto space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>₹{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between"><span>GST</span><span>₹{totals.gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between"><span>Discount</span><span>- ₹{totals.discount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>₹{totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild><Link to="/sales">Cancel</Link></Button>
          <Button onClick={saveInvoice} disabled={updateMut.isPending}>
            {updateMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}

