'use client';

import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { EventFailureService } from '@/lib/api/domains/events';
import {
  useDiscardOutbox,
  useEventFailureSummary,
  useOutboxFailureDetail,
  useOutboxFailures,
  useResendAllOutbox,
  useResendOutbox,
} from '@/lib/services/events';
import {
  dwellSince,
  errorMessageOf,
  errorOneLine,
  loadErrorText,
  resendAllConfirmText,
  resendAllResultText,
  resendResultText,
  statusLabel,
} from '../display';
import { ConfirmAllDialog } from './confirm-all-dialog';
import { DiscardDialog, type DiscardTarget } from './discard-dialog';
import { ActionLog, ErrorBlock, Fields, JsonBlock } from './detail-parts';

interface SectionProps {
  service: EventFailureService;
  now: Date;
}

export function OutboxSection({ service, now }: SectionProps) {
  const list = useOutboxFailures(service);
  const summary = useEventFailureSummary(service);
  const resend = useResendOutbox(service);
  const discard = useDiscardOutbox(service);
  const resendAll = useResendAllOutbox(service);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const onResend = (id: number) =>
    resend.mutate(id, {
      onSuccess: (r) => {
        if (r.status === 'PUBLISHED') toast.success(resendResultText(r));
        else toast.error(resendResultText(r));
      },
      onError: (e) => toast.error(errorMessageOf(e)),
    });

  const onDiscard = (reason: string) => {
    if (!discardTarget) return;
    discard.mutate(
      { id: discardTarget.id, reason },
      {
        onSuccess: () => {
          setDiscardTarget(null);
          toast.success('종결');
        },
        onError: (e) => toast.error(errorMessageOf(e)),
      }
    );
  };

  const onResendAll = () =>
    resendAll.mutate(undefined, {
      onSuccess: (r) => {
        if (r.failed.length > 0) toast.error(resendAllResultText(r));
        else toast.success(resendAllResultText(r));
      },
      onError: (e) => toast.error(errorMessageOf(e)),
    });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">보내다 실패</h2>
        {items.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={resendAll.isPending}
            onClick={() => setConfirmAll(true)}
          >
            전체 다시 보내기
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
              <th>뒤 대기</th>
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
                  <td className="truncate py-1.5" title={item.topic}>
                    {item.eventType}
                  </td>
                  <td className="truncate font-mono text-xs">{item.aggregateId}</td>
                  <td>{dwellSince(item.failedAt ?? item.createdAt, now)}</td>
                  <td className="truncate" title={item.errorMessage ?? undefined}>
                    {errorOneLine(null, item.errorMessage)}
                  </td>
                  <td>{item.waitingBehind > 0 ? item.waitingBehind : ''}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resend.isPending && resend.variables === item.id}
                      onClick={() => onResend(item.id)}
                    >
                      다시 보내기
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDiscardTarget({
                          id: item.id,
                          label: `${item.eventType} · ${item.aggregateId}`,
                          behind: item.waitingBehind,
                        })
                      }
                    >
                      종결
                    </Button>
                  </td>
                </tr>
                {expanded === item.id && (
                  <tr>
                    <td colSpan={6} className="pb-3">
                      <OutboxDetailView service={service} id={item.id} />
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
        title="전체 다시 보내기"
        description={resendAllConfirmText(summary.data)}
        pending={resendAll.isPending}
        onOpenChange={setConfirmAll}
        onConfirm={onResendAll}
      />
    </section>
  );
}

function OutboxDetailView({ service, id }: { service: EventFailureService; id: number }) {
  const detail = useOutboxFailureDetail(service, id);
  if (detail.isError) return <p className="text-sm text-red-600">{loadErrorText(detail.error)}</p>;
  if (!detail.data) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  const d = detail.data;

  return (
    <div className="flex flex-col gap-3 rounded bg-muted/30 p-3">
      <Fields
        rows={[
          ['토픽', d.topic],
          ['상태', statusLabel(d.status)],
          ['적재', new Date(d.createdAt).toLocaleString('ko-KR')],
          ['재시도', d.retryCount],
        ]}
      />
      {d.errorMessage && <ErrorBlock text={d.errorMessage} />}
      <JsonBlock value={d.payload} />
      <ActionLog kind="outbox" actions={d.actions} />
    </div>
  );
}
