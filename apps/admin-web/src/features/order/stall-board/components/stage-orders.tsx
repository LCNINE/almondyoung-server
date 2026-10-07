'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useOrderProgressOrders } from '@/lib/services/orders/queries';
import {
  useResendCancelRequest,
  useWithdrawCancelRequest,
} from '@/lib/services/orders/mutations';
import {
  BOARD_STAGES,
  BoardStageKey,
  StageSummary,
  formatDwell,
  gaveUpBadge,
  stateLabel,
} from '@/lib/api/domains/orders/order-progress.shape';
import { cn } from '@/lib/utils/ui';

/** 아래 목록 — 세부 상태 칩, 갇힘만, 채널, 정렬. 체류 긴 순이 기본(스펙 D7). 행은 주문내역 지목 검색으로 간다. */
export function StageOrders(props: {
  stage: Exclude<BoardStageKey, 'collect'>;
  summary: StageSummary | undefined;
  now: Date;
}) {
  const [state, setState] = useState('');
  const [stuck, setStuck] = useState(false);
  const [channel, setChannel] = useState('');
  const [sort, setSort] = useState<'dwell' | 'ordered'>('dwell');
  const isCancelRequest = props.stage === 'cancel_request';
  const resend = useResendCancelRequest();
  const withdraw = useWithdrawCancelRequest();
  // 접기는 출고 보류를 푸는 조치라 두 번 누르게 한다 — 브라우저 confirm 대화상자는 쓰지 않는다.
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null);
  const q = useOrderProgressOrders({
    stage: props.stage,
    state,
    stuck,
    channel,
    sort,
  });
  const meta = BOARD_STAGES.find((s) => s.key === props.stage)!;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const open = props.summary?.open ?? 0;

  return (
    <section className="flex flex-col rounded-lg border bg-white">
      <div className="flex flex-col gap-2.5 border-b px-4 pb-2.5 pt-3.5">
        <h2 className="text-base font-semibold">
          {meta.no ? `${meta.no} ${meta.name}` : meta.name}
        </h2>
        {props.summary && props.summary.states.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[{ state: '', open, stuck: 0 }, ...props.summary.states].map(
              (s) => (
                <button
                  key={s.state || '__all'}
                  type="button"
                  onClick={() => setState(s.state)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[13px]',
                    state === s.state &&
                      'border-foreground bg-foreground text-background'
                  )}
                >
                  {s.state ? stateLabel(s.state) : '전체'}
                  <span className="ml-1 opacity-75 tabular-nums">
                    {s.open.toLocaleString('ko-KR')}
                  </span>
                  {s.stuck > 0 && (
                    <span className="ml-1 font-semibold text-red-600">
                      ⚠{s.stuck.toLocaleString('ko-KR')}
                    </span>
                  )}
                </button>
              )
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStuck((v) => !v)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[13px]',
              stuck && 'border-red-600 bg-red-50 font-semibold text-red-600'
            )}
          >
            갇힘만
          </button>
          <select
            className="rounded-md border px-2 py-1 text-[13px]"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">모든 채널</option>
            <option value="medusa">medusa</option>
            <option value="naver">naver</option>
            <option value="coupang">coupang</option>
            <option value="3pl">3pl</option>
          </select>
          <select
            className="rounded-md border px-2 py-1 text-[13px]"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'dwell' | 'ordered')}
          >
            <option value="dwell">체류 긴 순</option>
            <option value="ordered">주문일 최신순</option>
          </select>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-muted-foreground">
          {q.isLoading
            ? ''
            : open
              ? '조건에 맞는 주문 없음'
              : '이 단계에 머무는 주문 없음'}
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">주문번호</th>
              <th className="px-4 py-2 text-left font-medium">채널</th>
              <th className="px-4 py-2 text-left font-medium">고객</th>
              <th className="px-4 py-2 text-left font-medium">주문일</th>
              <th className="px-4 py-2 text-left font-medium">세부 상태</th>
              <th className="px-4 py-2 text-right font-medium">체류</th>
              {isCancelRequest && (
                <th className="px-4 py-2 text-right font-medium">조치</th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const badge = gaveUpBadge(r.gaveUp);
              return (
                <tr key={r.salesOrderId} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-[13px]">
                    <Link
                      href={`/order/history?orderNo=${encodeURIComponent(r.channelOrderId)}`}
                    >
                      {r.orderNo}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.salesChannel}</td>
                  <td className="px-4 py-2">{r.customerName ?? ''}</td>
                  <td className="px-4 py-2">
                    {new Date(r.orderedAt).toLocaleString('ko-KR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                      {stateLabel(r.state)}
                    </span>
                    {badge && (
                      <span
                        className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600"
                        title={badge.title}
                      >
                        {badge.text}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2 text-right tabular-nums',
                      r.stuck && 'font-semibold text-red-600'
                    )}
                  >
                    {formatDwell(
                      props.now.getTime() - new Date(r.stageEnteredAt).getTime()
                    )}
                  </td>
                  {isCancelRequest && (
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="mr-1.5 rounded border px-2 py-0.5 text-xs disabled:opacity-40"
                        disabled={resend.isPending}
                        onClick={() =>
                          resend.mutate(r.salesOrderId, {
                            onSuccess: () =>
                              toast.success('취소 요청을 다시 보냈습니다.'),
                            onError: (e) =>
                              toast.error(
                                e instanceof Error
                                  ? e.message
                                  : '다시 보내지 못했습니다.'
                              ),
                          })
                        }
                      >
                        다시 보내기
                      </button>
                      {/* 수정됨·환불 미완은 채널 주문이 이미 줄었다 — 접으면 취소분이 출고된다(서버도 거절). 보드는 appliedAt 을 몰라 이 상태 전체를 숨긴다. */}
                      {r.state !== 'cancel_edited' && (
                        <button
                          type="button"
                          className={cn(
                            'rounded border px-2 py-0.5 text-xs disabled:opacity-40',
                            confirmWithdraw === r.salesOrderId &&
                              'border-red-600 text-red-600'
                          )}
                          disabled={withdraw.isPending}
                          onClick={() => {
                            if (confirmWithdraw !== r.salesOrderId) {
                              setConfirmWithdraw(r.salesOrderId);
                              return;
                            }
                            withdraw.mutate(r.salesOrderId, {
                              onSuccess: () =>
                                toast.success(
                                  '요청을 접었습니다. 출고 보류가 풀렸습니다.'
                                ),
                              onError: (e) =>
                                toast.error(
                                  e instanceof Error
                                    ? e.message
                                    : '요청을 접지 못했습니다.'
                                ),
                              onSettled: () => setConfirmWithdraw(null),
                            });
                          }}
                        >
                          {confirmWithdraw === r.salesOrderId
                            ? '접기 확인'
                            : '요청 접기'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {q.hasNextPage && (
        <button
          type="button"
          className="border-t py-2 text-sm text-muted-foreground"
          onClick={() => void q.fetchNextPage()}
        >
          더 보기
        </button>
      )}
    </section>
  );
}
