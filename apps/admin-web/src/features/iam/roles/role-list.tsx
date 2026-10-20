'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { Can } from '@/components/auth/can';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
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
import { useAdminRoles, useCreateRole } from '@/lib/services/roles';
import type { RoleSummary } from '@/lib/types/dto/iam';
import { CreateRoleDialog } from './create-role-dialog';

function Rows({ onCopy }: { onCopy: (role: RoleSummary) => void }) {
  const { data } = useAdminRoles();
  const staff = data.filter((r) => r.audience === 'staff');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>역할</TableHead>
          <TableHead>설명</TableHead>
          <TableHead className="text-right">인원</TableHead>
          <TableHead className="text-right">권한</TableHead>
          <TableHead className="text-right">위험 권한</TableHead>
          <TableHead>
            <span className="sr-only">동작</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {staff.map((r) => (
          <TableRow key={r.roleId}>
            <TableCell>
              <Link
                href={`/users/roles/${r.roleId}`}
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                {r.isSystem && (
                  <Lock
                    className="size-3.5"
                    aria-label="시스템 역할(편집 불가)"
                  />
                )}
                {r.displayName}
              </Link>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {r.name}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {r.description ?? '—'}
            </TableCell>
            <TableCell className="text-right">{r.memberCount}</TableCell>
            <TableCell className="text-right">{r.permissionCount}</TableCell>
            <TableCell className="text-right">
              {r.dangerousCount > 0 ? (
                <Badge variant="destructive">{r.dangerousCount}</Badge>
              ) : (
                '0'
              )}
            </TableCell>
            <TableCell className="text-right">
              {!r.isSystem && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/users/roles/${r.roleId}`}>권한 편집</Link>
                </Button>
              )}
              <Can run={useCreateRole}>
                <Button size="sm" variant="ghost" onClick={() => onCopy(r)}>
                  복제
                </Button>
              </Can>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RoleList() {
  const [dialog, setDialog] = useState<{
    open: boolean;
    copyFrom: RoleSummary | null;
  }>({
    open: false,
    copyFrom: null,
  });
  return (
    <Container>
      <Header title="역할" />
      <Can run={useCreateRole}>
        <div className="flex justify-end p-2">
          <Button
            size="sm"
            onClick={() => setDialog({ open: true, copyFrom: null })}
          >
            새 역할
          </Button>
        </div>
      </Can>
      <Suspense
        fallback={
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        }
      >
        <Rows onCopy={(role) => setDialog({ open: true, copyFrom: role })} />
      </Suspense>
      <CreateRoleDialog
        open={dialog.open}
        copyFrom={dialog.copyFrom}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </Container>
  );
}
