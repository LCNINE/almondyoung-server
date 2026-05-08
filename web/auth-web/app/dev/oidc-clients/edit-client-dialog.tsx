"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { OAuthClient } from "@/lib/user-service-admin";

import { updateClientAction } from "./actions";

type Props = {
  client: OAuthClient | null;
  onClose: () => void;
};

function joinLines(values: string[] | null | undefined): string {
  return (values ?? []).join("\n");
}

function parseLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EditClientDialog({ client, onClose }: Props) {
  if (!client) return null;
  // 호출부에서 client.clientId 를 key 로 전달하여, 다른 client 선택 시 컴포넌트가
  // 통째로 remount 되며 아래 state 들이 새 props 기준으로 재초기화된다.
  return <EditDialogInner client={client} onClose={onClose} />;
}

function EditDialogInner({ client, onClose }: { client: OAuthClient; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(client.isActive);
  const [redirectUris, setRedirectUris] = useState(joinLines(client.redirectUris));
  const [postLogoutRedirectUris, setPostLogoutRedirectUris] = useState(
    joinLines(client.postLogoutRedirectUris),
  );
  const [allowedScopes, setAllowedScopes] = useState(joinLines(client.allowedScopes));

  const onSubmit = () => {
    setError(null);
    const nextRedirect = parseLines(redirectUris);
    if (nextRedirect.length === 0) {
      setError("redirect_uri 가 최소 1개 필요합니다.");
      return;
    }

    startTransition(async () => {
      try {
        await updateClientAction(client.clientId, {
          redirectUris: nextRedirect,
          postLogoutRedirectUris: parseLines(postLogoutRedirectUris),
          allowedScopes: parseLines(allowedScopes),
          isActive,
        });
        toast.success(`"${client.clientId}" 업데이트 완료`);
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : "업데이트 실패";
        setError(message);
      }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>OIDC client 수정</DialogTitle>
          <DialogDescription>
            <code className="font-mono">{client.clientId}</code> ({client.clientType})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="edit-redirectUris">redirect_uris</FieldLabel>
            <Textarea
              id="edit-redirectUris"
              rows={3}
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
            />
            <FieldDescription>줄바꿈 또는 쉼표로 구분.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-postLogout">post_logout_redirect_uris</FieldLabel>
            <Textarea
              id="edit-postLogout"
              rows={2}
              value={postLogoutRedirectUris}
              onChange={(e) => setPostLogoutRedirectUris(e.target.value)}
            />
            <FieldDescription>비우면 null 로 저장됩니다.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-scopes">allowed_scopes</FieldLabel>
            <Textarea
              id="edit-scopes"
              rows={2}
              value={allowedScopes}
              onChange={(e) => setAllowedScopes(e.target.value)}
            />
            <FieldDescription>비우면 null 로 저장 (server 기본 scope 적용).</FieldDescription>
          </Field>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">활성화</div>
              <p className="text-xs text-muted-foreground">
                비활성화하면 코드/토큰 발급이 거부됩니다.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
