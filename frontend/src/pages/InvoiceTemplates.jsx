import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { apiPath } from '@/lib/apiPrefix';
import { toast } from 'sonner';
import {
  Loader2, Star, Pencil, Eye,
} from 'lucide-react';

const DEFAULT_LAYOUT = {
  show_logo: true,
  show_signature: true,
  show_qr_code: false,
  show_bank_details: false,
  show_terms: true,
  terms_text: 'Goods once sold will not be taken back or exchanged. Subject to local jurisdiction.',
  primary_color: '#1a56db',
  font: 'default',
  header_style: 'left-aligned',
  show_vehicle_details_block: true,
  show_loan_summary: false,
  footer_text: '',
  bank_details: '',
  seller_name_override: '',
  seller_address_override: '',
  seller_phone_override: '',
  seller_email_override: '',
  seller_gstin_override: '',
  logo_asset: 'company_upload',
  signature_asset: 'company_upload',
  signatory_title: 'Authorised Signatory',
  original_copy_label: 'ORIGINAL FOR RECIPIENT',
  ship_to_same_as_billing: true,
  computer_gen_subnote: 'E. & O. E.',
  show_company_email: false,
};

function normalizeBankDetailsStored(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\r\n/g, '\n').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
}

/** First line = account / legal name; rest = bank rows (matches common trade PDF layout). */
function splitBankDetailsLines(stored) {
  const raw = normalizeBankDetailsStored(typeof stored === 'string' ? stored : '');
  const i = raw.indexOf('\n');
  if (i === -1) return { headline: '', accountsBlock: raw };
  return { headline: raw.slice(0, i), accountsBlock: raw.slice(i + 1).replace(/^\n+/, '') };
}

function joinBankDetailsLines(headline, accountsBlock) {
  const h = (headline || '').replace(/\r\n/g, '\n').trimEnd();
  const a = (accountsBlock || '').replace(/\r\n/g, '\n');
  if (h && a) return `${h}\n${a}`;
  if (h) return h;
  return a;
}

function mergeLayout(row) {
  const lc = row?.layout_config && typeof row.layout_config === 'object' ? row.layout_config : {};
  const merged = { ...DEFAULT_LAYOUT, ...lc };
  merged.bank_details = normalizeBankDetailsStored(merged.bank_details || '');
  return merged;
}

function BankDetailsEditor({ layoutForm, setLayoutForm }) {
  const { headline, accountsBlock } = splitBankDetailsLines(layoutForm.bank_details || '');
  return (
    <div className="space-y-4 rounded-lg border-2 border-primary/25 bg-background p-4 shadow-sm ring-1 ring-border">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Bank details on PDF</h4>
        <p className="text-xs text-muted-foreground mt-1">
          Everything below is editable. Turn on the switch, change the text, then click Save at the bottom of this panel. This text is stored only on this template (not in company settings).
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border border-input bg-muted/30 px-3 py-2">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={!!layoutForm.show_bank_details}
          onChange={(e) => setLayoutForm((p) => ({ ...p, show_bank_details: e.target.checked }))}
        />
        <span>Show bank details block on invoices that use this template</span>
      </label>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="bank_headline" className="text-xs font-medium">
            Account / legal name (first line, e.g. as on cheque)
          </Label>
          <Input
            id="bank_headline"
            className="bg-background font-medium"
            placeholder="e.g. MAVIDYA GROUP PVT. LTD."
            value={headline}
            onChange={(e) => setLayoutForm((p) => {
              const { accountsBlock: ac } = splitBankDetailsLines(p.bank_details || '');
              return { ...p, bank_details: joinBankDetailsLines(e.target.value, ac) };
            })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank_accounts" className="text-xs font-medium">
            Bank accounts, IFSC, branch (one line per bank or use line breaks)
          </Label>
          <Textarea
            id="bank_accounts"
            rows={8}
            className="min-h-[168px] resize-y bg-background font-mono text-sm leading-relaxed"
            placeholder={'SBI A/C NO. … | IFSC … | Branch: …\nRBL A/C No. … | IFSC … | Branch: …\n\nTrade layout: put a line containing only --- between left and right columns.'}
            value={accountsBlock}
            onChange={(e) => setLayoutForm((p) => {
              const { headline: h } = splitBankDetailsLines(p.bank_details || '');
              return { ...p, bank_details: joinBankDetailsLines(h, e.target.value) };
            })}
          />
        </div>
      </div>
    </div>
  );
}

function TemplateThumbnail({ templateId, refreshKey }) {
  const [src, setSrc] = useState('');
  const blobRef = useRef(null);

  useEffect(() => {
    if (!templateId) return undefined;
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    let alive = true;
    (async () => {
      try {
        const token = localStorage.getItem('access_token');
        const bust = encodeURIComponent(String(refreshKey ?? ''));
        const url = `${apiPath('/invoices/preview-template')}?templateId=${encodeURIComponent(templateId)}&_rev=${bust}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const html = await res.text();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const u = URL.createObjectURL(blob);
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        blobRef.current = u;
        setSrc(u);
      } catch {
        if (alive) setSrc('');
      }
    })();
    return () => {
      alive = false;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      setSrc('');
    };
  }, [templateId, refreshKey]);

  if (!src) {
    return (
      <div className="w-full h-36 rounded-md border bg-muted/40 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <iframe
      title="Template preview"
      src={src}
      className="w-full h-40 rounded-md border bg-white pointer-events-none"
    />
  );
}

async function openPreviewTemplateInTab(templateId) {
  const token = localStorage.getItem('access_token');
  const url = `${apiPath('/invoices/preview-template')}?templateId=${encodeURIComponent(templateId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const html = await res.text();
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const u = URL.createObjectURL(blob);
  window.open(u, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(u), 120_000);
}

export default function InvoiceTemplates() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [layoutForm, setLayoutForm] = useState(DEFAULT_LAYOUT);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['invoice-templates'],
    queryFn: () => api.get('/invoice-templates').then((r) => r.data.templates),
  });

  const { data: company, dataUpdatedAt: companyQueryTs } = useQuery({
    queryKey: ['company', user?.company_id],
    queryFn: () => api.get(`/companies/${user.company_id}`).then((r) => r.data.company),
    enabled: !!user?.company_id,
  });

  const openEdit = (t) => {
    setEditing(t);
    setLayoutForm(mergeLayout(t));
  };

  const setDefMut = useMutation({
    mutationFn: (id) => api.post(`/invoice-templates/${id}/set-default`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice-templates'] });
      toast.success('Default template updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, layout_config }) => api.patch(`/invoice-templates/${id}`, { layout_config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice-templates'] });
      toast.success('Template saved');
      setEditing(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const logoMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('logo', file);
      return api.post(`/companies/${user.company_id}/logo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      toast.success('Logo uploaded');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  const sigMut = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('signature', file);
      return api.post(`/companies/${user.company_id}/signature`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      toast.success('Signature uploaded');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  const toggle = (key) => (e) => {
    setLayoutForm((p) => ({ ...p, [key]: e.target.checked }));
  };

  const onLogoPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      toast.error('Logo must be 2MB or smaller');
      return;
    }
    if (!/\.(png|jpe?g|svg)$/i.test(f.name)) {
      toast.error('Use PNG, JPG, or SVG');
      return;
    }
    logoMut.mutate(f);
    e.target.value = '';
  };

  const onSigPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) {
      toast.error('Signature must be 1MB or smaller');
      return;
    }
    if (!/\.(png|jpe?g)$/i.test(f.name)) {
      toast.error('Use PNG or JPG');
      return;
    }
    sigMut.mutate(f);
    e.target.value = '';
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold">Invoice templates</h3>
        <p className="text-sm text-muted-foreground">
          Choose a default layout, upload branding, and customize what appears on PDF invoices.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((t) => (
          <Card key={t.id} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    {t.name}
                    {t.is_default && (
                      <Badge variant="secondary" className="font-normal">Default</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">{t.template_key}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-hidden rounded-md border bg-muted/20">
                <TemplateThumbnail
                  templateId={t.id}
                  refreshKey={`${t.updated_at || ''}|${companyQueryTs || 0}`}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {!t.is_default && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDefMut.mutate(t.id)}
                    disabled={setDefMut.isPending}
                  >
                    <Star className="h-3.5 w-3.5 mr-1" />
                    Set as default
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={() => openEdit(t)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    openPreviewTemplateInTab(t.id).catch(() => toast.error('Preview failed'));
                  }}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  Preview
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Sheet open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <SheetContent className="sm:max-w-xl w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit template</SheetTitle>
            <SheetDescription>
              {editing?.name} — changes apply to PDFs using this template.
            </SheetDescription>
          </SheetHeader>

          {editing && (
            <div className="space-y-6 mt-4">
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Branding</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Logo</Label>
                    {company?.logo_url && (
                      <img
                        src={`${company.logo_url}${company.logo_url.includes('?') ? '&' : '?'}v=${companyQueryTs || 0}`}
                        alt="Logo"
                        className="h-14 object-contain border rounded p-1 bg-white"
                      />
                    )}
                    <Input type="file" accept=".png,.jpg,.jpeg,.svg" onChange={onLogoPick} disabled={logoMut.isPending} />
                    <p className="text-xs text-muted-foreground">PNG, JPG, or SVG — max 2MB</p>
                    <div className="space-y-1.5 pt-1">
                      <Label className="text-xs">Logo on invoice / PDF</Label>
                      <Select
                        value={layoutForm.logo_asset || 'company_upload'}
                        onChange={(e) => setLayoutForm((p) => ({ ...p, logo_asset: e.target.value }))}
                      >
                        <option value="company_upload">Company upload (file above)</option>
                        <option value="mvg_group">Default app logo (same as website header /assets/app-logo.svg)</option>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Signature</Label>
                    {company?.signature_url && (
                      <img
                        src={`${company.signature_url}${company.signature_url.includes('?') ? '&' : '?'}v=${companyQueryTs || 0}`}
                        alt="Signature"
                        className="h-14 object-contain border rounded p-1 bg-white"
                      />
                    )}
                    <Input type="file" accept=".png,.jpg,.jpeg" onChange={onSigPick} disabled={sigMut.isPending} />
                    <p className="text-xs text-muted-foreground">PNG or JPG — max 1MB (transparent PNG recommended)</p>
                    <div className="space-y-1.5 pt-1">
                      <Label className="text-xs">Signature image source</Label>
                      <Select
                        value={layoutForm.signature_asset || 'company_upload'}
                        onChange={(e) => setLayoutForm((p) => ({ ...p, signature_asset: e.target.value }))}
                      >
                        <option value="company_upload">Company upload (file above)</option>
                        <option value="mavidya_director">Preset: Mavidya — Director (round stamp)</option>
                        <option value="rudra_proprietor">Preset: Rudra Green Legender — Proprietor</option>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Presets use scanned signatories from your GST pack. Uploaded file is ignored when a preset is selected.
                        Invoice PDFs from Sales follow the template marked Default (or the template you pick on download) — edit that row’s signature source if PDFs still show a preset.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Signatory title (printed under signature)</Label>
                      <Input
                        value={layoutForm.signatory_title || ''}
                        onChange={(e) => setLayoutForm((p) => ({ ...p, signatory_title: e.target.value }))}
                        placeholder="Authorised Signatory"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="primary_color">Primary color</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      id="primary_color"
                      type="color"
                      className="w-14 h-9 p-1 cursor-pointer"
                      value={layoutForm.primary_color || '#1a56db'}
                      onChange={(e) => setLayoutForm((p) => ({ ...p, primary_color: e.target.value }))}
                    />
                    <Input
                      className="font-mono flex-1"
                      value={layoutForm.primary_color || ''}
                      onChange={(e) => setLayoutForm((p) => ({ ...p, primary_color: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <BankDetailsEditor layoutForm={layoutForm} setLayoutForm={setLayoutForm} />

              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <h4 className="text-sm font-medium">Seller on invoice (letterhead)</h4>
                <p className="text-xs text-muted-foreground">
                  Optional. Leave fields blank to use your company profile (Settings → company). What you enter here is saved only on this template and appears on PDFs that use it.
                </p>
                <div className="space-y-2">
                  <Label className="text-xs">Legal / trade name</Label>
                  <Input
                    value={layoutForm.seller_name_override || ''}
                    onChange={(e) => setLayoutForm((p) => ({ ...p, seller_name_override: e.target.value }))}
                    placeholder="Blank = company name from profile"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Registered address</Label>
                  <Textarea
                    rows={4}
                    value={layoutForm.seller_address_override || ''}
                    onChange={(e) => setLayoutForm((p) => ({ ...p, seller_address_override: e.target.value }))}
                    placeholder="Blank = address from company profile"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Phone</Label>
                    <Input
                      value={layoutForm.seller_phone_override || ''}
                      onChange={(e) => setLayoutForm((p) => ({ ...p, seller_phone_override: e.target.value }))}
                      placeholder="Blank = profile phone"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Email</Label>
                    <Input
                      value={layoutForm.seller_email_override || ''}
                      onChange={(e) => setLayoutForm((p) => ({ ...p, seller_email_override: e.target.value }))}
                      placeholder="Blank = profile email"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">GSTIN</Label>
                  <Input
                    value={layoutForm.seller_gstin_override || ''}
                    onChange={(e) => setLayoutForm((p) => ({ ...p, seller_gstin_override: e.target.value }))}
                    placeholder="Blank = profile GSTIN"
                    className="font-mono"
                  />
                </div>
                {editing?.template_key === 'trade' && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!layoutForm.show_company_email}
                      onChange={(e) => setLayoutForm((p) => ({ ...p, show_company_email: e.target.checked }))}
                    />
                    <span>Show email next to phone (trade header)</span>
                  </label>
                )}
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">Layout</h4>
                <div className="space-y-2 text-sm">
                  {[
                    ['show_logo', 'Show company logo on invoice'],
                    ['show_signature', 'Show digital signature'],
                    ['show_vehicle_details_block', 'Show vehicle details block'],
                    ['show_terms', 'Show terms & conditions'],
                    ['show_loan_summary', 'Show loan summary'],
                    ['ship_to_same_as_billing', 'Ship-to same as bill-to (trade layout)'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!layoutForm[key]} onChange={toggle(key)} />
                      <span>{label}</span>
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-muted-foreground cursor-not-allowed">
                    <input type="checkbox" checked={false} disabled />
                    <span>Show QR code (coming soon)</span>
                  </label>
                </div>
                <div className="space-y-2">
                  <Label>Header style</Label>
                  <Select
                    value={layoutForm.header_style || 'left-aligned'}
                    onChange={(e) => setLayoutForm((p) => ({ ...p, header_style: e.target.value }))}
                  >
                    <option value="centered">Centered</option>
                    <option value="left-aligned">Left-aligned</option>
                    <option value="two-column">Two-column</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">Text</h4>
                <div className="space-y-2">
                  <Label>Terms & conditions</Label>
                  <Textarea
                    rows={4}
                    value={layoutForm.terms_text || ''}
                    onChange={(e) => setLayoutForm((p) => ({ ...p, terms_text: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Footer text</Label>
                  <Input
                    value={layoutForm.footer_text || ''}
                    onChange={(e) => setLayoutForm((p) => ({ ...p, footer_text: e.target.value }))}
                  />
                </div>
                {editing?.template_key === 'trade' && (
                  <>
                    <div className="space-y-2">
                      <Label>Copy label (top-right ribbon)</Label>
                      <Input
                        value={layoutForm.original_copy_label || ''}
                        onChange={(e) => setLayoutForm((p) => ({ ...p, original_copy_label: e.target.value }))}
                        placeholder="ORIGINAL FOR RECIPIENT"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Computer-generated note (footer)</Label>
                      <Input
                        value={layoutForm.computer_gen_subnote || ''}
                        onChange={(e) => setLayoutForm((p) => ({ ...p, computer_gen_subnote: e.target.value }))}
                        placeholder="E. & O. E."
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openPreviewTemplateInTab(editing.id).catch(() => toast.error('Preview failed'))}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Preview (new tab)
                </Button>
                <Button
                  type="button"
                  onClick={() => patchMut.mutate({
                    id: editing.id,
                    layout_config: {
                      ...DEFAULT_LAYOUT,
                      ...layoutForm,
                      show_qr_code: false,
                    },
                  })}
                  disabled={patchMut.isPending}
                >
                  {patchMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
