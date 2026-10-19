'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { PermissionReadOnly } from '@/components/auth/permission-read-only';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  buildGrid,
  iamErrorCode,
  summarize,
  toggle,
  toggleDomainReads,
} from '@/lib/auth/role-editor';
import { useReplaceRolePermissions, useRoleDetail } from '@/lib/services/roles';
import { IAM_ERROR_CODES } from '@/lib/types/dto/iam';
import { ChangeSummaryDialog } from './change-summary-dialog';
import { DeleteRoleButton } from './delete-role-button';
import { MenuPreview } from './menu-preview';
import { PermissionGrid } from './permission-grid';
import { RoleMembers } from './role-members';
import { RoleSettings } from './role-settings';

/** 역할 하나의 권한·설정·소속 인원. 권한은 체크 상태 전체를 버전과 함께 저장한다. */
export function RoleEditor({ roleId }: { roleId: string }) {
  const { data: role, isLoading, isError, refetch } = useRoleDetail(roleId);
  const replace = useReplaceRolePermissions(roleId);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [stale, setStale] = useState<{
    added: string[];
    removed: string[];
  } | null>(null);

  // 저장 기준 = 활성 권한 + 아직 가진 폐기 권한(폐기 권한은 끄지 않는 한 그대로 남는다).
  // 권한 «내용»이 바뀔 때만 다시 맞춘다 — 설정 저장·인원 회수로 상세를 다시 읽어도 편집 중인 체크가 남게.
  const savedKey = [
    ...(role?.permissions ?? []),
    ...(role?.deprecatedPermissions ?? []),
  ]
    .sort()
    .join('\n');
  const saved = useMemo(
    () => new Set(savedKey === '' ? [] : savedKey.split('\n')),
    [savedKey]
  );
  useEffect(() => setDraft(new Set(saved)), [saved]);
  const domains = useMemo(
    () => buildGrid(role?.deprecatedPermissions ?? []),
    [role]
  );
  const summary = useMemo(() => summarize(saved, draft), [saved, draft]);
  const dirty = summary.added.length + summary.removed.length > 0;

  if (isLoading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  if (isError || !role)
    return (
      <p className="p-6 text-sm text-destructive">
        역할을 불러오지 못했습니다.
      </p>
    );
  const readOnly = role.isSystem || role.audience === 'customer';

  const save = () =>
    replace.mutate(
      { permissions: [...draft], version: role.version },
      {
        onSuccess: () => {
          setConfirming(false);
          setStale(null);
          toast.success('권한을 저장했습니다.');
        },
        onError: async (e) => {
          setConfirming(false);
          if (iamErrorCode(e) === IAM_ERROR_CODES.versionStale) {
            // 내 변경을 버리지 않는다 — 최신을 불러온 «뒤에» 바꾸려던 차이를 다시 적용할 수 있게 남긴다
            // (먼저 남기면 최신이 오기 전에 옛 기준 위로 다시 적용될 수 있다).
            const mine = {
              added: [...summary.added],
              removed: [...summary.removed],
            };
            await refetch();
            setStale(mine);
            return;
          }
          toast.error(e.message || '권한을 저장하지 못했습니다.');
        },
      }
    );

  const reapply = () => {
    if (!stale) return;
    let next = new Set(saved);
    for (const k of stale.added) next = toggle(next, k, true);
    for (const k of stale.removed) next = toggle(next, k, false);
    setDraft(next);
    setStale(null);
  };

  return (
    <Container>
      <Header title={role.displayName} />
      <p className="px-3 text-sm text-muted-foreground">
        <span className="font-mono">{role.name}</span> · 권한{' '}
        {role.permissionCount}(위험 {role.dangerousCount}) · 인원{' '}
        {role.memberCount} ·{' '}
        <Link
          href={`/users/audit-log?roleId=${role.roleId}`}
          className="underline"
        >
          이 역할의 변경 이력
        </Link>
      </p>
      {readOnly && (
        <Alert className="m-3 w-auto">
          <AlertTitle>{role.isSystem ? '시스템 역할' : '고객 역할'}</AlertTitle>
          <AlertDescription>
            {role.isSystem
              ? '모든 권한을 계산해서 받습니다. 편집하거나 지울 수 없습니다.'
              : '고객 역할은 이 화면에서 편집하거나 지우지 않습니다.'}
          </AlertDescription>
        </Alert>
      )}
      {stale && (
        <Alert variant="destructive" className="m-3 w-auto">
          <AlertTitle>다른 사람이 먼저 이 역할을 바꿨습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            최신 권한을 불러왔습니다. 내가 바꾸려던{' '}
            {stale.added.length + stale.removed.length}건을 다시 적용할 수
            있습니다.
            <Button size="sm" variant="outline" onClick={reapply}>
              내 변경 다시 적용
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="permissions" className="p-3">
        <TabsList>
          <TabsTrigger value="permissions">권한</TabsTrigger>
          <TabsTrigger value="settings">설정</TabsTrigger>
          <TabsTrigger value="members">소속 인원</TabsTrigger>
        </TabsList>
        <TabsContent value="permissions">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              placeholder="권한 이름·키 검색"
              aria-label="권한 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs"
            />
            {!readOnly && (
              <Can run={useReplaceRolePermissions}>
                <Button
                  variant="outline"
                  disabled={!dirty}
                  onClick={() => setDraft(new Set(saved))}
                >
                  되돌리기
                </Button>
                <Button disabled={!dirty} onClick={() => setConfirming(true)}>
                  저장
                  {dirty
                    ? ` (+${summary.added.length} −${summary.removed.length})`
                    : ''}
                </Button>
              </Can>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[160px_1fr_260px]">
            <nav aria-label="영역" className="hidden lg:block">
              <ul className="sticky top-2 space-y-1 text-sm">
                {domains.map((d) => {
                  const keys = d.rows
                    .flatMap((r) => [...Object.values(r.cells), ...r.special])
                    .map((c) => c?.key);
                  const on = keys.filter(
                    (k) => k !== undefined && draft.has(k)
                  ).length;
                  return (
                    <li key={d.domain}>
                      <a href={`#perm-${d.domain}`} className="hover:underline">
                        {d.title}
                      </a>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {on}/{keys.length}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <PermissionReadOnly run={useReplaceRolePermissions}>
              <PermissionGrid
                domains={domains}
                held={draft}
                readOnly={readOnly}
                query={query}
                onToggle={(key, on) => setDraft((d) => toggle(d, key, on))}
                onToggleDomainReads={(domain, on) =>
                  setDraft((d) => toggleDomainReads(d, domain, on))
                }
              />
            </PermissionReadOnly>
            <div className="lg:sticky lg:top-2 lg:self-start">
              <MenuPreview held={draft} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="settings">
          <RoleSettings key={role.version} role={role} />
        </TabsContent>
        <TabsContent value="members">
          <RoleMembers roleId={role.roleId} isSystem={role.isSystem} />
        </TabsContent>
      </Tabs>
      {!readOnly && (
        <div className="flex justify-end p-3">
          <DeleteRoleButton role={role} />
        </div>
      )}
      <ChangeSummaryDialog
        open={confirming}
        summary={summary}
        pending={replace.isPending}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Container>
  );
}
