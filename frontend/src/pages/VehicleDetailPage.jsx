import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  ArrowLeft, Pencil, AlertTriangle, Clock, FileText,
  ArrowRightLeft, Landmark, Package, Shield, Car, Loader2,
} from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';

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

function useVehicleDetail(id) {
  return useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api.get(`/vehicles/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

function InsuranceExpiryBadge({ expiryDate }) {
  if (!expiryDate) return <span className="text-muted-foreground text-sm">Not set</span>;

  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return <Badge variant="destructive">Expired {Math.abs(diffDays)}d ago</Badge>;
  }
  if (diffDays <= 30) {
    return <Badge variant="warning">Expires in {diffDays}d</Badge>;
  }
  return <span className="text-sm">{formatDate(expiryDate)}</span>;
}

function DetailRow({ label, children }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{children || '—'}</span>
    </div>
  );
}

function EditVehicleSheet({ open, onOpenChange, vehicle, onSuccess }) {
  const [form, setForm] = useState({});
  const queryClient = useQueryClient();

  const resetForm = () => {
    if (!vehicle) return;
    setForm({
      chassis_number: vehicle.chassis_number || '',
      engine_number: vehicle.engine_number || '',
      make: vehicle.make || '',
      model: vehicle.model || '',
      variant: vehicle.variant || '',
      color: vehicle.color || '',
      year: vehicle.year || '',
      rto_number: vehicle.rto_number || '',
      rto_date: vehicle.rto_date ? vehicle.rto_date.slice(0, 10) : '',
      insurance_company: vehicle.insurance_company || '',
      insurance_number: vehicle.insurance_number || '',
      insurance_expiry: vehicle.insurance_expiry ? vehicle.insurance_expiry.slice(0, 10) : '',
      purchase_price: vehicle.purchase_price || 0,
      selling_price: vehicle.selling_price || 0,
    });
  };

  const handleOpen = (isOpen) => {
    if (isOpen) resetForm();
    onOpenChange(isOpen);
  };

  const mutation = useMutation({
    mutationFn: (data) => api.patch(`/vehicles/${vehicle.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      year: form.year ? Number(form.year) : undefined,
      purchase_price: Number(form.purchase_price),
      selling_price: Number(form.selling_price),
      rto_date: form.rto_date || null,
      insurance_expiry: form.insurance_expiry || null,
      insurance_company: form.insurance_company || null,
      insurance_number: form.insurance_number || null,
    };
    mutation.mutate(payload);
  };

  const field = (key, label, type = 'text') => (
    <div key={key}>
      <Label>{label}</Label>
      <Input
        type={type}
        value={form[key] ?? ''}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit Vehicle</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-3">
            {field('chassis_number', 'Chassis Number')}
            {field('engine_number', 'Engine Number')}
            {field('make', 'Make')}
            {field('model', 'Model')}
            {field('variant', 'Variant')}
            {field('color', 'Color')}
            {field('year', 'Year', 'number')}
          </div>

          <h4 className="font-medium text-sm pt-2">RTO & Insurance</h4>
          <div className="grid grid-cols-2 gap-3">
            {field('rto_number', 'RTO Number')}
            {field('rto_date', 'RTO Date', 'date')}
            {field('insurance_company', 'Insurance Company')}
            {field('insurance_number', 'Policy Number')}
            {field('insurance_expiry', 'Insurance Expiry', 'date')}
          </div>

          <h4 className="font-medium text-sm pt-2">Pricing (in paise)</h4>
          <div className="grid grid-cols-2 gap-3">
            {field('purchase_price', 'Purchase Price', 'number')}
            {field('selling_price', 'Selling Price', 'number')}
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive">
              {mutation.error?.response?.data?.error || 'Update failed'}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function VehicleIdentitySection({ vehicle, onEdit }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-3">
          <Car className="h-5 w-5 text-primary" />
          <CardTitle>Vehicle Identity</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGE[vehicle.status]}>
            {STATUS_LABEL[vehicle.status] || vehicle.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <DetailRow label="Chassis Number">{vehicle.chassis_number}</DetailRow>
          <DetailRow label="Engine Number">{vehicle.engine_number}</DetailRow>
          <DetailRow label="Make">{vehicle.make}</DetailRow>
          <DetailRow label="Model">{vehicle.model}</DetailRow>
          <DetailRow label="Variant">{vehicle.variant}</DetailRow>
          <DetailRow label="Color">{vehicle.color}</DetailRow>
          <DetailRow label="Year">{vehicle.year}</DetailRow>
          <DetailRow label="Branch">{vehicle.branch_name}</DetailRow>
        </div>
      </CardContent>
    </Card>
  );
}

function RtoInsuranceSection({ vehicle, onEdit }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle>RTO & Insurance</CardTitle>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <DetailRow label="RTO Number">{vehicle.rto_number}</DetailRow>
          <DetailRow label="RTO Date">
            {vehicle.rto_date ? formatDate(vehicle.rto_date) : null}
          </DetailRow>
          <DetailRow label="Insurance Company">{vehicle.insurance_company}</DetailRow>
          <DetailRow label="Policy Number">{vehicle.insurance_number}</DetailRow>
          <DetailRow label="Insurance Expiry">
            <InsuranceExpiryBadge expiryDate={vehicle.insurance_expiry} />
          </DetailRow>
        </div>
      </CardContent>
    </Card>
  );
}

function PricingSection({ vehicle }) {
  const purchase = vehicle.purchase_price || 0;
  const selling = vehicle.selling_price || 0;
  const margin = purchase > 0 ? (((selling - purchase) / purchase) * 100).toFixed(1) : '—';

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-primary" />
          <CardTitle>Pricing</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Purchase Price</p>
            <p className="text-lg font-semibold">{formatCurrency(purchase)}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Selling Price</p>
            <p className="text-lg font-semibold">{formatCurrency(selling)}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Margin</p>
            <p className={cn(
              'text-lg font-semibold',
              margin !== '—' && Number(margin) >= 0 ? 'text-emerald-600' : 'text-red-600',
            )}>
              {margin !== '—' ? `${margin}%` : '—'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TransferHistorySection({ transfers }) {
  if (!transfers || transfers.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            <CardTitle>Transfer History</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No transfers recorded for this vehicle.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className="h-5 w-5 text-primary" />
          <CardTitle>Transfer History</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative pl-6 space-y-6">
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
          {transfers.map((t) => (
            <div key={t.id} className="relative">
              <div className="absolute -left-6 top-1 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div>
                  <p className="text-sm font-medium">
                    {t.from_branch_name} → {t.to_branch_name}
                  </p>
                  {t.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">{t.notes}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {formatDate(t.transferred_at)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    by {t.transferred_by_name}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LoanDetailsSection({ loans }) {
  if (!loans || loans.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Landmark className="h-5 w-5 text-primary" />
            <CardTitle>Loan Details</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No loan associated with this vehicle.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <Landmark className="h-5 w-5 text-primary" />
          <CardTitle>Loan Details</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loans.map((loan) => {
          const isOverdue = loan.status === 'active' && new Date(loan.due_date) < new Date();
          return (
            <div key={loan.id} className={cn(
              'border rounded-lg p-4',
              isOverdue ? 'border-red-300 bg-red-50/50' : 'border-border',
            )}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm">{loan.bank_name}</span>
                <Badge variant={
                  loan.status === 'active' ? (isOverdue ? 'destructive' : 'success') : 'secondary'
                }>
                  {isOverdue ? 'Overdue' : loan.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Loan Amount</p>
                  <p className="font-medium">{formatCurrency(loan.loan_amount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">EMI</p>
                  <p className="font-medium">{formatCurrency(loan.emi_amount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Due Date</p>
                  <p className="font-medium">{formatDate(loan.due_date)}</p>
                </div>
                {loan.total_penalty_accrued > 0 && (
                  <div>
                    <p className="text-muted-foreground text-xs">Penalty</p>
                    <p className="font-medium text-red-600">
                      {formatCurrency(loan.total_penalty_accrued)}
                    </p>
                  </div>
                )}
                {loan.customer_name && (
                  <div>
                    <p className="text-muted-foreground text-xs">Customer</p>
                    <p className="font-medium">{loan.customer_name}</p>
                  </div>
                )}
              </div>
              <Link
                to="/loans"
                className="text-xs text-primary hover:underline mt-3 inline-block"
              >
                View full loan record →
              </Link>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function DocumentsSection() {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-primary" />
          <CardTitle>Documents</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Add documents coming soon</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload RC, insurance papers, and other vehicle documents
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VehicleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [editOpen, setEditOpen] = useState(false);
  const { data, isLoading, isError } = useVehicleDetail(id);

  const canSeePricing = ['super_admin', 'company_admin', 'branch_manager'].includes(user?.role);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (isError || !data?.vehicle) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="text-muted-foreground">Vehicle not found or failed to load.</p>
          <Button variant="outline" onClick={() => navigate('/inventory')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Inventory
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { vehicle, transfers, loans } = data;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">
              {[vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(' ') || 'Vehicle'}
            </h1>
            <p className="text-sm text-muted-foreground">{vehicle.chassis_number}</p>
          </div>
        </div>

        <VehicleIdentitySection vehicle={vehicle} onEdit={() => setEditOpen(true)} />
        <RtoInsuranceSection vehicle={vehicle} onEdit={() => setEditOpen(true)} />
        {canSeePricing && <PricingSection vehicle={vehicle} />}
        <TransferHistorySection transfers={transfers} />
        <LoanDetailsSection loans={loans} />
        <DocumentsSection />

        <EditVehicleSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          vehicle={vehicle}
        />
      </div>
    </AppLayout>
  );
}
