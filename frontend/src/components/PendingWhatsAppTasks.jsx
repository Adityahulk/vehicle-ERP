import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import useAuthStore from '@/store/authStore';
import { toast } from 'sonner';

const CAN_SEE = ['branch_manager', 'company_admin', 'super_admin'];

export default function PendingWhatsAppTasks() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canSee = CAN_SEE.includes(user?.role);

  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-pending-tasks'],
    queryFn: () => api.get('/whatsapp/pending-tasks').then((r) => r.data),
    enabled: !!canSee,
    refetchInterval: 120_000,
  });

  const completeMut = useMutation({
    mutationFn: (id) => api.post(`/whatsapp/pending-tasks/${id}/complete-reminder`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-pending-tasks'] });
      qc.invalidateQueries({ queryKey: ['branch-dashboard'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });

  const dismissMut = useMutation({
    mutationFn: (id) => api.post(`/whatsapp/pending-tasks/${id}/dismiss`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-pending-tasks'] });
    },
  });

  if (!canSee) return null;

  const tasks = data?.tasks || [];

  const openCompose = async (task) => {
    try {
      const { data: pre } = await api.get(
        `/whatsapp/preview-loan/${task.loan_id}?messageType=${encodeURIComponent(task.message_type)}`,
      );
      const url = pre?.whatsappUrl;
      if (!url) {
        toast.error('Could not build WhatsApp link — check template and customer phone');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      await completeMut.mutateAsync(task.id);
      toast.success('Task cleared — reminder recorded where applicable');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to open WhatsApp');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-[#25d366]" />
          WhatsApp follow-ups
          {tasks.length > 0 && (
            <Badge variant="secondary" className="ml-auto">{tasks.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No pending WhatsApp reminders</p>
        ) : (
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-lg border border-border bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.customer_name || 'Customer'}
                    {t.customer_phone ? ` · ${t.customer_phone}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 shrink-0">
                  <Button
                    size="sm"
                    className="bg-[#25d366] hover:bg-[#20bd5a] text-white"
                    disabled={completeMut.isPending || dismissMut.isPending}
                    onClick={() => openCompose(t)}
                  >
                    Open WhatsApp
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Dismiss without sending"
                    disabled={completeMut.isPending || dismissMut.isPending}
                    onClick={() => dismissMut.mutate(t.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
