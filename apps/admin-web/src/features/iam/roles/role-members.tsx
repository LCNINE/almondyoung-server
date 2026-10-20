'use client';

import { toast } from 'sonner';
import { BlockedReason } from '@/components/auth/blocked-reason';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { lastPermanentHolder } from '@/lib/auth/role-editor';
import { useMe } from '@/lib/services/users';
import { useRemoveRoleMember, useRoleMembers } from '@/lib/services/roles';
import { ExpiryBadge } from '../components/expiry-badge';

const SELF = '자기 역할은 다른 관리자가 바꿔야 합니다.';
const LAST = '기간 없이 이 역할을 가진 사람이 한 명은 남아야 합니다.';

const kstDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

/** 이 역할을 가진 사람(기간이 지난 부여 포함). 회수는 행마다. */
export function RoleMembers({
  roleId,
  isSystem,
}: {
  roleId: string;
  isSystem: boolean;
}) {
  const { data, isLoading, isError } = useRoleMembers(roleId);
  const remove = useRemoveRoleMember(roleId);
  const { data: me } = useMe();
  if (isLoading) return <Spinner />;
  if (isError)
    return (
      <p className="py-4 text-sm text-destructive">
        소속 인원을 불러오지 못했습니다.
      </p>
    );
  const rows = data ?? [];
  const mustStay = isSystem ? lastPermanentHolder(rows) : null;
  if (rows.length === 0)
    return (
      <p className="py-4 text-sm text-muted-foreground">
        이 역할을 가진 사람이 없습니다.
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>이름</TableHead>
          <TableHead>아이디</TableHead>
          <TableHead>부여일</TableHead>
          <TableHead>종료일</TableHead>
          <TableHead>
            <span className="sr-only">동작</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => {
          const reason =
            me?.id === m.userId ? SELF : m.userId === mustStay ? LAST : null;
          return (
            <TableRow key={m.userId}>
              <TableCell>{m.username}</TableCell>
              <TableCell className="font-mono text-xs">{m.loginId}</TableCell>
              <TableCell>{kstDate(m.assignedAt)}</TableCell>
              <TableCell>
                {m.expiresAt ? (
                  <ExpiryBadge expiresAt={m.expiresAt} expired={m.expired} />
                ) : (
                  <span className="text-xs text-muted-foreground">무기한</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Can run={useRemoveRoleMember}>
                  <BlockedReason reason={reason}>
                    {(blocked) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        {...blocked}
                        onClick={
                          reason
                            ? undefined
                            : () =>
                                remove.mutate(m.userId, {
                                  onSuccess: () =>
                                    toast.success(
                                      `${m.username}님에게서 역할을 회수했습니다.`
                                    ),
                                  onError: (e) =>
                                    toast.error(
                                      e.message || '역할을 회수하지 못했습니다.'
                                    ),
                                })
                        }
                      >
                        회수
                      </Button>
                    )}
                  </BlockedReason>
                </Can>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
