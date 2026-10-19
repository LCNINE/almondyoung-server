'use client';

import { Suspense, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { PermissionReadOnly } from '@/components/auth/permission-read-only';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ExpiryBadge } from '@/features/iam/components/expiry-badge';
import { EffectivePermissions } from '@/features/iam/staff/effective-permissions';
import { useAdminRoles } from '@/lib/services/roles';
import {
  useMe,
  useReplaceStaffRoles,
  useUserRoles,
} from '@/lib/services/users';

const SELF = '자기 역할은 다른 관리자가 바꿔야 합니다.';
/** 서버 시각(UTC) → 한국 날짜(YYYY-MM-DD) — 종료일 입력란의 값 */
const kstDay = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
        new Date(iso)
      )
    : '';

function StaffRoleEditor({ userId }: { userId: string }) {
  const { data: userRoles } = useUserRoles(userId);
  const { data: allRoles } = useAdminRoles();
  const { data: me } = useMe();
  const save = useReplaceStaffRoles(userId);
  const self = me?.id === userId;

  const staffRoles = allRoles.filter((r) => r.audience === 'staff');
  const customer = userRoles.roles.filter((r) => r.audience === 'customer');
  const held = useMemo(
    () =>
      new Map(
        userRoles.roles
          .filter((r) => r.audience === 'staff')
          .map((r) => [r.roleId, r])
      ),
    [userRoles.roles]
  );
  // 만료된 부여는 꺼진 채로 시작한다 — 다시 켜면 새 종료일로 다시 준다.
  const initial = useMemo(
    () =>
      new Map(
        [...held.values()]
          .filter((r) => !r.expired)
          .map((r) => [r.roleId, kstDay(r.expiresAt)])
      ),
    [held]
  );
  const [draft, setDraft] = useState<Map<string, string>>(initial);
  const changed =
    draft.size !== initial.size ||
    [...draft.entries()].some(
      ([roleId, until]) => initial.get(roleId) !== until
    );

  const submit = () =>
    save.mutate(
      [...draft.entries()].map(([roleId, until]) => ({
        roleId,
        expiresAt: until === '' ? null : until,
      })),
      {
        onSuccess: () => toast.success('역할을 저장했습니다.'),
        onError: (e) => toast.error(e.message || '역할을 저장하지 못했습니다.'),
      }
    );

  return (
    <div className="space-y-3 p-3">
      {self && (
        <p role="note" className="rounded border bg-muted/50 p-2 text-sm">
          {SELF}
        </p>
      )}
      {customer.length > 0 && (
        <p className="text-sm text-muted-foreground">
          고객 역할: {customer.map((r) => r.displayName).join(', ')} (이
          화면에서 바꾸지 않습니다)
        </p>
      )}
      <PermissionReadOnly run={useReplaceStaffRoles}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">부여</span>
              </TableHead>
              <TableHead>역할</TableHead>
              <TableHead>종료일(비우면 무기한)</TableHead>
              <TableHead>지금</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staffRoles.map((role) => {
              const on = draft.has(role.roleId);
              const current = held.get(role.roleId);
              return (
                <TableRow key={role.roleId}>
                  <TableCell>
                    <Checkbox
                      checked={on}
                      aria-label={`${role.displayName} 부여`}
                      aria-disabled={self || undefined}
                      aria-description={self ? SELF : undefined}
                      onCheckedChange={
                        self
                          ? undefined
                          : (v) =>
                              setDraft((d) => {
                                const next = new Map(d);
                                if (v === true) next.set(role.roleId, '');
                                else next.delete(role.roleId);
                                return next;
                              })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{role.displayName}</span>
                    {role.description && (
                      <span className="block text-xs text-muted-foreground">
                        {role.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      aria-label={`${role.displayName} 종료일`}
                      value={draft.get(role.roleId) ?? ''}
                      readOnly={!on || self}
                      onChange={(e) =>
                        setDraft((d) =>
                          new Map(d).set(role.roleId, e.target.value)
                        )
                      }
                      className="w-40"
                    />
                  </TableCell>
                  <TableCell>
                    {current ? (
                      current.expiresAt ? (
                        <ExpiryBadge
                          expiresAt={current.expiresAt}
                          expired={current.expired}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          무기한
                        </span>
                      )
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </PermissionReadOnly>
      {!self && (
        <Can run={useReplaceStaffRoles}>
          <div className="flex justify-end">
            <Button onClick={submit} disabled={!changed || save.isPending}>
              {save.isPending ? '저장 중…' : '저장'}
            </Button>
          </div>
        </Can>
      )}
      <EffectivePermissions assignments={userRoles.roles} />
    </div>
  );
}

export function UserDetailRole({ userId }: { userId: string }) {
  return (
    <Container className="divide-y">
      <Header title="역할과 권한" />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <StaffRoleEditor userId={userId} />
      </Suspense>
    </Container>
  );
}
