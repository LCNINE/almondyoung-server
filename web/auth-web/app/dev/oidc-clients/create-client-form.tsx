"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OAuthClientType, OAuthClientWithSecret } from "@/lib/user-service-admin";

import { createClientAction } from "./actions";

type Props = {
  onCreated: (client: OAuthClientWithSecret) => void;
};

function parseLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CreateClientForm({ onCreated }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientType, setClientType] = useState<OAuthClientType>("confidential");

  const onSubmit = (formData: FormData) => {
    setError(null);
    const clientId = (formData.get("clientId") as string)?.trim();
    const redirectUris = parseLines((formData.get("redirectUris") as string) ?? "");
    const postLogoutRedirectUris = parseLines(
      (formData.get("postLogoutRedirectUris") as string) ?? "",
    );
    const allowedScopes = parseLines((formData.get("allowedScopes") as string) ?? "");

    if (!clientId) {
      setError("client_id 는 필수입니다.");
      return;
    }
    if (redirectUris.length === 0) {
      setError("redirect_uri 가 최소 1개 필요합니다.");
      return;
    }

    startTransition(async () => {
      try {
        const created = await createClientAction({
          clientId,
          clientType,
          redirectUris,
          postLogoutRedirectUris: postLogoutRedirectUris.length > 0 ? postLogoutRedirectUris : undefined,
          allowedScopes: allowedScopes.length > 0 ? allowedScopes : undefined,
        });
        toast.success(`client_id "${created.clientId}" 등록 완료`);
        onCreated(created);
      } catch (err) {
        const message = err instanceof Error ? err.message : "등록 실패";
        setError(message);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>새 OIDC client 등록</CardTitle>
        <CardDescription>
          client_secret 은 등록 직후 1회만 표시됩니다. bcrypt hash 는 user-service 에 자동 저장됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="clientId">client_id</FieldLabel>
            <Input
              id="clientId"
              name="clientId"
              required
              maxLength={64}
              pattern="[A-Za-z0-9_\-:]+"
              placeholder="admin-web"
              autoComplete="off"
            />
            <FieldDescription>영숫자/_/-/: 만 허용. 예: admin-web, medusa-storefront.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="clientType">client type</FieldLabel>
            <Select
              value={clientType}
              onValueChange={(v) => setClientType(v as OAuthClientType)}
            >
              <SelectTrigger id="clientType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="confidential">confidential (server BFF, secret 사용)</SelectItem>
                <SelectItem value="public">public (SPA / 모바일, PKCE only)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="redirectUris">redirect_uris</FieldLabel>
            <Textarea
              id="redirectUris"
              name="redirectUris"
              required
              rows={3}
              placeholder={"https://admin.example.com/auth/callback\nhttp://localhost:3001/auth/callback"}
            />
            <FieldDescription>줄바꿈 또는 쉼표로 구분. 최소 1개 필수.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="postLogoutRedirectUris">post_logout_redirect_uris (선택)</FieldLabel>
            <Textarea
              id="postLogoutRedirectUris"
              name="postLogoutRedirectUris"
              rows={2}
              placeholder="https://admin.example.com/"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="allowedScopes">allowed_scopes (선택)</FieldLabel>
            <Textarea
              id="allowedScopes"
              name="allowedScopes"
              rows={2}
              placeholder="openid profile email"
            />
            <FieldDescription>비우면 server 측 기본 scope 가 사용됩니다.</FieldDescription>
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "등록 중..." : "등록"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
