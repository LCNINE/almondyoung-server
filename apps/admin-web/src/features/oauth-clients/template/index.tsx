'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { OAuthClientResponse } from '@/lib/api/domains/oauth-clients';
import {
  useClearOAuthClientPreviousSecret,
  useDeactivateOAuthClient,
  useOAuthClients,
  useRotateOAuthClientSecret,
} from '@/lib/services/oauth-clients';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CreateOAuthClientDialog } from '../components/create-dialog';
import { EditOAuthClientDialog } from '../components/edit-dialog';
import { SecretDisplayDialog } from '../components/secret-dialog';
import { OAuthClientsTable, RowAction } from '../components/table';

type ConfirmKind = 'rotate' | 'clear-previous' | 'deactivate';

const CONFIRM_COPY: Record<ConfirmKind, { title: string; description: string; action: string }> = {
  rotate: {
    title: 'clientSecret 회전',
    description:
      '새 secret 을 발급합니다. 이전 secret 은 grace 기간 동안 함께 유효합니다. 발급 직후 1회에 한해 평문이 노출됩니다.',
    action: '회전',
  },
  'clear-previous': {
    title: 'grace 종료',
    description: '이전 secret 을 즉시 무효화합니다. 이전 secret 으로 인증 중인 클라이언트가 있다면 즉시 실패합니다.',
    action: '종료',
  },
  deactivate: {
    title: 'OAuth client 비활성화',
    description: '이 client 의 OAuth 인증을 즉시 차단합니다. (soft) — 추후 다시 활성화할 수 있습니다.',
    action: '비활성화',
  },
};

export default function OAuthClientsTemplate() {
  const { data, isLoading } = useOAuthClients();
  const clients = useMemo(() => data ?? [], [data]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OAuthClientResponse | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; client: OAuthClientResponse } | null>(null);

  const [issuedSecret, setIssuedSecret] = useState<{ clientId: string; clientSecret: string | null } | null>(null);

  const rotateMutation = useRotateOAuthClientSecret();
  const clearPrevMutation = useClearOAuthClientPreviousSecret();
  const deactivateMutation = useDeactivateOAuthClient();

  const handleAction = (action: RowAction, client: OAuthClientResponse) => {
    if (action === 'edit') {
      setEditTarget(client);
      return;
    }
    setConfirm({ kind: action, client });
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    const { kind, client } = confirm;
    try {
      if (kind === 'rotate') {
        const res = await rotateMutation.mutateAsync(client.clientId);
        setIssuedSecret({ clientId: res.clientId, clientSecret: res.clientSecret });
      } else if (kind === 'clear-previous') {
        await clearPrevMutation.mutateAsync(client.clientId);
        toast.success('이전 secret 을 무효화했어요.');
      } else if (kind === 'deactivate') {
        await deactivateMutation.mutateAsync(client.clientId);
        toast.success('OAuth client 를 비활성화했어요.');
      }
      setConfirm(null);
    } catch {
      toast.error('요청에 실패했어요.');
    }
  };

  const confirmCopy = confirm ? CONFIRM_COPY[confirm.kind] : null;
  const confirmPending =
    rotateMutation.isPending || clearPrevMutation.isPending || deactivateMutation.isPending;

  return (
    <Container className="divide-y-0">
      <Header
        title="OAuth 클라이언트"
        subtitle="외부/내부 서비스가 user-service 의 OAuth 로 인증할 때 사용하는 client 자격증명을 관리합니다."
        right={<Button onClick={() => setCreateOpen(true)}>새 client</Button>}
      />
      <OAuthClientsTable clients={clients} isLoading={isLoading} onAction={handleAction} />

      <CreateOAuthClientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(clientId, clientSecret) => {
          if (clientSecret) setIssuedSecret({ clientId, clientSecret });
        }}
      />

      <EditOAuthClientDialog
        client={editTarget}
        open={!!editTarget}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      />

      <SecretDisplayDialog
        clientId={issuedSecret?.clientId ?? null}
        clientSecret={issuedSecret?.clientSecret ?? null}
        onClose={() => setIssuedSecret(null)}
      />

      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmCopy?.title} {confirm ? `— ${confirm.client.clientId}` : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmPending}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={confirmPending}>
              {confirmPending ? '처리 중...' : confirmCopy?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}
