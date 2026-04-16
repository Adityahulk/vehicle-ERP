import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WhatsAppSendDialog, { WhatsAppIconButton } from '@/components/WhatsAppSendDialog';
import api from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ReadOnlyBadge from '@/components/ReadOnlyBadge';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Plus, Search, Loader2, Eye, Pencil, Send, FileDown, FileText,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'converted', label: 'Converted' },
];

const STATUS_BADGE = {
  draft: 'secondary',
  sent: 'default',
  accepted: 'success',
  rejected: 'destructive',
  expired: 'warning',
  converted: 'outline',
};

export default function QuotationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite, isCA } = usePermissions();
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [waDialog, setWaDialog] = useState(null);
  const [waMeta, setWaMeta] = useState({});

  const markQuotationWaSent = (quotationId) => {
    const now = Date.now();
    setWaMeta((u) => ({ ...u, [quotationId]: { lastSent: now, flash: true } }));
    setTimeout(() => {
      setWaMeta((u) => {
        const cur = u[quotationId];
        if (!cur) return u;
        return { ...u, [quotationId]: { ...cur, flash: false } };
      });
    }, 3000);
  };

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = Object.fromEntries(
    Object.entries({ status, customer_search: search, limit: 50 }).filter(([, v]) => v !== ''),
  );

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', params],
    queryFn: () => api.get('/quotations', { params }).then((r) => r.data),
  });

  const rows = data?.quotations || [];

  const downloadPdf = async (id, num) => {
    try {
      const res = await api.get(`/quotations/${id}/pdf`, { responseType: 'blob' });
      const u = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = u;
      a.download = `${num || 'quotation'}.pdf`;
      a.click();
      window.URL.revokeObjectURL(u);
    } catch {
      toast.error('PDF download failed');
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold">Quotations</h2>
          {isCA ? <ReadOnlyBadge /> : null}
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/quotations/new')}>
              <Plus className="h-4 w-4 mr-2" /> New Quotation
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search customer name or phone..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Tabs value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <TabsList className="flex-wrap h-auto gap-1">
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value || 'all'} value={t.value || 'all'} className="text-xs sm:text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quotation No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Valid Until</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  No quotations found
                </TableCell>
              </TableRow>
            ) : (
              rows.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{q.quotation_number}</TableCell>
                  <TableCell>{formatDate(q.quotation_date)}</TableCell>
                  <TableCell>{formatDate(q.valid_until_date)}</TableCell>
                  <TableCell>
                    <div>{q.customer_display_name || '—'}</div>
                    <div className="text-xs text-muted-foreground">{q.customer_display_phone}</div>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate">
                    {q.vehicle_make ? `${q.vehicle_make} ${q.vehicle_model}` : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(q.total)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[q.status] || 'secondary'}>{q.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" title="View" onClick={() => navigate(`/quotations/${q.id}`)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {canWrite && ['draft', 'sent'].includes(q.status) && (
                        <Button variant="ghost" size="sm" title="Edit" onClick={() => navigate(`/quotations/${q.id}/edit`)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canWrite && q.status === 'draft' && (
                        <Button variant="ghost" size="sm" title="Send" onClick={async () => {
                          try {
                            await api.post(`/quotations/${q.id}/send`);
                            qc.invalidateQueries({ queryKey: ['quotations'] });
                            toast.success('Marked as sent');
                          } catch (e) {
                            toast.error(e.response?.data?.error || 'Failed');
                          }
                        }}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canWrite && ['sent', 'accepted'].includes(q.status) && (
                        <Button variant="ghost" size="sm" title="View / convert" onClick={() => navigate(`/quotations/${q.id}`)}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" title="PDF" onClick={() => downloadPdf(q.id, q.quotation_number)}>
                        <FileDown className="h-3.5 w-3.5" />
                      </Button>
                      {canWrite && ['sent', 'accepted'].includes(q.status) && (
                        <WhatsAppIconButton
                          title="Send quotation on WhatsApp"
                          lastSentAt={waMeta[q.id]?.lastSent}
                          flashCheck={waMeta[q.id]?.flash}
                          onClick={() => setWaDialog({
                            id: q.id,
                            name: q.customer_display_name || 'Customer',
                          })}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <WhatsAppSendDialog
        key={waDialog ? `wa-q-${waDialog.id}` : 'wa-q-closed'}
        open={!!waDialog}
        onOpenChange={(o) => { if (!o) setWaDialog(null); }}
        kind="quotation"
        entityId={waDialog?.id}
        customerName={waDialog?.name}
        onAppSendSuccess={({ kind, entityId }) => {
          if (kind === 'quotation' && entityId) markQuotationWaSent(entityId);
        }}
      />
    </AppLayout>
  );
}
