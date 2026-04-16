import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { apiPath } from '@/lib/apiPrefix';
import api from '@/lib/api';

function formatPreviewErrorMessage(data, status) {
  if (!data || typeof data !== 'object') {
    return status ? `Preview failed (${status})` : 'Preview failed';
  }
  const details = data.details;
  if (Array.isArray(details) && details.length) {
    return details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ');
  }
  if (typeof data.details === 'string' && data.details) return data.details;
  return data.error || 'Preview failed';
}

export default function QuotationPreviewModal({
  open,
  onOpenChange,
  quotationId,
  getPreviewPayload,
  title = 'Quotation preview',
}) {
  const [iframeUrl, setIframeUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const blobRef = useRef(null);
  const getPayloadRef = useRef(getPreviewPayload);

  useLayoutEffect(() => {
    getPayloadRef.current = getPreviewPayload;
  });

  useEffect(() => {
    if (!open) {
      setIframeUrl('');
      return;
    }
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        let html;
        if (quotationId) {
          const url = apiPath(`/quotations/${quotationId}/preview-html`);
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          const text = await res.text();
          if (!res.ok) {
            let data;
            try {
              data = JSON.parse(text);
            } catch {
              data = { error: text.slice(0, 200) || `HTTP ${res.status}` };
            }
            if (alive) toast.error(formatPreviewErrorMessage(data, res.status));
            return;
          }
          html = text;
        } else if (getPayloadRef.current) {
          const payload = getPayloadRef.current();
          const res = await fetch(apiPath('/quotations/preview-html'), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });
          const text = await res.text();
          if (!res.ok) {
            let data;
            try {
              data = JSON.parse(text);
            } catch {
              data = { error: text.slice(0, 200) || `HTTP ${res.status}` };
            }
            if (alive) toast.error(formatPreviewErrorMessage(data, res.status));
            return;
          }
          html = text;
        } else {
          if (alive) setLoading(false);
          return;
        }
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const u = URL.createObjectURL(blob);
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        blobRef.current = u;
        setIframeUrl(u);
      } catch {
        if (alive) setIframeUrl('');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      setIframeUrl('');
    };
  }, [open, quotationId]);

  const downloadPdf = async () => {
    if (!quotationId) return;
    try {
      const response = await api.get(`/quotations/${quotationId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'quotation.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      /* interceptor */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full h-[min(90vh,800px)] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-4 pr-8">
            <DialogTitle>{title}</DialogTitle>
            {quotationId ? (
              <Button type="button" size="sm" variant="outline" onClick={downloadPdf}>
                <Download className="h-4 w-4 mr-2" /> Download PDF
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <div className="flex-1 relative min-h-[400px] bg-muted/30">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {iframeUrl ? (
            <iframe title="Quotation preview" src={iframeUrl} className="w-full h-full border-0 min-h-[400px]" />
          ) : !loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-6">
              Nothing to preview
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
