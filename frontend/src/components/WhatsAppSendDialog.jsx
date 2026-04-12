import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Check } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

function waMeUrl(phone10, text) {
  const d = String(phone10 || '').replace(/\D/g, '');
  const n = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 10 ? d : '';
  if (!n) return '#';
  return `https://wa.me/91${n}?text=${encodeURIComponent(text)}`;
}

function previewLines(text, maxLines = 3) {
  if (!text) return '';
  const lines = text.split('\n').filter(Boolean);
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join('\n')}\n…`;
}

function digitsFromCustomerPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('91') && d.length === 12) d = d.slice(2);
  return d.length === 10 ? d : '';
}

export default function WhatsAppSendDialog({
  open,
  onOpenChange,
  kind,
  entityId,
  customerName,
  onAppSendSuccess,
}) {
  const qc = useQueryClient();
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [editFull, setEditFull] = useState(false);
  const [editedBody, setEditedBody] = useState('');
  const [justSent, setJustSent] = useState(false);

  const previewPath =
    kind === 'invoice'
      ? `/whatsapp/preview-invoice/${entityId}`
      : kind === 'loan'
        ? `/whatsapp/preview-loan/${entityId}`
        : `/whatsapp/preview-quotation/${entityId}`;

  const { data: pre, isLoading: preLoad } = useQuery({
    queryKey: ['whatsapp-preview', kind, entityId],
    queryFn: () => api.get(previewPath).then((r) => r.data),
    enabled: open && !!entityId && !!kind,
  });

  const derivedPhone = useMemo(
    () => digitsFromCustomerPhone(pre?.customer_phone),
    [pre?.customer_phone],
  );
  const phone = phoneTouched ? phoneDigits : derivedPhone;
  const templateBody = pre?.previewMessage || '';

  const sendMut = useMutation({
    mutationFn: (body) => {
      let url = `/whatsapp/send-quotation/${entityId}`;
      if (kind === 'invoice') url = `/whatsapp/send-invoice/${entityId}`;
      if (kind === 'loan') url = `/whatsapp/send-loan-reminder/${entityId}`;
      const ph = phoneTouched ? phoneDigits : derivedPhone;
      return api.post(url, { ...body, phone: ph ? `+91${ph}` : undefined });
    },
    onSuccess: () => {
      toast.success('WhatsApp sent');
      setJustSent(true);
      if (kind === 'invoice') {
        qc.invalidateQueries({ queryKey: ['whatsapp-logs-invoice', entityId] });
      }
      onAppSendSuccess?.({ kind, entityId });
      setTimeout(() => setJustSent(false), 3000);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Send failed'),
  });

  const displayPreview = editFull ? editedBody : templateBody;
  const waLinkText = editFull ? editedBody : templateBody;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send to {customerName || pre?.customer_name || 'Customer'}</DialogTitle>
          <DialogDescription>
            WhatsApp message using your company template. Uses Twilio when configured, or mock in dev.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Phone (+91)</Label>
            <Input
              value={phone}
              onChange={(e) => {
                setPhoneTouched(true);
                setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 10));
              }}
              placeholder="10-digit mobile"
              maxLength={10}
            />
          </div>
          {preLoad ? (
            <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="space-y-1">
                <Label>Message preview</Label>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap rounded-md border bg-muted/40 p-2 max-h-28 overflow-y-auto">
                  {editFull ? null : previewLines(templateBody)}
                </p>
                {!editFull && (
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() => {
                      setEditedBody(templateBody);
                      setEditFull(true);
                    }}
                  >
                    Edit message
                  </button>
                )}
                {editFull && (
                  <Textarea
                    value={editedBody}
                    onChange={(e) => setEditedBody(e.target.value)}
                    rows={10}
                    className="text-sm font-mono"
                  />
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={!phone || phone.length !== 10}
            onClick={() => {
              window.open(waMeUrl(phone, waLinkText), '_blank', 'noopener,noreferrer');
            }}
          >
            Open WhatsApp
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto bg-[#25d366] hover:bg-[#20bd5a] text-white"
            disabled={sendMut.isPending || !phone || phone.length !== 10 || !displayPreview.trim()}
            onClick={() => sendMut.mutate({ message: editFull ? editedBody : undefined })}
          >
            {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : justSent ? <Check className="h-4 w-4" /> : null}
            Send via app
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatSentAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function WhatsAppIconButton({ onClick, title, lastSentAt, flashCheck }) {
  const tip = lastSentAt
    ? `Sent ${formatSentAgo(lastSentAt)}`
    : title || 'Send via WhatsApp';
  return (
    <button
      type="button"
      title={tip}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-[#25d366]"
    >
      {flashCheck ? (
        <Check className="h-7 w-7 text-[#25d366]" strokeWidth={2.5} aria-hidden />
      ) : (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
      )}
    </button>
  );
}
