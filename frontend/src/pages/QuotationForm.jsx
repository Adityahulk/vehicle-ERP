import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import QuotationPreviewModal from '@/components/QuotationPreviewModal';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { computeQuotationTotals, gstStateFromGstin } from '@/lib/quotationTotals';
import { formatCurrency, randomClientId } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Loader2, GripVertical, Trash2, Plus,
} from 'lucide-react';

const DEFAULT_TERMS = `1. This quotation is valid until the date shown under "Valid Until" above.
2. Prices are subject to change without prior notice after validity period.
3. GST will be charged as applicable at the time of billing.
4. Delivery period: 7-15 working days from the date of order confirmation.
5. 50% advance required to confirm the booking.`;

const VEHICLE_COLORS = [
  'White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Brown', 'Beige', 'Green', 'Other',
];

const GST_OPTIONS = [0, 5, 12, 18, 28];

function newLine(overrides = {}) {
  return {
    id: randomClientId(),
    item_type: 'other',
    description: '',
    hsn_code: '',
    quantity: 1,
    unit_price_rupees: '',
    discount_type: 'none',
    discount_value_rupees: '',
    discount_value_percent: '',
    gst_rate: 18,
    ...overrides,
  };
}

function SortableRow({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 items-start border-b border-border py-2">
      <button type="button" className="mt-2 text-muted-foreground cursor-grab" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-12 gap-2">{children}</div>
    </div>
  );
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function QuotationFormPage() {
  const { id: editId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [customerMode, setCustomerMode] = useState('existing');
  const [customerId, setCustomerId] = useState('');
  const [custSearch, setCustSearch] = useState('');
  const [walkin, setWalkin] = useState({ name: '', phone: '', email: '', address: '' });

  const [vehicleMode, setVehicleMode] = useState('stock');
  const [vehicleId, setVehicleId] = useState('');
  const [vehSearch, setVehSearch] = useState('');
  const [spec, setSpec] = useState({ make: '', model: '', variant: '', color: '', year: '' });

  const [lines, setLines] = useState([newLine({ item_type: 'vehicle', hsn_code: '8703', gst_rate: 28 })]);
  const [headerDiscType, setHeaderDiscType] = useState('flat');
  const [headerDiscRupees, setHeaderDiscRupees] = useState('');
  const [headerDiscPercent, setHeaderDiscPercent] = useState('');

  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [validUntil, setValidUntil] = useState(() => addDaysISO(30));
  const [branchId, setBranchId] = useState(user?.branch_id || '');
  const branchPickerLocked = user?.role === 'branch_manager';

  const [notes, setNotes] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [terms, setTerms] = useState(DEFAULT_TERMS);

  const [previewOpen, setPreviewOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.branches),
  });

  useEffect(() => {
    if (branchPickerLocked && user?.branch_id) {
      setBranchId(user.branch_id);
    }
  }, [branchPickerLocked, user?.branch_id]);

  const { data: company } = useQuery({
    queryKey: ['company', user?.company_id],
    queryFn: () => api.get(`/companies/${user.company_id}`).then((r) => r.data.company),
    enabled: !!user?.company_id,
  });

  const { data: custResults } = useQuery({
    queryKey: ['customers', custSearch],
    queryFn: () => api.get('/customers', { params: { search: custSearch, limit: 20 } }).then((r) => r.data.customers),
    enabled: custSearch.length >= 2,
  });

  const { data: vehResults } = useQuery({
    queryKey: ['vehicles', 'q', vehSearch],
    queryFn: () => api.get('/vehicles', { params: { status: 'in_stock', limit: 50, search: vehSearch } }).then((r) => r.data.vehicles),
    enabled: vehicleMode === 'stock' && vehSearch.length >= 1,
  });

  const { data: selectedCustomer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api.get(`/customers/${customerId}`).then((r) => r.data.customer),
    enabled: !!customerId && customerMode === 'existing',
  });

  const { data: selectedVehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get(`/vehicles/${vehicleId}`).then((r) => r.data.vehicle),
    enabled: !!vehicleId && vehicleMode === 'stock',
  });

  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['quotation', editId],
    queryFn: () => api.get(`/quotations/${editId}`).then((r) => r.data),
    enabled: !!editId,
  });

  useEffect(() => {
    if (!editData?.quotation) return;
    const q = editData.quotation;
    if (q.customer_id) {
      setCustomerMode('existing');
      setCustomerId(q.customer_id);
    } else {
      setCustomerMode('walkin');
      setWalkin({
        name: q.customer_name_override || '',
        phone: q.customer_phone_override || '',
        email: q.customer_email_override || '',
        address: q.customer_address_override || '',
      });
    }
    if (q.vehicle_id) {
      setVehicleMode('stock');
      setVehicleId(q.vehicle_id);
    } else if (q.vehicle_details_override) {
      setVehicleMode('spec');
      const vo = q.vehicle_details_override;
      setSpec({
        make: vo.make || '',
        model: vo.model || '',
        variant: vo.variant || '',
        color: vo.color || '',
        year: vo.year != null ? String(vo.year) : '',
      });
    }
    setQuotationDate(q.quotation_date?.split('T')[0] || quotationDate);
    setValidUntil(q.valid_until_date?.split('T')[0] || validUntil);
    setBranchId(q.branch_id || branchId);
    setNotes(q.notes || '');
    setCustomerNotes(q.customer_notes || '');
    setTerms(q.terms_and_conditions || DEFAULT_TERMS);
    setHeaderDiscType(q.discount_type || 'flat');
    if (q.discount_type === 'percent') {
      setHeaderDiscPercent(String((Number(q.discount_value) || 0) / 100));
      setHeaderDiscRupees('');
    } else {
      setHeaderDiscRupees(String((Number(q.discount_value) || 0) / 100));
      setHeaderDiscPercent('');
    }
    setLines(
      (editData.items || []).map((it) => newLine({
        id: it.id || randomClientId(),
        item_type: it.item_type,
        description: it.description,
        hsn_code: it.hsn_code || '',
        quantity: it.quantity,
        unit_price_rupees: String((Number(it.unit_price) || 0) / 100),
        discount_type: it.discount_type,
        discount_value_rupees: it.discount_type === 'flat' ? String((Number(it.discount_value) || 0) / 100) : '',
        discount_value_percent: it.discount_type === 'percent' ? String((Number(it.discount_value) || 0) / 100) : '',
        gst_rate: Number(it.igst_rate) > 0 ? Number(it.igst_rate) : Number(it.cgst_rate) + Number(it.sgst_rate),
      })),
    );
  }, [editData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedVehicle && vehicleMode === 'stock') {
      const desc = [selectedVehicle.make, selectedVehicle.model, selectedVehicle.variant].filter(Boolean).join(' ');
      setLines((prev) => {
        const next = [...prev];
        const idx = next.findIndex((l) => l.item_type === 'vehicle');
        const rupees = (Number(selectedVehicle.selling_price) || 0) / 100;
        const row = {
          ...(idx >= 0 ? next[idx] : newLine({ item_type: 'vehicle' })),
          item_type: 'vehicle',
          description: desc || 'Vehicle',
          hsn_code: '8703',
          gst_rate: 28,
          unit_price_rupees: String(rupees),
        };
        if (idx >= 0) next[idx] = row;
        else next.unshift(row);
        return next;
      });
    }
  }, [selectedVehicle, vehicleMode]);

  const interstate = useMemo(() => {
    const cg = company?.gstin;
    const cug = selectedCustomer?.gstin;
    return gstStateFromGstin(cg, cug);
  }, [company?.gstin, selectedCustomer?.gstin]);

  const calcLines = useMemo(() => lines.map((L, i) => {
    const unitPaise = Math.round((Number(L.unit_price_rupees) || 0) * 100);
    let dv = 0;
    if (L.discount_type === 'flat') {
      dv = Math.round((Number(L.discount_value_rupees) || 0) * 100);
    } else if (L.discount_type === 'percent') {
      const p = Number(L.discount_value_percent) || 0;
      dv = Math.round(p * 100);
    }
    return {
      item_type: L.item_type,
      description: L.description || `Item ${i + 1}`,
      hsn_code: L.hsn_code,
      quantity: L.quantity,
      unit_price: unitPaise,
      discount_type: L.discount_type,
      discount_value: dv,
      gst_rate: Number(L.gst_rate) || 0,
      sort_order: i,
    };
  }), [lines]);

  let headerDv = 0;
  if (headerDiscType === 'flat') {
    headerDv = Math.round((Number(headerDiscRupees) || 0) * 100);
  } else {
    const p = Number(headerDiscPercent) || 0;
    headerDv = Math.round(p * 100);
  }

  const totals = computeQuotationTotals(calcLines, interstate, headerDiscType, headerDv);

  const buildPayload = (status = 'draft') => {
    const payload = {
      branch_id: branchId || undefined,
      quotation_date: quotationDate,
      valid_until_date: validUntil || null,
      customer_id: customerMode === 'existing' ? (customerId || undefined) : undefined,
      customer_name_override: customerMode === 'walkin' ? walkin.name : undefined,
      customer_phone_override: customerMode === 'walkin' ? walkin.phone : undefined,
      customer_email_override: customerMode === 'walkin' ? walkin.email || undefined : undefined,
      customer_address_override: customerMode === 'walkin' ? walkin.address || undefined : undefined,
      vehicle_id: vehicleMode === 'stock' ? (vehicleId || undefined) : undefined,
      vehicle_details_override:
        vehicleMode === 'spec' && (spec.make || spec.model)
          ? {
            make: spec.make,
            model: spec.model,
            variant: spec.variant,
            color: spec.color,
            year: spec.year ? Number(spec.year) : undefined,
          }
          : undefined,
      items: calcLines,
      discount_type: headerDiscType,
      discount_value: headerDv,
      notes: notes || undefined,
      customer_notes: customerNotes || undefined,
      terms_and_conditions: terms || undefined,
      status,
    };
    if (editId) {
      payload.status = editData?.quotation?.status === 'sent' ? 'sent' : 'draft';
    }
    return payload;
  };

  const saveMut = useMutation({
    mutationFn: async ({ status }) => {
      const payload = buildPayload(status);
      if (editId) {
        return api.patch(`/quotations/${editId}`, payload);
      }
      return api.post('/quotations', payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      const qid = res.data?.quotation?.id || editId;
      toast.success('Quotation saved');
      if (!editId && res.data?.quotation?.id) {
        navigate(`/quotations/${res.data.quotation.id}`, { replace: true });
      }
      if (editId) {
        qc.invalidateQueries({ queryKey: ['quotation', editId] });
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLines((items) => {
      const oldIndex = items.findIndex((x) => x.id === active.id);
      const newIndex = items.findIndex((x) => x.id === over.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const addRow = (type) => {
    const presets = {
      accessory: { item_type: 'accessory', hsn_code: '8714', gst_rate: 18 },
      insurance: { item_type: 'insurance', hsn_code: '9971', gst_rate: 18 },
      rto: { item_type: 'rto', hsn_code: '', gst_rate: 0 },
      other: { item_type: 'other', hsn_code: '', gst_rate: 18 },
    };
    setLines((p) => [...p, newLine(presets[type] || presets.other)]);
  };

  if (editId && editLoading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto pb-28">
        <h2 className="text-2xl font-semibold mb-6">{editId ? 'Edit quotation' : 'New quotation'}</h2>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={customerMode === 'existing' ? 'default' : 'outline'} onClick={() => setCustomerMode('existing')}>Existing customer</Button>
                <Button type="button" size="sm" variant={customerMode === 'walkin' ? 'default' : 'outline'} onClick={() => setCustomerMode('walkin')}>New / walk-in</Button>
              </div>
              {customerMode === 'existing' ? (
                <div className="space-y-2">
                  <Label>Search customer</Label>
                  <Input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Name or phone (min 2 chars)" />
                  <Select className="w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Select…</option>
                    {(custResults || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>Name *</Label><Input value={walkin.name} onChange={(e) => setWalkin((p) => ({ ...p, name: e.target.value }))} /></div>
                  <div><Label>Phone *</Label><Input value={walkin.phone} onChange={(e) => setWalkin((p) => ({ ...p, phone: e.target.value }))} /></div>
                  <div><Label>Email</Label><Input value={walkin.email} onChange={(e) => setWalkin((p) => ({ ...p, email: e.target.value }))} /></div>
                  <div className="sm:col-span-2"><Label>Address</Label><Input value={walkin.address} onChange={(e) => setWalkin((p) => ({ ...p, address: e.target.value }))} /></div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Customer details can be updated when converting to invoice.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Vehicle</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={vehicleMode === 'stock' ? 'default' : 'outline'} onClick={() => setVehicleMode('stock')}>From stock</Button>
                <Button type="button" size="sm" variant={vehicleMode === 'spec' ? 'default' : 'outline'} onClick={() => { setVehicleMode('spec'); setVehicleId(''); }}>Specific model (not in stock)</Button>
              </div>
              {vehicleMode === 'stock' ? (
                <div className="space-y-2">
                  <Label>Search vehicle</Label>
                  <Input value={vehSearch} onChange={(e) => setVehSearch(e.target.value)} placeholder="Make / model / chassis" />
                  <Select className="w-full" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Select…</option>
                    {(vehResults || []).map((v) => (
                      <option key={v.id} value={v.id}>{v.make} {v.model} — {v.chassis_number}</option>
                    ))}
                  </Select>
                  {selectedVehicle && (
                    <div className="text-sm text-muted-foreground rounded-md border p-3 bg-muted/30">
                      <p><strong>{selectedVehicle.make}</strong> {selectedVehicle.model} {selectedVehicle.variant}</p>
                      <p>Chassis: {selectedVehicle.chassis_number} · Color: {selectedVehicle.color} · Year: {selectedVehicle.year}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>Make</Label><Input value={spec.make} onChange={(e) => setSpec((p) => ({ ...p, make: e.target.value }))} /></div>
                  <div><Label>Model</Label><Input value={spec.model} onChange={(e) => setSpec((p) => ({ ...p, model: e.target.value }))} /></div>
                  <div><Label>Variant</Label><Input value={spec.variant} onChange={(e) => setSpec((p) => ({ ...p, variant: e.target.value }))} /></div>
                  <div>
                    <Label>Color</Label>
                    <Select value={spec.color} onChange={(e) => setSpec((p) => ({ ...p, color: e.target.value }))}>
                      <option value="">Select…</option>
                      {VEHICLE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </div>
                  <div><Label>Year</Label><Input type="number" value={spec.year} onChange={(e) => setSpec((p) => ({ ...p, year: e.target.value }))} /></div>
                  <p className="sm:col-span-2 text-xs text-muted-foreground">Chassis number will be assigned at time of billing.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-2">
              <CardTitle className="text-base">Line items</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => addRow('accessory')}>
                  <Plus className="h-3 w-3 mr-1" /> Accessories
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => addRow('insurance')}>Insurance</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => addRow('rto')}>RTO</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => addRow('other')}>Other</Button>
              </div>
            </CardHeader>
            <CardContent>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                  {lines.map((L) => (
                    <SortableRow key={L.id} id={L.id}>
                      <div className="lg:col-span-3">
                        <Label className="text-xs">Description</Label>
                        <Input value={L.description} onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, description: e.target.value } : x))} />
                      </div>
                      <div className="lg:col-span-1">
                        <Label className="text-xs">HSN</Label>
                        <Input className="font-mono text-xs" value={L.hsn_code} onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, hsn_code: e.target.value } : x))} />
                      </div>
                      <div className="lg:col-span-1">
                        <Label className="text-xs">Qty</Label>
                        <Input type="number" min={1} value={L.quantity} onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, quantity: Number(e.target.value) || 1 } : x))} />
                      </div>
                      <div className="lg:col-span-2">
                        <Label className="text-xs">Unit ₹</Label>
                        <Input value={L.unit_price_rupees} onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, unit_price_rupees: e.target.value } : x))} />
                      </div>
                      <div className="lg:col-span-2 flex gap-1 items-end">
                        <Select
                          className="h-9 text-xs"
                          value={L.discount_type}
                          onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, discount_type: e.target.value } : x))}
                        >
                          <option value="none">No disc.</option>
                          <option value="flat">₹ off</option>
                          <option value="percent">% off</option>
                        </Select>
                        {L.discount_type === 'flat' && (
                          <Input className="h-9" placeholder="₹" value={L.discount_value_rupees} onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, discount_value_rupees: e.target.value } : x))} />
                        )}
                        {L.discount_type === 'percent' && (
                          <Input className="h-9" placeholder="%" value={L.discount_value_percent} onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, discount_value_percent: e.target.value } : x))} />
                        )}
                      </div>
                      <div className="lg:col-span-2">
                        <Label className="text-xs">GST %</Label>
                        <Select value={String(L.gst_rate)} onChange={(e) => setLines((p) => p.map((x) => x.id === L.id ? { ...x, gst_rate: Number(e.target.value) } : x))}>
                          {GST_OPTIONS.map((g) => <option key={g} value={g}>{g}%</option>)}
                        </Select>
                      </div>
                      <div className="lg:col-span-1 flex items-end">
                        <Button type="button" variant="ghost" size="icon" onClick={() => setLines((p) => p.filter((x) => x.id !== L.id))}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </SortableRow>
                  ))}
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Totals</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (taxable)</span><span className="font-mono">{formatCurrency(totals.subtotal)}</span></div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-muted-foreground">Overall discount</span>
                  <Select className="w-28 h-8 text-xs" value={headerDiscType} onChange={(e) => setHeaderDiscType(e.target.value)}>
                    <option value="flat">Flat ₹</option>
                    <option value="percent">Percent</option>
                  </Select>
                  {headerDiscType === 'flat' ? (
                    <Input className="w-28 h-8" value={headerDiscRupees} onChange={(e) => setHeaderDiscRupees(e.target.value)} />
                  ) : (
                    <Input className="w-28 h-8" value={headerDiscPercent} onChange={(e) => setHeaderDiscPercent(e.target.value)} placeholder="%" />
                  )}
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="font-mono">{formatCurrency(totals.cgst_amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="font-mono">{formatCurrency(totals.sgst_amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="font-mono">{formatCurrency(totals.igst_amount)}</span></div>
                <div className="flex justify-between text-lg font-bold text-primary pt-2 border-t">
                  <span>Grand total</span>
                  <span className="font-mono">{formatCurrency(totals.total)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Settings</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><Label>Quotation date</Label><Input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} /></div>
                <div><Label>Valid until</Label><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
                <div><Label>Prepared by</Label><Input readOnly value={user?.name || user?.email || ''} className="bg-muted/50" /></div>
                <div>
                  <Label>Branch</Label>
                  {branchPickerLocked ? (
                    <Input
                      readOnly
                      className="bg-muted/50"
                      value={(branches || []).find((b) => b.id === branchId)?.name || '—'}
                    />
                  ) : (
                    <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                      <option value="">Select branch…</option>
                      {(branches || []).map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </Select>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <Label>Customer notes (on PDF)</Label>
              <Textarea rows={4} placeholder="e.g. Special color requested…" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Internal notes</Label>
              <Textarea rows={4} placeholder="Not shown on PDF…" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Terms &amp; conditions</Label>
            <p className="text-xs text-muted-foreground mb-1">These terms will appear on the quotation PDF.</p>
            <Textarea rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur py-3 px-4 z-40">
        <div className="max-w-5xl mx-auto flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" disabled={saveMut.isPending} onClick={() => saveMut.mutate({ status: 'draft' })}>
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save as Draft
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>Preview PDF</Button>
            <Button
              type="button"
              disabled={saveMut.isPending}
              onClick={async () => {
                try {
                  const saved = await saveMut.mutateAsync({ status: 'draft' });
                  const qid = saved.data?.quotation?.id || editId;
                  if (!qid) {
                    toast.error('Save first');
                    return;
                  }
                  const res = await api.get(`/quotations/${qid}/pdf`, { responseType: 'blob' });
                  const u = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                  const a = document.createElement('a');
                  a.href = u;
                  a.download = `${saved.data?.quotation?.quotation_number || 'quotation'}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(u);
                } catch {
                  toast.error('Save or download failed');
                }
              }}
            >
              Save &amp; Download PDF
            </Button>
          </div>
        </div>
      </div>

      <QuotationPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        getPreviewPayload={() => buildPayload('draft')}
      />
    </AppLayout>
  );
}
