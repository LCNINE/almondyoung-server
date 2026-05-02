'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { OAuthClientType } from '@/lib/api/domains/oauth-clients';
import { useCreateOAuthClient } from '@/lib/services/oauth-clients';
import { useState } from 'react';
import { toast } from 'sonner';
import { parseLines } from './utils';

export function CreateOAuthClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (clientId: string, clientSecret: string | null) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientType, setClientType] = useState<OAuthClientType>('confidential');
  const [redirectUrisText, setRedirectUrisText] = useState('');
  const [allowedScopesText, setAllowedScopesText] = useState('');
  const createMutation = useCreateOAuthClient();

  const reset = () => {
    setClientId('');
    setClientType('confidential');
    setRedirectUrisText('');
    setAllowedScopesText('');
  };

  const handleSubmit = async () => {
    const trimmedId = clientId.trim();
    const redirectUris = parseLines(redirectUrisText);
    const allowedScopes = parseLines(allowedScopesText);

    if (!trimmedId) {
      toast.error('clientId 를 입력하세요.');
      return;
    }
    if (redirectUris.length === 0) {
      toast.error('redirect URI 를 최소 1개 입력하세요.');
      return;
    }

    try {
      const res = await createMutation.mutateAsync({
        clientId: trimmedId,
        clientType,
        redirectUris,
        allowedScopes: allowedScopes.length ? allowedScopes : undefined,
      });
      reset();
      onOpenChange(false);
      onCreated(res.clientId, res.clientSecret);
      if (clientType === 'public') {
        toast.success('public client 를 생성했어요. (PKCE only — client_secret 없음)');
      }
    } catch {
      toast.error('OAuth client 생성에 실패했어요.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>OAuth client 생성</DialogTitle>
          <DialogDescription>생성 직후 1회에 한해 clientSecret 이 노출됩니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="oauth-client-id">clientId</Label>
            <Input
              id="oauth-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="daview"
            />
            <p className="text-xs text-muted-foreground">영숫자, _, -, : 만 허용 (최대 64자)</p>
          </div>
          <div className="space-y-2">
            <Label>client type</Label>
            <RadioGroup value={clientType} onValueChange={(v) => setClientType(v as OAuthClientType)}>
              <div className="flex items-start gap-2">
                <RadioGroupItem id="ct-confidential" value="confidential" className="mt-1" />
                <Label htmlFor="ct-confidential" className="font-normal">
                  <span className="font-mono text-xs">confidential</span> — server BFF/백엔드. client_secret 사용.
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem id="ct-public" value="public" className="mt-1" />
                <Label htmlFor="ct-public" className="font-normal">
                  <span className="font-mono text-xs">public</span> — SPA/모바일/RN. PKCE only, client_secret 없음.
                </Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="oauth-redirect-uris">redirect URIs</Label>
            <Textarea
              id="oauth-redirect-uris"
              value={redirectUrisText}
              onChange={(e) => setRedirectUrisText(e.target.value)}
              placeholder={'https://daview.com/auth/callback\nhttps://staging.daview.com/auth/callback'}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">한 줄에 하나씩 입력</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="oauth-scopes">allowed scopes (선택)</Label>
            <Textarea
              id="oauth-scopes"
              value={allowedScopesText}
              onChange={(e) => setAllowedScopesText(e.target.value)}
              placeholder={'profile\nemail'}
              rows={2}
            />
            <p className="text-xs text-muted-foreground">한 줄에 하나씩 입력. 비우면 제한 없음</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? '생성 중...' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
