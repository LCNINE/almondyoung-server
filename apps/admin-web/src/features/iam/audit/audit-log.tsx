'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useMemo, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIamAuditLogs } from '@/lib/services/iam';
import {
  IAM_AUDIT_ACTIONS,
  type IamAuditAction,
  type IamAuditFilter,
  type IamAuditTargetType,
} from '@/lib/types/dto/iam';
import { describeAudit } from './audit-format';

const ALL = '__all__';
const ACTION_LABELS: Record<IamAuditAction, string> = {
  'role.create': '역할 만듦',
  'role.update': '역할 정보 변경',
  'role.delete': '역할 삭제',
  'role.permissions.replace': '권한 변경',
  'user.roles.replace': '역할 변경',
  'role.members.add': '역할 추가',
  'role.member.remove': '역할 회수',
  'admin_user.create': '관리자 계정 생성',
  'pii_access_log.view': '개인정보 접속기록 조회',
  'user.platform_operator.set': '플랫폼 운영자 변경',
  'tenant.create': '테넌트 만듦',
  'tenant.status.set': '테넌트 상태 변경',
  'tenant.delete': '테넌트 삭제',
  'tenant.membership.add': '테넌트 소속 추가',
  'tenant.oauth_redirects.add': '테넌트 로그인 주소 등록',
  'user.password.reissue': '비밀번호 재발급',
};
const TARGET_LABELS: Partial<Record<IamAuditTargetType, string>> = {
  role: '역할',
  tenant: '테넌트',
  oauth_client: 'OAuth 클라이언트',
};
const isAction = (v: string | null): v is IamAuditAction =>
  IAM_AUDIT_ACTIONS.some((a) => a === v);
const kst = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'short',
  timeStyle: 'medium',
});
/** 화면의 날짜(한국)를 서버 경계(UTC)로 — 시작은 그날 0시, 끝은 다음날 0시(제외). */
// 한국 시각은 서머타임이 없어 +09:00 고정이다.
const dayStart = (day: string) =>
  new Date(`${day}T00:00:00+09:00`).toISOString();
const nextDayStart = (day: string) =>
  new Date(
    new Date(`${day}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000
  ).toISOString();
const LINE_CLASS = {
  added: 'text-emerald-700',
  removed: 'text-destructive',
  changed: 'text-foreground',
} as const;
const LINE_MARK = { added: '+', removed: '−', changed: '~' } as const;

export function AuditLog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const action = params.get('action');
  const filter = useMemo((): IamAuditFilter => {
    const f: IamAuditFilter = {};
    if (from) f.from = dayStart(from);
    if (to) f.to = nextDayStart(to);
    if (isAction(action)) f.action = action;
    const roleId = params.get('roleId');
    const actorUserId = params.get('actorUserId');
    const targetId = params.get('targetId');
    if (roleId) f.roleId = roleId;
    if (actorUserId) f.actorUserId = actorUserId;
    if (targetId) f.targetId = targetId;
    return f;
  }, [params, from, to, action]);
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useIamAuditLogs(filter);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const narrowed = ['roleId', 'actorUserId', 'targetId'].filter((k) =>
    params.get(k)
  );
  const rows = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Container>
      <Header title="권한 변경 이력" />
      <div className="flex flex-wrap items-end gap-3 p-3">
        <div className="space-y-1">
          <Label htmlFor="audit-from">시작일</Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => set('from', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">종료일</Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-action">동작</Label>
          <Select
            value={isAction(action) ? action : ALL}
            onValueChange={(v) => set('action', v === ALL ? null : v)}
          >
            <SelectTrigger id="audit-action" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체</SelectItem>
              {IAM_AUDIT_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {ACTION_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {narrowed.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => narrowed.forEach((k) => set(k, null))}
          >
            대상·행위자 거르기 해제
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 p-6 text-sm text-destructive">
          이력을 불러오지 못했습니다.
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          조건에 맞는 변경 이력이 없습니다.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>일시</TableHead>
              <TableHead>누가</TableHead>
              <TableHead>대상</TableHead>
              <TableHead>무엇</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((log) => {
              const d = describeAudit(log);
              const open = expanded === log.id;
              return (
                <Fragment key={log.id}>
                  <TableRow>
                    <TableCell className="whitespace-nowrap">
                      {kst.format(new Date(log.occurredAt))}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="font-mono text-xs underline-offset-2 hover:underline"
                        onClick={() => set('actorUserId', log.actorUserId)}
                        title="이 사람이 한 변경만 보기"
                      >
                        {log.actorLoginId ?? log.actorUserId}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="mr-1">
                        {TARGET_LABELS[log.targetType] ?? '사람'}
                      </Badge>
                      <button
                        type="button"
                        className="underline-offset-2 hover:underline"
                        onClick={() =>
                          set(
                            log.targetType === 'role' ? 'roleId' : 'targetId',
                            log.targetId
                          )
                        }
                        title="이 대상의 변경만 보기"
                      >
                        {log.targetLabel}
                      </button>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-expanded={open}
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => setExpanded(open ? null : log.id)}
                      >
                        {d.title.split(' — ')[1] ?? d.title}
                        {d.lines.length > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({d.lines.length})
                          </span>
                        )}
                      </button>
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow>
                      <TableCell colSpan={4} className="bg-muted/40">
                        <ul className="space-y-0.5 text-sm">
                          {d.lines.map((line, i) => (
                            <li key={i} className={LINE_CLASS[line.kind]}>
                              {LINE_MARK[line.kind]} {line.text}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs text-muted-foreground">
                          IP: {log.ip ?? '기록 안 됨'} · 요청 ID:{' '}
                          {log.requestId ?? '없음'} · 브라우저:{' '}
                          {log.userAgent ?? '없음'}
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
      {hasNextPage && (
        <div className="flex justify-center p-3">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
          </Button>
        </div>
      )}
    </Container>
  );
}
