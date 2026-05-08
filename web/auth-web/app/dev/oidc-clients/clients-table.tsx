"use client";

import { MoreHorizontal } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OAuthClient, OAuthClientWithSecret } from "@/lib/user-service-admin";

import {
  clearPreviousSecretAction,
  deactivateClientAction,
  rotateSecretAction,
  updateClientAction,
} from "./actions";

type Props = {
  clients: OAuthClient[];
  onEdit: (client: OAuthClient) => void;
  onSecretRevealed: (payload: OAuthClientWithSecret) => void;
};

export function ClientsTable({ clients, onEdit, onSecretRevealed }: Props) {
  if (clients.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        등록된 client 가 없습니다. 위 폼에서 첫 client 를 등록하세요.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>client_id</TableHead>
            <TableHead>type</TableHead>
            <TableHead>redirect_uris</TableHead>
            <TableHead>scopes</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => (
            <ClientRow
              key={c.clientId}
              client={c}
              onEdit={() => onEdit(c)}
              onSecretRevealed={onSecretRevealed}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ClientRow({
  client,
  onEdit,
  onSecretRevealed,
}: {
  client: OAuthClient;
  onEdit: () => void;
  onSecretRevealed: (payload: OAuthClientWithSecret) => void;
}) {
  const [pending, startTransition] = useTransition();

  const runRotate = () => {
    if (!confirm(`"${client.clientId}" 의 client_secret 을 회전하시겠습니까?`)) return;
    startTransition(async () => {
      try {
        const result = await rotateSecretAction(client.clientId);
        onSecretRevealed(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "회전 실패");
      }
    });
  };

  const runClearPrev = () => {
    if (!confirm(`"${client.clientId}" 의 이전 secret 을 폐기합니다. 진행할까요?`)) return;
    startTransition(async () => {
      try {
        await clearPreviousSecretAction(client.clientId);
        toast.success("이전 secret 폐기 완료");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "폐기 실패");
      }
    });
  };

  const runDeactivate = () => {
    if (!confirm(`"${client.clientId}" 를 비활성화합니다. 진행할까요?`)) return;
    startTransition(async () => {
      try {
        await deactivateClientAction(client.clientId);
        toast.success("비활성화 완료");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "비활성화 실패");
      }
    });
  };

  const runReactivate = () => {
    startTransition(async () => {
      try {
        await updateClientAction(client.clientId, { isActive: true });
        toast.success("재활성화 완료");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "재활성화 실패");
      }
    });
  };

  return (
    <TableRow className={!client.isActive ? "opacity-60" : undefined}>
      <TableCell className="font-mono text-sm">{client.clientId}</TableCell>
      <TableCell>
        <Badge variant={client.clientType === "public" ? "outline" : "secondary"}>
          {client.clientType}
        </Badge>
      </TableCell>
      <TableCell className="max-w-xs">
        <ul className="space-y-0.5 text-xs">
          {client.redirectUris.map((uri) => (
            <li key={uri} className="truncate font-mono" title={uri}>
              {uri}
            </li>
          ))}
        </ul>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {client.allowedScopes && client.allowedScopes.length > 0
          ? client.allowedScopes.join(" ")
          : "—"}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          {client.isActive ? (
            <Badge variant="secondary">active</Badge>
          ) : (
            <Badge variant="destructive">inactive</Badge>
          )}
          {client.hasPreviousSecret && (
            <Badge variant="outline" className="text-xs">
              prev secret
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={pending}>
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">액션</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>편집</DropdownMenuItem>
            {client.clientType === "confidential" && (
              <DropdownMenuItem onClick={runRotate}>secret 회전</DropdownMenuItem>
            )}
            {client.hasPreviousSecret && (
              <DropdownMenuItem onClick={runClearPrev}>이전 secret 폐기</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {client.isActive ? (
              <DropdownMenuItem variant="destructive" onClick={runDeactivate}>
                비활성화
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={runReactivate}>재활성화</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
