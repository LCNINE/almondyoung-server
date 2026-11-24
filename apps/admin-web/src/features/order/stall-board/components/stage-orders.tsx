'use client';

import { Fragment, useState } from 'react';
import { useOrderProgressOrders } from '@/lib/services/orders/queries';
import {
  BOARD_STAGES,
  BoardStageKey,
  ProgressItem,
  StageSummary,
  formatDwell,
  gaveUpBadge,
  stateLabel,
} from '@/lib/api/domains/orders/order-progress.shape';
import { settlementLabel, settlementReason, settlementTiming } from '@/lib/api/domains/orders/cancel-request.shape';
import { SettlementActions } from '@/features/order/cancel-settlement/settlement-actions';
import { ManualRefundTodo } from '@/features/order/cancel-settlement/manual-refund-todo';
import { CarrierAttentionPanel } from '@/features/order/carrier-tracking/carrier-attention-panel';
import { PendingTransfers } from './pending-transfers';
import { ShortageCell } from './shortage-cell';
import { ShortageSplitAction } from './shortage-split-action';
import { useOperatorNames } from '@/features/order/fulfillments/detail/operation-operator';
import type { CsDrafts, SetCsDraft } from '../cs/cs-drafts';
import { emptyCsDraft } from '../cs/cs-drafts';
import { ContactCell, CustomerCell, GoodsCell } from '../cs/cs-cells';
import { CsDetail } from '../cs/cs-detail';
import { cn } from '@/lib/utils/ui';

/** 아래 목록 — 세부 상태 칩, 갇힘만, 채널, 정렬. 체류 긴 순이 기본(스펙 D7). 주문번호를 누르면 줄 아래에 CS 상세를 편다. */
export function StageOrders(props: {
  stage: Exclude<BoardStageKey, 'collect'>;
  summary: StageSummary | undefined;
  now: Date;
  drafts: CsDrafts;
  setDraft: SetCsDraft;
}) {
  const [state, setState] = useState('');
  const [stuck, setStuck] = useState(false);
  const [followUpDue, setFollowUpDue] = useState(false);
  // 펼친 줄은 목록이 다시 읽혀 빠져도 닫지 않는다 — 보던 상세를 잃지 않게 마지막 값을 들고 있다
  const [opened, setOpened] = useState<ProgressItem | null>(null);
  const [channel, setChannel] = useState('');
  const [sort, setSort] = useState<'dwell' | 'ordered'>('dwell');
  const isCancelRequest = props.stage === 'cancel_request';
  const isReserve = props.stage === 'reserve';
  const q = useOrderProgressOrders({
    stage: props.stage,
    state,
    stuck,
    followUpDue,
    channel,
    sort,
  });
  const meta = BOARD_STAGES.find((s) => s.key === props.stage)!;
  const columns = 7 + (isReserve ? 2 : 0) + (isCancelRequest ? 1 : 0);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const open = props.summary?.open ?? 0;
  const authorName = useOperatorNames(
    items.map((r) => r.cs?.lastContact?.authorId)
  );
  const listed = opened
    ? items.find((r) => r.salesOrderId === opened.salesOrderId)
    : undefined;
  const toggle = (r: ProgressItem) => {
    if (opened?.salesOrderId === r.salesOrderId) {
      setOpened(null);
      return;
    }
    setOpened(r);
    props.setDraft(r.salesOrderId, (d) => d);
  };
  const detail = opened && (
    <CsDetail
      key={opened.salesOrderId}
      stage={props.stage}
      item={listed ?? opened}
      inList={listed !== undefined}
      now={props.now}
      draft={props.drafts[opened.salesOrderId] ?? emptyCsDraft()}
      setDraft={props.setDraft}
      onClose={() => setOpened(null)}
    />
  );

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
          <button
            type="button"
            aria-pressed={followUpDue}
            onClick={() => setFollowUpDue((v) => !v)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[13px]',
              followUpDue && 'border-red-600 bg-red-50 font-semibold text-red-600'
            )}
          >
            오늘 연락할 주문
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
      {isCancelRequest && <PendingTransfers now={props.now} />}
      {props.stage === 'track' && <CarrierAttentionPanel now={props.now} />}
      {detail && !listed && <div className="border-b">{detail}</div>}
      {q.isError && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b px-4 py-2 text-sm text-red-600"
        >
          {items.length > 0
            ? '새 목록을 확인하지 못했어요. 아래는 조금 전 목록이에요.'
            : '목록을 불러오지 못했어요.'}
          <button
            type="button"
            className="rounded-md border px-2 py-0.5 text-xs"
            onClick={() => void q.refetch()}
          >
            다시 시도
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-muted-foreground">
          {q.isLoading || q.isError
            ? ''
            : open
              ? '조건에 맞는 주문 없음'
              : '이 단계에 머무는 주문 없음'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">주문번호</th>
                <th className="px-4 py-2 text-left font-medium">고객 · 연락처</th>
                <th className="px-4 py-2 text-left font-medium">상품 · 금액</th>
                <th className="px-4 py-2 text-left font-medium">주문일</th>
                <th className="px-4 py-2 text-left font-medium">세부 상태</th>
                {isReserve && (
                  <th className="px-4 py-2 text-left font-medium">모자람</th>
                )}
                <th className="px-4 py-2 text-left font-medium">연락</th>
                <th className="px-4 py-2 text-right font-medium">체류</th>
                {(isCancelRequest || isReserve) && (
                  <th className="px-4 py-2 text-right font-medium">조치</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const badge = gaveUpBadge(r.gaveUp);
                const expanded = opened?.salesOrderId === r.salesOrderId;
                return (
                  <Fragment key={r.salesOrderId}>
                  <tr className="border-t hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        className="whitespace-nowrap font-mono text-[13px] text-primary underline underline-offset-2"
                        onClick={() => toggle(r)}
                      >
                        {expanded ? '▾' : '▸'} {r.orderNo}
                      </button>
                      <div className="text-xs text-muted-foreground">{r.salesChannel}</div>
                    </td>
                    <td className="px-4 py-2">
                      <CustomerCell customerName={r.customerName} cs={r.cs} />
                    </td>
                    <td className="px-4 py-2">
                      <GoodsCell cs={r.cs} />
                    </td>
                    <td className="px-4 py-2">
                      {new Date(r.orderedAt).toLocaleString('ko-KR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                        {r.settlement ? settlementLabel(r.settlement) : stateLabel(r.state)}
                      </span>
                      {badge && (
                        <span
                          className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600"
                          title={badge.title}
                        >
                          {badge.text}
                        </span>
                      )}
                      {r.settlement && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {settlementTiming(r.settlement, props.now.getTime())}
                          {settlementReason(r.settlement) && (
                            <span className="ml-1.5 text-red-600">{settlementReason(r.settlement)}</span>
                          )}
                          <ManualRefundTodo settlement={r.settlement} walletIntentId={r.walletIntentId} />
                        </div>
                      )}
                    </td>
                    {isReserve && (
                      <td className="px-4 py-2">
                        {r.shortage && (
                          <ShortageCell shortage={r.shortage} now={props.now} />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <ContactCell cs={r.cs} now={props.now} authorName={authorName} />
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
                    {isReserve && (
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {r.shortage ? <ShortageSplitAction shortage={r.shortage} /> : null}
                      </td>
                    )}
                    {isCancelRequest && (
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {r.settlement ? (
                          <SettlementActions
                            salesOrderId={r.salesOrderId}
                            settlement={r.settlement}
                            walletIntentId={r.walletIntentId}
                          />
                        ) : null}
                      </td>
                    )}
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={columns} className="border-t p-0">
                        {detail}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
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
