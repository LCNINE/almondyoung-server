'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useCreatePiiAccessReview,
  usePiiAccessLogs,
  usePiiAccessReviews,
  usePiiAccessSummary,
} from '@/lib/services/iam';
import type { PiiAccessAction, PiiAccessFilter } from '@/lib/types/dto/iam';
import { describeSubjects, isAfterHours, monthRange, PII_ACTION_LABELS } from './pii-access-format';

const ALL = '__all__';
const ACTIONS: readonly PiiAccessAction[] = ['view', 'reveal', 'export'];
const isAction = (v: string | null): v is PiiAccessAction => ACTIONS.some((a) => a === v);
const kst = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' });
const kstDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const dayStart = (day: string) => new Date(`${day}T00:00:00+09:00`).toISOString();
const nextDayStart = (day: string) =>
  new Date(new Date(`${day}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();

/** 개인정보 접속기록 — 누가·언제·어디서·누구의 무엇을. 원문 값은 기록에 없다. */
export function PiiAccessLog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = kstDay.format(new Date());
  const [reviewNote, setReviewNote] = useState('');

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const action = params.get('action');
  const filter = useMemo((): PiiAccessFilter => {
    const f: PiiAccessFilter = {};
    if (from) f.from = dayStart(from);
    if (to) f.to = nextDayStart(to);
    if (isAction(action)) f.action = action;
    const actorUserId = params.get('actorUserId');
    const subjectType = params.get('subjectType');
    const subjectId = params.get('subjectId');
    if (actorUserId) f.actorUserId = actorUserId;
    if (subjectType && subjectId) {
      f.subjectType = subjectType;
      f.subjectId = subjectId;
    }
    return f;
  }, [params, from, to, action]);

  const month = monthRange(from || today);
  const logs = usePiiAccessLogs(filter);
  const summary = usePiiAccessSummary(month.from, month.to);
  const reviews = usePiiAccessReviews();
  const createReview = useCreatePiiAccessReview();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const rows = logs.data?.pages.flatMap((p) => p.items) ?? [];
  const reviewed = (reviews.data ?? []).find((r) => r.period === month.period);

  return (
    <Container>
      <Header title="개인정보 접속기록" />
      <section aria-label={`${month.period} 점검`} className="space-y-2 border-b p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{month.period} 점검</span>
          {reviewed ? (
            <Badge variant="outline">
              점검 완료 · {reviewed.reviewedByLoginId ?? reviewed.reviewedBy} ·{' '}
              {kst.format(new Date(reviewed.reviewedAt))}
            </Badge>
          ) : (
            <Badge variant="secondary">점검 기록 없음</Badge>
          )}
        </div>
        {summary.isLoading ? (
          <Spinner />
        ) : summary.isError ? (
          <p className="text-sm text-destructive">행위자별 건수를 불러오지 못했습니다.</p>
        ) : (summary.data?.actors.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">이 달의 접속기록이 없습니다.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>누가</TableHead>
                <TableHead className="text-right">접속</TableHead>
                <TableHead className="text-right">대상 수</TableHead>
                <TableHead className="text-right">내려받기</TableHead>
                <TableHead className="text-right">업무시간 외(09~19시 밖)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.data?.actors.map((a) => (
                <TableRow key={a.actorUserId}>
                  <TableCell>
                    <button type="button" className="font-mono text-xs hover:underline" onClick={() => set('actorUserId', a.actorUserId)}>
                      {a.actorLoginId ?? a.actorUserId}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">{a.accessCount.toLocaleString('ko-KR')}</TableCell>
                  <TableCell className="text-right">{a.subjectTotal.toLocaleString('ko-KR')}</TableCell>
                  <TableCell className="text-right">{a.exportCount.toLocaleString('ko-KR')}</TableCell>
                  <TableCell className={a.afterHoursCount > 0 ? 'text-right font-semibold text-amber-700' : 'text-right'}>
                    {a.afterHoursCount.toLocaleString('ko-KR')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Can run={useCreatePiiAccessReview}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="pii-review-note">점검 메모</Label>
              <Input id="pii-review-note" className="w-80" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={createReview.isPending}
              onClick={() =>
                createReview.mutate(
                  { period: month.period, rangeFrom: month.from, rangeTo: month.to, ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}) },
                  {
                    onSuccess: () => {
                      setReviewNote('');
                      toast.success(`${month.period} 점검을 남겼습니다.`);
                    },
                  },
                )
              }
            >
              {month.period} 점검 완료
            </Button>
          </div>
        </Can>
      </section>

      <div className="flex flex-wrap items-end gap-3 p-3">
        <div className="space-y-1">
          <Label htmlFor="pii-from">시작일</Label>
          <Input id="pii-from" type="date" value={from} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pii-to">종료일</Label>
          <Input id="pii-to" type="date" value={to} onChange={(e) => set('to', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pii-action">수행업무</Label>
          <Select value={isAction(action) ? action : ALL} onValueChange={(v) => set('action', v === ALL ? null : v)}>
            <SelectTrigger id="pii-action" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {PII_ACTION_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(params.get('actorUserId') || params.get('subjectId')) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              set('actorUserId', null);
              set('subjectType', null);
              set('subjectId', null);
            }}
          >
            행위자·대상 거르기 해제
          </Button>
        )}
      </div>

      {logs.isLoading ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : logs.isError ? (
        <div className="flex items-center gap-2 p-6 text-sm text-destructive">
          접속기록을 불러오지 못했습니다.
          <Button size="sm" variant="outline" onClick={() => logs.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">조건에 맞는 접속기록이 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>일시</TableHead>
              <TableHead>누가</TableHead>
              <TableHead>수행업무</TableHead>
              <TableHead>대상</TableHead>
              <TableHead>항목</TableHead>
              <TableHead>화면·경로</TableHead>
              <TableHead>접속지</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap">
                  {kst.format(new Date(log.occurredAt))}
                  {isAfterHours(log.occurredAt) && (
                    <Badge variant="outline" className="ml-1 border-amber-500 text-amber-700">
                      업무시간 외
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <button type="button" className="font-mono text-xs hover:underline" onClick={() => set('actorUserId', log.actorUserId)}>
                    {log.actorLoginId ?? log.actorUserId}
                  </button>
                </TableCell>
                <TableCell>
                  {PII_ACTION_LABELS[log.action]}
                  {log.reason && <p className="text-xs text-muted-foreground">사유: {log.reason}</p>}
                </TableCell>
                <TableCell className="max-w-72">
                  {log.subjects[0] ? (
                    <button
                      type="button"
                      className="text-left text-xs hover:underline"
                      onClick={() => {
                        set('subjectType', log.subjects[0].type);
                        set('subjectId', log.subjects[0].id);
                      }}
                    >
                      {describeSubjects(log.subjects, log.subjectCount)}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{describeSubjects(log.subjects, log.subjectCount)}</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{log.kinds.join(', ')}</TableCell>
                <TableCell className="font-mono text-xs">
                  {log.sourceService} {log.method} {log.route}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {log.claimedIp ?? '기록 안 됨'}
                  {log.peerIp && log.peerIp !== log.claimedIp && (
                    <span className="block text-muted-foreground">연결 {log.peerIp}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {logs.hasNextPage && (
        <div className="flex justify-center p-3">
          <Button variant="outline" size="sm" disabled={logs.isFetchingNextPage} onClick={() => logs.fetchNextPage()}>
            더 보기
          </Button>
        </div>
      )}
    </Container>
  );
}
