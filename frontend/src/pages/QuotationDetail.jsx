import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import QuotationPreviewModal from '@/components/QuotationPreviewModal';
import api from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ReadOnlyBadge from '@/components/ReadOnlyBadge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Loader2, Pencil, Send, FileDown, Trash2, Check, X,
  RefreshCw, FileText, Eye,
} from 'lucide-react';

export default function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite, isCA } = usePermissions();
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get(`/quotations/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const q = data?.quotation;
  const items = data?.items || [];
  const customer = data?.customer;
  const vehicle = data?.vehicle;
  const vo = data?.vehicle_override || {};

  const invalidate = () => qc.invalidateQueries({ queryKey: ['quotation', id] });

  const sendMut = useMutation({
    mutationFn: () => api.post(`/quotations/${id}/send`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['quotations'] });
      toast.success('Marked as sent');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const acceptMut = useMutation({
    mutationFn: () => api.post(`/quotations/${id}/accept`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['quotations'] }); toast.success('Accepted'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const rejectMut = useMutation({
    mutationFn: () => api.post(`/quotations/${id}/reject`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['quotations'] }); toast.success('Rejected'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const delMut = useMutation({
    mutationFn: () => api.delete(`/quotations/${id}`),
    onSuccess: () => { toast.success('Deleted'); navigate('/quotations'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const dupMut = useMutation({
    mutationFn: () => api.post(`/quotations/${id}/duplicate`),
    onSuccess: (res) => {
      toast.success('Duplicate created');
      navigate(`/quotations/${res.data.quotation.id}/edit`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const convertMut = useMutation({
    mutationFn: () => api.post(`/quotations/${id}/convert`),
    onSuccess: (res) => {
      const d = res.data;
      if (d?.requiresVehicleSelection) {
        toast.info('Select an in-stock vehicle before converting.', {
          description: 'Edit the quotation and link a stock vehicle, then convert again.',
        });
        navigate(`/quotations/${id}/edit`);
        return;
      }
      toast.success('Invoice created');
      if (d?.invoice_id) navigate('/sales');
      invalidate();
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Convert failed'),
  });

  const downloadPdf = async () => {
    try {
      const res = await api.get(`/quotations/${id}/pdf`, { responseType: 'blob' });
      const u = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = u;
      a.download = `${q?.quotation_number || 'q'}.pdf`;
      a.click();
      window.URL.revokeObjectURL(u);
    } catch {
      toast.error('PDF failed');
    }
  };

  const custName = customer?.name || q?.customer_name_override || '—';
  const custPhone = customer?.phone || q?.customer_phone_override || '';
  const makeModel = vehicle
    ? `${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.variant || ''}`.trim()
    : [vo.make, vo.model, vo.variant].filter(Boolean).join(' ');

  if (isLoading || !q) {
    return (
      <AppLayout>
        <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </AppLayout>
    );
  }

  const steps = [
    { key: 'created', label: 'Created', done: true, at: q.created_at },
    { key: 'sent', label: 'Sent', done: !!q.sent_at, at: q.sent_at },
    { key: 'outcome', label: q.status === 'accepted' ? 'Accepted' : q.status === 'rejected' ? 'Rejected' : 'Decision', done: ['accepted', 'rejected', 'converted'].includes(q.status), at: null },
    { key: 'converted', label: 'Converted', done: q.status === 'converted', at: q.converted_at },
  ];

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-semibold font-mono">{q.quotation_number}</h2>
              <Badge>{q.status}</Badge>
              {isCA ? <ReadOnlyBadge /> : null}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {formatDate(q.quotation_date)} · Valid {formatDate(q.valid_until_date)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite && q.status === 'draft' && (
              <>
                <Button variant="outline" size="sm" onClick={() => navigate(`/quotations/${id}/edit`)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                <Button size="sm" onClick={() => sendMut.mutate()} disabled={sendMut.isPending}><Send className="h-4 w-4 mr-1" /> Send</Button>
              </>
            )}
            {canWrite && q.status === 'sent' && (
              <>
                <Button variant="outline" size="sm" onClick={() => acceptMut.mutate()} disabled={acceptMut.isPending}><Check className="h-4 w-4 mr-1" /> Accept</Button>
                <Button variant="outline" size="sm" onClick={() => rejectMut.mutate()} disabled={rejectMut.isPending}><X className="h-4 w-4 mr-1" /> Reject</Button>
                <Button variant="outline" size="sm" onClick={() => navigate(`/quotations/${id}/edit`)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
              </>
            )}
            {canWrite && ['sent', 'accepted'].includes(q.status) && (
              <Button size="sm" onClick={() => convertMut.mutate()} disabled={convertMut.isPending}>
                <RefreshCw className="h-4 w-4 mr-1" /> Convert to Invoice
              </Button>
            )}
            {q.status === 'converted' && q.converted_to_invoice_id && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/sales"><FileText className="h-4 w-4 mr-1" /> View invoices</Link>
              </Button>
            )}
            {['rejected', 'expired'].includes(q.status) && canWrite && (
              <Button variant="outline" size="sm" onClick={() => dupMut.mutate()} disabled={dupMut.isPending}>Duplicate</Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4 mr-1" /> Preview</Button>
            <Button variant="outline" size="sm" onClick={downloadPdf}><FileDown className="h-4 w-4 mr-1" /> PDF</Button>
            {canWrite && q.status === 'draft' && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { if (window.confirm('Delete this draft?')) delMut.mutate(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Status</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-xs">
              {steps.map((s) => (
                <div key={s.key} className={s.done ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                  <div>{s.label}</div>
                  {s.at && <div className="text-[10px] text-muted-foreground">{formatDate(s.at)}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p className="font-medium">{custName}</p>
              <p className="text-muted-foreground">{custPhone} {customer?.email ? `· ${customer.email}` : ''}</p>
              {(customer?.address || q.customer_address_override) && (
                <p className="whitespace-pre-wrap">{customer?.address || q.customer_address_override}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Vehicle</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              {vehicle ? (
                <>
                  <p>{vehicle.make} {vehicle.model} {vehicle.variant}</p>
                  <p className="text-muted-foreground">Chassis: {vehicle.chassis_number}</p>
                </>
              ) : (
                <p>{makeModel || '—'} {vo.color ? `· ${vo.color}` : ''} {vo.year ? `· ${vo.year}` : ''}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            {items.map((it, i) => (
              <div key={it.id || i} className="flex justify-between gap-2 border-b border-border pb-2">
                <div>
                  <Badge variant="secondary" className="text-[10px] mr-2">{it.item_type}</Badge>
                  {it.description}
                </div>
                <span className="font-mono shrink-0">{formatCurrency(it.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold pt-2">
              <span>Total</span>
              <span className="font-mono text-primary">{formatCurrency(q.total)}</span>
            </div>
          </CardContent>
        </Card>

        {q.customer_notes && (
          <Card>
            <CardHeader><CardTitle className="text-base">Customer notes (PDF)</CardTitle></CardHeader>
            <CardContent className="text-sm whitespace-pre-wrap">{q.customer_notes}</CardContent>
          </Card>
        )}
        {q.notes && (
          <Card>
            <CardHeader><CardTitle className="text-base">Internal notes</CardTitle></CardHeader>
            <CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">{q.notes}</CardContent>
          </Card>
        )}
      </div>

      <QuotationPreviewModal open={previewOpen} onOpenChange={setPreviewOpen} quotationId={id} />
    </AppLayout>
  );
}
