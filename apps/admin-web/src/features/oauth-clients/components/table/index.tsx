'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OAuthClientResponse } from '@/lib/api/domains/oauth-clients';
import { MoreHorizontal } from 'lucide-react';

function formatDate(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR');
}

export type RowAction = 'edit' | 'rotate' | 'clear-previous' | 'deactivate';

export function OAuthClientsTable({
  clients,
  isLoading,
  onAction,
}: {
  clients: OAuthClientResponse[];
  isLoading: boolean;
  onAction: (action: RowAction, client: OAuthClientResponse) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>clientId</TableHead>
          <TableHead>상태</TableHead>
          <TableHead>redirect URIs</TableHead>
          <TableHead>scopes</TableHead>
          <TableHead>이전 secret</TableHead>
          <TableHead>secret 회전일</TableHead>
          <TableHead>생성일</TableHead>
          <TableHead className="w-[60px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
              불러오는 중...
            </TableCell>
          </TableRow>
        )}
        {!isLoading && clients.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
              등록된 OAuth client 가 없습니다.
            </TableCell>
          </TableRow>
        )}
        {clients.map((c) => (
          <TableRow key={c.clientId}>
            <TableCell className="font-mono text-xs">{c.clientId}</TableCell>
            <TableCell>
              {c.isActive ? (
                <Badge variant="default">활성</Badge>
              ) : (
                <Badge variant="secondary">비활성</Badge>
              )}
            </TableCell>
            <TableCell className="max-w-[280px]">
              <div className="space-y-1 text-xs">
                {c.redirectUris.map((uri) => (
                  <div key={uri} className="truncate font-mono" title={uri}>
                    {uri}
                  </div>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {(c.allowedScopes ?? []).length === 0 ? (
                  <span className="text-xs text-muted-foreground">제한 없음</span>
                ) : (
                  (c.allowedScopes ?? []).map((scope) => (
                    <Badge key={scope} variant="outline" className="font-mono text-[10px]">
                      {scope}
                    </Badge>
                  ))
                )}
              </div>
            </TableCell>
            <TableCell>
              {c.hasPreviousSecret ? (
                <Badge variant="outline">grace 진행중</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">없음</span>
              )}
            </TableCell>
            <TableCell className="text-xs">{formatDate(c.secretRotatedAt)}</TableCell>
            <TableCell className="text-xs">{formatDate(c.createdAt)}</TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onAction('edit', c)}>수정</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAction('rotate', c)}>secret 회전</DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!c.hasPreviousSecret}
                    onClick={() => onAction('clear-previous', c)}
                  >
                    grace 종료
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!c.isActive}
                    onClick={() => onAction('deactivate', c)}
                    className="text-destructive focus:text-destructive"
                  >
                    비활성화
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
