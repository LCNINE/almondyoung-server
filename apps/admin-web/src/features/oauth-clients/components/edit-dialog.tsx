'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { OAuthClientResponse } from '@/lib/api/domains/oauth-clients';
import { useUpdateOAuthClient } from '@/lib/services/oauth-clients';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { parseLines } from './utils';

export function EditOAuthClientDialog({
  client,
  open,
  onOpenChange,
}: {
  client: OAuthClientResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [redirectUrisText, setRedirectUrisText] = useState('');
  const [allowedScopesText, setAllowedScopesText] = useState('');
  const [isActive, setIsActive] = useState(true);
  const updateMutation = useUpdateOAuthClient();

  useEffect(() => {
    if (!client) return;
    setRedirectUrisText(client.redirectUris.join('\n'));
    setAllowedScopesText((client.allowedScopes ?? []).join('\n'));
    setIsActive(client.isActive);
  }, [client]);

  const handleSubmit = async () => {
    if (!client) return;
    const redirectUris = parseLines(redirectUrisText);
    const allowedScopes = parseLines(allowedScopesText);

    if (redirectUris.length === 0) {
      toast.error('redirect URI 를 최소 1개 입력하세요.');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        clientId: client.clientId,
        dto: {
          redirectUris,
          allowedScopes,
          isActive,
        },
      });
      toast.success('OAuth client 수정 완료');
      onOpenChange(false);
    } catch {
      toast.error('OAuth client 수정에 실패했어요.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>OAuth client 수정 — {client?.clientId}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-redirect-uris">redirect URIs</Label>
            <Textarea
              id="edit-redirect-uris"
              value={redirectUrisText}
              onChange={(e) => setRedirectUrisText(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">한 줄에 하나씩 입력</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-scopes">allowed scopes</Label>
            <Textarea
              id="edit-scopes"
              value={allowedScopesText}
              onChange={(e) => setAllowedScopesText(e.target.value)}
              rows={2}
            />
            <p className="text-xs text-muted-foreground">한 줄에 하나씩 입력. 모두 비우면 제한 없음</p>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-is-active">활성화</Label>
            <Switch id="edit-is-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updateMutation.isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
