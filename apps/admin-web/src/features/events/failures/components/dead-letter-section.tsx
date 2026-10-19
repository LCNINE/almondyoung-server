'use client';

import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { usePermissionCheck } from '@/hooks/use-permission';
import type { DeadLetterSequenceItem, EventFailureService } from '@/lib/api/domains/events';
import {
  useDeadLetterDetail,
  useDeadLetterSequences,
  useDiscardDeadLetter,
  useEventFailureSummary,
  useRedriveAllDeadLetters,
  useRedriveDeadLetter,
} from '@/lib/services/events';
import {
  actionErrorText,
  discardResultText,
  dwellSince,
  errorOneLine,
  isStopped,
  isUnresolved,
  loadErrorText,
  redriveAllConfirmText,
  redriveAllResultText,
  redriveResultText,
  statusLabel,
  stopDetail,
} from '../display';
import { ConfirmAllDialog } from './confirm-all-dialog';
import { DiscardDialog, type DiscardTarget } from './discard-dialog';
import { ActionLog, ErrorBlock, Fields, JsonBlock } from './detail-parts';

interface SectionProps {
  service: EventFailureService;
  now: Date;
}

function labelOf(eventType: string | null, sequenceKey: string | null): string {
  return `${eventType ?? '(해석 불가)'} · ${sequenceKey ?? '-'}`;
}

export function DeadLetterSection({ service, now }: SectionProps) {
  const list = useDeadLetterSequences(service);
  const summary = useEventFailureSummary(service);
  const redrive = useRedriveDeadLetter(service);
  const discard = useDiscardDeadLetter(service);
  const redriveAll = useRedriveAllDeadLetters(service);
  // 다시 넣기·종결은 같은 권한이다 — 없으면 버튼을 그리지 않는다(조회는 그대로)
  const canAct = usePermissionCheck().canRun(useRedriveDeadLetter);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  // 결과 토스트는 mutate() 콜백이 아니라 mutateAsync 의 promise 에 건다. mutate() 쪽 콜백은 다음 호출이나
  // 언마운트(탭 이동)로 observer 가 떨어지면 불리지 않아, 멈춘 결과가 조용히 사라진다.
  const onRedrive = (id: number) =>
    redrive.mutateAsync(id).then(
      (r) => {
        if (isStopped(r)) toast.error(redriveResultText(r), { description: stopDetail(r) });
        else toast.success(redriveResultText(r));
      },
      (e) => toast.error(actionErrorText(e))
    );

  const onDiscard = (reason: string) => {
    if (!discardTarget) return;
    discard.mutateAsync({ id: discardTarget.id, reason }).then(
      (r) => {
        setDiscardTarget(null);
        if (isStopped(r)) toast.error(discardResultText(r), { description: stopDetail(r) });
        else toast.success(discardResultText(r));
      },
      (e) => toast.error(actionErrorText(e))
    );
  };

  const onRedriveAll = () =>
    redriveAll.mutateAsync().then(
      (r) => {
        if (r.stopped > 0) toast.error(redriveAllResultText(r));
        else toast.success(redriveAllResultText(r));
      },
      (e) => toast.error(actionErrorText(e))
    );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">받다 실패</h2>
        {items.length > 0 && canAct && (
          <Button
            size="sm"
            variant="outline"
            disabled={redriveAll.isPending}
            onClick={() => setConfirmAll(true)}
          >
            전체 다시 넣기
          </Button>
        )}
      </div>

      {list.isError ? (
        <p className="text-sm text-red-600">{loadErrorText(list.error)}</p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">실패 없음</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-48" />
            <col className="w-56" />
            <col className="w-24" />
            <col />
            <col className="w-16" />
            <col className="w-44" />
          </colgroup>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">이벤트</th>
              <th>순서 키</th>
              <th>체류</th>
              <th>오류</th>
              <th>뒤 보류</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr
                  className="cursor-pointer border-t hover:bg-muted/40"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <td className="truncate py-1.5" title={`${item.topic} · ${item.handler}`}>
                    {item.eventType ?? '(해석 불가)'}
                  </td>
                  <td className="truncate font-mono text-xs">{item.sequenceKey ?? '-'}</td>
                  <td>{dwellSince(item.firstFailedAt, now)}</td>
                  <td className="truncate" title={item.errorMessage ?? undefined}>
                    {errorOneLine(item.errorName, item.errorMessage)}
                  </td>
                  <td>{item.heldBehind > 0 ? item.heldBehind : ''}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {canAct && (
                      <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={redrive.isPending}
                      onClick={() => onRedrive(item.id)}
                    >
                      다시 넣기
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDiscardTarget({
                          id: item.id,
                          label: labelOf(item.eventType, item.sequenceKey),
                          behind: item.heldBehind,
                        })
                      }
                    >
                      종결
                    </Button>
                      </>
                    )}
                  </td>
                </tr>
                {expanded === item.id && (
                  <tr>
                    <td colSpan={6} className="pb-3">
                      <DeadLetterDetailView
                        service={service}
                        head={item}
                        now={now}
                        onDiscard={setDiscardTarget}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {list.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          disabled={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          더 보기
        </Button>
      )}

      <DiscardDialog
        target={discardTarget}
        pending={discard.isPending}
        onClose={() => setDiscardTarget(null)}
        onSubmit={onDiscard}
      />
      <ConfirmAllDialog
        open={confirmAll}
        title="전체 다시 넣기"
        description={redriveAllConfirmText(summary.data)}
        pending={redriveAll.isPending}
        onOpenChange={setConfirmAll}
        onConfirm={onRedriveAll}
      />
    </section>
  );
}

function DeadLetterDetailView({
  service,
  head,
  now,
  onDiscard,
}: {
  service: EventFailureService;
  head: DeadLetterSequenceItem;
  now: Date;
  onDiscard: (target: DiscardTarget) => void;
}) {
  const detail = useDeadLetterDetail(service, head.id);
  if (detail.isError) return <p className="text-sm text-red-600">{loadErrorText(detail.error)}</p>;
  if (!detail.data) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  const { row, sequence, actions } = detail.data;

  return (
    <div className="flex flex-col gap-3 rounded bg-muted/30 p-3">
      <Fields
        rows={[
          ['토픽', row.topic],
          ['핸들러', row.handler],
          ['메시지', row.messageId],
          ['위치', `${row.kafkaPartition}:${row.kafkaOffset}`],
          ['다시 넣은 횟수', row.redriveCount],
        ]}
      />
      {(row.errorName || row.errorMessage) && (
        <ErrorBlock text={[row.errorName, row.errorMessage].filter(Boolean).join(': ')} />
      )}
      {sequence.length > 1 && (
        <ul className="text-xs">
          {sequence.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-0.5">
              <span className="w-12 text-muted-foreground">#{r.id}</span>
              <span className="w-40 truncate">{r.eventType ?? '(해석 불가)'}</span>
              <span className="w-16">{statusLabel(r.status)}</span>
              <span className="w-20">{dwellSince(r.firstFailedAt, now)}</span>
              {/* 머리는 목록 행의 버튼으로 종결한다. 머리 아닌 행 종결은 아무것도 흐르게 하지 않는다(스펙 §7.5) */}
              {isUnresolved(r.status) && r.id !== head.id && (
                <Can run={useDiscardDeadLetter}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6"
                  onClick={() =>
                    onDiscard({ id: r.id, label: labelOf(r.eventType, r.sequenceKey), behind: 0 })
                  }
                >
                  종결
                </Button>
                </Can>
              )}
            </li>
          ))}
        </ul>
      )}
      <JsonBlock value={row.envelope} />
      <ActionLog kind="dead_letter" actions={actions} />
    </div>
  );
}
