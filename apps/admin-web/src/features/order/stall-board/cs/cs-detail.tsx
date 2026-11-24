'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CanOpen } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { OrderFulfillmentSection } from '@/features/cs/order-lookup/order-fulfillment-section';
import { useReadGate } from '@/features/main/read-gate';
import {
  carrierLabel,
  shipmentStatusLabel,
} from '@/features/order/fulfillments/detail/fulfillment-labels';
import { fulfillmentDetailHref } from '@/features/order/fulfillments/template/detail-href';
import { kstToday } from '@/features/order/matching/lib/date-key';
import {
  BoardStageKey,
  ProgressItem,
  stateLabel,
} from '@/lib/api/domains/orders/order-progress.shape';
import {
  contactPeople,
  type CsContext,
} from '@/lib/api/domains/orders/order-cs.shape';
import { shipmentPhaseLabel } from '@/lib/api/domains/orders/shipment-phase.shape';
import {
  useCsSalesOrder,
  useOrderCsContext,
} from '@/lib/services/orders/order-cs';
import type { SalesOrderDto } from '@/lib/types/dto/orders';
import { ShortageCell } from '../components/shortage-cell';
import { ShortageSplitAction } from '../components/shortage-split-action';
import { ContactLog, RetryLine } from './contact-log';
import { CopyText, copyToClipboard } from './copy-text';
import type { CsDraft, SetCsDraft } from './cs-drafts';
import { customerNotice } from './customer-notice';
import { MemoEditor } from './memo-editor';

const won = (v: number | null | undefined) =>
  typeof v === 'number' ? `${v.toLocaleString('ko-KR')}원` : '-';

type Address = {
  recipient: string | null;
  phone: string | null;
  address: string | null;
  note: string | null;
};

function addressOf(value: unknown): Address {
  let source: unknown = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {
        recipient: null,
        phone: null,
        address: source as string,
        note: null,
      };
    }
  }
  const o = (
    typeof source === 'object' && source !== null ? source : {}
  ) as Record<string, unknown>;
  const s = (key: string) =>
    typeof o[key] === 'string' && o[key] ? (o[key] as string) : null;
  return {
    recipient: s('recipientName') ?? s('recipient'),
    phone: s('phone'),
    address:
      [
        s('postalCode') && `(${s('postalCode')})`,
        s('roadAddress') ?? s('address'),
        s('detailAddress'),
      ]
        .filter(Boolean)
        .join(' ') || null,
    note: s('deliveryNote'),
  };
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <dt className="w-16 shrink-0 text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words">{props.children}</dd>
    </div>
  );
}

const copyable = (value: string | null | undefined, what: string) =>
  value ? (
    <CopyText
      value={value}
      what={what}
      className="whitespace-normal text-left"
    />
  ) : (
    '없음'
  );

function CustomerInfo({ order }: { order: SalesOrderDto }) {
  const addr = addressOf(order.shippingAddress);
  return (
    <section aria-label="고객·배송">
      <h3 className="mb-1 text-sm font-semibold">고객 · 배송</h3>
      <dl className="space-y-0.5">
        <Row label="주문자">
          {order.customerName ?? '없음'} ·{' '}
          {copyable(order.customerPhone, '주문자 연락처')}
        </Row>
        <Row label="이메일">{copyable(order.customerEmail, '이메일')}</Row>
        <Row label="받는 분">
          {addr.recipient ?? '없음'} · {copyable(addr.phone, '받는 분 연락처')}
        </Row>
        <Row label="배송지">{copyable(addr.address, '배송지')}</Row>
        <Row label="배송 요청">{addr.note ?? '없음'}</Row>
        <Row label="결제">
          {won(order.totalAmount)} (배송비 {won(order.shippingFee)})
        </Row>
      </dl>
    </section>
  );
}

function Goods({ order }: { order: SalesOrderDto }) {
  return (
    <section aria-label="주문 상품">
      <h3 className="mb-1 text-sm font-semibold">
        주문 상품 {order.lines.length.toLocaleString('ko-KR')}종
      </h3>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto text-[13px]">
        {order.lines.map((line, i) => (
          <li key={i} className="flex gap-3">
            <span className="min-w-0 flex-1 break-keep">
              {line.productName ?? line.variantId}
            </span>
            <span className="whitespace-nowrap tabular-nums">
              {line.quantity.toLocaleString('ko-KR')}개
            </span>
            <span className="w-24 whitespace-nowrap text-right tabular-nums">
              {won(line.totalPrice)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Boxes({ boxes }: { boxes: CsContext['boxes'] }) {
  const tracked = boxes.filter((b) => b.trackingNo);
  if (tracked.length === 0) return null;
  return (
    <section aria-label="송장">
      <h3 className="mb-1 text-sm font-semibold">송장</h3>
      <ul className="space-y-0.5 text-[13px]">
        {tracked.map((b) => (
          <li key={b.shipmentId} className="flex flex-wrap gap-x-2">
            <span>{b.carrier ? carrierLabel(b.carrier) : ''}</span>
            <CopyText value={b.trackingNo ?? ''} what="송장번호" />
            <Link
              className="text-primary underline underline-offset-2"
              href={fulfillmentDetailHref(b.fulfillmentOrderId, b.shipmentId)}
            >
              {shipmentStatusLabel(b.status)} — 상자 보기
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OtherOrders({ context }: { context: CsContext }) {
  const { otherOrders } = context;
  const waiting = otherOrders.filter((o) => o.phase === 'preparing');
  const joinable = waiting.filter((o) => o.sameAddress).length;
  return (
    <section aria-label="같은 고객의 다른 주문">
      <h3 className="mb-1 text-sm font-semibold">
        같은 고객의 다른 주문{' '}
        {waiting.length > 0 && (
          <span className="text-red-600">안 나간 주문 {waiting.length}건</span>
        )}
      </h3>
      {otherOrders.length === 0 ? (
        <p className="text-xs text-muted-foreground">없음</p>
      ) : (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[13px]">
          {otherOrders.map((o) => (
            <li key={o.salesOrderId} className="flex flex-wrap gap-x-2">
              <CanOpen
                screen="/cs"
                fallback={<span className="font-mono">{o.orderNo}</span>}
              >
                <Link
                  className="font-mono text-primary underline underline-offset-2"
                  href={`/cs?orderId=${encodeURIComponent(o.salesOrderId)}&orderNo=${encodeURIComponent(o.orderNo)}`}
                >
                  {o.orderNo}
                </Link>
              </CanOpen>
              <span className="tabular-nums text-muted-foreground">
                {new Date(o.orderedAt).toLocaleDateString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                })}
              </span>
              <span className="tabular-nums">{won(o.totalAmount)}</span>
              <span
                className={
                  o.phase === 'preparing'
                    ? 'font-semibold'
                    : 'text-muted-foreground'
                }
              >
                {shipmentPhaseLabel(o.phase)}
              </span>
              {o.phase === 'preparing' && o.sameAddress && (
                <span>같은 배송지</span>
              )}
              {o.matchedBy === 'phone' && (
                <span className="text-xs text-muted-foreground">
                  연락처가 같음
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {context.moreOtherOrders && (
        <p className="text-xs text-muted-foreground">
          최근 {otherOrders.length}건만 보여요. 더 오래된 주문이 있어요.
        </p>
      )}
      {joinable > 0 && (
        <CanOpen screen="/order/consolidation">
          <Link
            className="text-xs text-primary underline underline-offset-2"
            href="/order/consolidation"
          >
            같은 배송지 {joinable}건 — 합포장 보드에서 확인
          </Link>
        </CanOpen>
      )}
    </section>
  );
}

function Notice(props: { text: string | null }) {
  const [edited, setEdited] = useState<string | null>(null);
  if (props.text === null) return null;
  const value = edited ?? props.text;
  return (
    <section aria-label="고객 안내문">
      <h3 className="mb-1 text-sm font-semibold">고객 안내문</h3>
      <Textarea
        aria-label="고객 안내문 내용"
        rows={Math.min(8, value.split('\n').length + 1)}
        className="text-[13px]"
        value={value}
        onChange={(e) => setEdited(e.target.value)}
      />
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => void copyToClipboard(value, '안내문 복사됨')}
        >
          복사
        </Button>
        {edited !== null && edited !== props.text && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setEdited(null)}
          >
            지금 상태로 다시 쓰기
          </Button>
        )}
      </div>
    </section>
  );
}

export function CsDetail(props: {
  stage: BoardStageKey;
  item: ProgressItem;
  /** 지금 이 목록에 있다. 다른 단계로 넘어갔으면 아래 상태는 조금 전 것이다 */
  inList: boolean;
  now: Date;
  draft: CsDraft;
  setDraft: SetCsDraft;
  onClose: () => void;
}) {
  const { item, stage } = props;
  const gate = useReadGate(['order.order.read']);
  const order = useCsSalesOrder(item.salesOrderId, gate.enabled);
  const context = useOrderCsContext(item.salesOrderId);
  const notice = props.inList
    ? customerNotice(stage, item, context.data?.boxes, kstToday(props.now))
    : null;
  const historyHref = `/order/history?orderNo=${encodeURIComponent(item.channelOrderId)}`;

  return (
    <div
      role="region"
      aria-label={`${item.orderNo} CS 상세`}
      className="flex flex-col gap-3 whitespace-normal bg-slate-50 px-4 py-3 text-left"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-mono">{item.orderNo}</strong>
        <span className="rounded bg-white px-1.5 py-0.5 text-xs">
          {stateLabel(item.state)}
        </span>
        {!props.inList && (
          <span className="text-xs font-semibold text-red-600">
            지금 이 목록에 없어요. 다른 단계로 넘어갔거나 목록 조건에서
            빠졌어요.
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <CanOpen screen="/cs">
            <Link
              className="rounded-md border bg-white px-2 py-1 text-xs"
              href={`/cs?orderId=${encodeURIComponent(item.salesOrderId)}&orderNo=${encodeURIComponent(item.orderNo)}`}
            >
              주문조회
            </Link>
          </CanOpen>
          <CanOpen screen="/order/history">
            <Link
              className="rounded-md border bg-white px-2 py-1 text-xs"
              href={historyHref}
            >
              취소·배송지 변경
            </Link>
          </CanOpen>
          <CanOpen screen="/cs/return-exchange">
            <Link
              className="rounded-md border bg-white px-2 py-1 text-xs"
              href={`/cs/return-exchange?q=${encodeURIComponent(item.orderNo)}`}
            >
              반품·교환
            </Link>
          </CanOpen>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={props.onClose}
          >
            닫기
          </Button>
        </span>
      </div>

      <ContactLog
        salesOrderId={item.salesOrderId}
        draft={props.draft.contact}
        onDraft={(contact) =>
          props.setDraft(item.salesOrderId, (d) => ({ ...d, contact }))
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          {order.data ? (
            <>
              {order.isError && (
                <RetryLine
                  text="새 주문 정보를 확인하지 못했어요. 아래는 조금 전 값이에요."
                  onRetry={() => void order.refetch()}
                />
              )}
              <CustomerInfo order={order.data} />
              <MemoEditor
                salesOrderId={item.salesOrderId}
                memo={order.data.memo ?? ''}
                draft={props.draft.memo}
                onDraft={(memo) =>
                  props.setDraft(item.salesOrderId, (d) => ({ ...d, memo }))
                }
              />
              <Goods order={order.data} />
            </>
          ) : order.isError || gate.failed ? (
            <RetryLine
              text="주문 정보를 불러오지 못했어요."
              onRetry={() => void order.refetch()}
            />
          ) : gate.hiddenReason ? (
            <section aria-label="고객·배송" className="text-[13px]">
              {item.cs &&
                contactPeople(item.customerName, item.cs).map((p) => (
                  <p key={p.who}>
                    {p.who} {p.name ?? '이름 없음'} ·{' '}
                    {copyable(p.phone, `${p.who} 연락처`)}
                  </p>
                ))}
              <p className="text-xs text-muted-foreground">
                배송지·상품·메모는 {gate.hiddenReason}
              </p>
            </section>
          ) : (
            <p className="text-xs text-muted-foreground">
              주문 정보를 불러오는 중…
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {props.inList && item.shortage && (
            <section aria-label="막힌 이유">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold">재고가 모자라요</h3>
                <ShortageSplitAction shortage={item.shortage} />
              </div>
              <div className="text-[13px]">
                <ShortageCell shortage={item.shortage} now={props.now} />
              </div>
            </section>
          )}
          <Notice text={notice} />
          {context.data ? (
            <>
              {context.isError && (
                <RetryLine
                  text="새 값을 확인하지 못했어요. 아래는 조금 전 값이에요."
                  onRetry={() => void context.refetch()}
                />
              )}
              <Boxes boxes={context.data.boxes} />
              <OtherOrders context={context.data} />
            </>
          ) : context.isError ? (
            <RetryLine
              text="송장과 다른 주문을 불러오지 못했어요."
              onRetry={() => void context.refetch()}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              송장과 다른 주문을 불러오는 중…
            </p>
          )}
        </div>
      </div>
      {order.data && (
        <OrderFulfillmentSection
          orderId={item.salesOrderId}
          orderNo={item.orderNo}
          fulfillmentOrder={order.data.fulfillmentOrder}
          lineRouteCounts={order.data.lineRouteCounts}
        />
      )}
    </div>
  );
}
