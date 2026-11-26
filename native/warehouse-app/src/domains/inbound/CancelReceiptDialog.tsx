import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { preventScanEnterActivation } from '../../core/hardware/scan/hidScanBoundary';
import { useCancelInbound, useCancelPurchaseOrderReceipt } from './mutations';
import { workSummary } from '../../core/operations/pendingWork';
import { receiptFeedback } from './receiptFeedback';
import { seoulDate } from './receiptHistory';
import {
  ReceiptStateError,
  type ReceiptCancelReservations,
  type ReceiptLineState,
} from './receiptState';
import { cancelBlockMessage } from './cancelReceipt';
import type { ReceiptSource } from './types';
import { useReceiptReconciliation } from './useReceiptReconciliation';

/** 취소됐으면 토스트에 띄울 「이름 N개」, 못 했으면 화면에 남길 안내 */
export type CancelReceiptOutcome = { ok: true; detail: string } | { ok: false; notice: string };

export interface CancelReceiptTarget {
  lineId: string;
  source: ReceiptSource;
  skuName: string;
  originLocationCode: string | null;
  /** ISO 문자열 */
  receivedAt: string;
}

function receivedLabel(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function ReservationNote({
  value,
  onRecheck,
}: {
  value: ReceiptCancelReservations;
  onRecheck: () => void;
}) {
  if (value.missingQty > 0)
    return (
      <div role="alert" className="space-y-1 text-[13px] text-[#aa4037]">
        <p>
          이미 출고 준비 중인 주문이 이 재고를 잡고 있어 지금은 취소할 수
          없어요. 관리자에게 아래 주문의 송장을 무효화하고 출고 배치에서 빼
          달라고 한 뒤 「다시 확인」을 눌러 주세요.
        </p>
        <ul className="list-disc pl-5">
          {value.heldBy.map((row, index) => (
            <li key={`${row.orderNo}:${index}`}>
              {row.orderNo ? `주문 ${row.orderNo}` : '주문번호를 모르는 주문'} ·{' '}
              {row.quantity}개
            </li>
          ))}
          {value.heldBy.length === 0 && <li>{value.missingQty}개</li>}
        </ul>
        <Button onClick={onRecheck}>다시 확인</Button>
      </div>
    );
  if (value.orderCount === 0) return null;
  return (
    <p className="text-[13px] text-[#9a681c]">
      이 재고를 잡아 둔 주문 {value.orderCount}건({value.quantity}개)은 다시
      재고를 기다려요.
    </p>
  );
}

/** 입고 줄 하나를 전량 취소한다 — 입고내역과 적치 대기가 같은 창을 쓴다. */
function CancelReceiptContent({
  target,
  warehouseId,
  onClose,
  onFinished,
}: {
  target: CancelReceiptTarget;
  warehouseId: string;
  onClose: () => void;
  /** 취소됐거나 실패했다 — 화면은 목록을 다시 읽는다. */
  onFinished: (outcome: CancelReceiptOutcome) => void;
}) {
  const direct = useCancelInbound();
  const po = useCancelPurchaseOrderReceipt();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 누르는 순간 다시 읽는 동안에도 작업자가 보고 정한 내용을 그대로 둔다
  const [shown, setShown] = useState<ReceiptLineState | null>(null);
  const receipt = useReceiptReconciliation({
    lineId: target.lineId,
    warehouseId,
    expectedSource: target.source,
  });
  if (receipt.state && receipt.state !== shown) setShown(receipt.state);
  const state = receipt.state ?? shown;
  const reservations = state?.cancelReservations ?? null;
  const boxReceipt = target.source === 'inbound_shipment';
  const cancelable =
    !boxReceipt &&
    receipt.state?.canCancel === true &&
    (receipt.state.cancelReservations?.missingQty ?? 0) === 0;
  const blocked = state && !state.canCancel ? cancelBlockMessage(state) : null;
  const fromEarlierDay = seoulDate(new Date(target.receivedAt)) !== seoulDate();

  async function confirm() {
    if (busyRef.current || !receipt.state) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const seen = receipt.state;
    try {
      const latest = await receipt.refresh();
      if (!latest.canCancel || latest.quantity !== seen.quantity)
        throw new ReceiptStateError(
          '입고 상태가 바뀌었어요. 최신 내역을 확인해 주세요.'
        );
      const before = seen.cancelReservations;
      const now = latest.cancelReservations;
      if (
        (now?.missingQty ?? 0) > 0 ||
        (now?.orderCount ?? 0) !== (before?.orderCount ?? 0) ||
        (now?.quantity ?? 0) !== (before?.quantity ?? 0)
      ) {
        // 이제 취소할 수 없는 이유는 위 안내가 말한다
        if ((now?.missingQty ?? 0) === 0)
          setNotice(
            '이 재고를 잡은 주문이 바뀌었어요. 바뀐 내용을 확인하고 다시 눌러 주세요.'
          );
        return;
      }
      if (latest.source === 'purchase_order')
        await po.mutateAsync({
          receiptLineId: latest.lineId,
          idempotencyKey,
          summary: workSummary([{ name: target.skuName, quantity: latest.quantity }]),
        });
      else
        await direct.mutateAsync({
          lineId: latest.lineId,
          quantity: latest.quantity,
          idempotencyKey,
          summary: workSummary([{ name: target.skuName, quantity: latest.quantity }]),
        });
      onFinished({ ok: true, detail: `${target.skuName} ${latest.quantity}개` });
    } catch (error) {
      onFinished({
        ok: false,
        notice:
          error instanceof ReceiptStateError
            ? error.message
            : errorMessage(error, 'inbound-cancel'),
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#18181b55] p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="입고 취소 확인"
        className="max-h-[90vh] w-full max-w-[440px] space-y-3 overflow-y-auto rounded-2xl border border-[#e4e4e7] bg-white p-7 text-[#27272a] shadow-[0_20px_80px_#18181b30] max-[600px]:p-[23px]"
        onKeyDown={(event) => preventScanEnterActivation(event.nativeEvent)}
      >
        <h2 className="mb-[22px] text-[22px] font-bold max-[600px]:text-xl">
          입고 취소 확인
        </h2>
        <div>
          <p className="text-base font-semibold">
            {target.skuName}
            {state ? ` ${state.quantity}개` : ''}
          </p>
        </div>
        <dl className="my-6 flex flex-col gap-2.5">
          <div className="flex items-baseline text-[13px]">
            <dt className="w-[90px] shrink-0 text-[#71717a]">입고 일시</dt>
            <dd className="tabular-nums">{receivedLabel(target.receivedAt)}</dd>
          </div>
          <div className="flex items-baseline text-[13px]">
            <dt className="w-[90px] shrink-0 text-[#71717a]">원위치</dt>
            <dd>{target.originLocationCode ?? '원위치 확인 필요'}</dd>
          </div>
          {state ? (
            <div className="flex items-baseline text-[13px]">
              <dt className="w-[90px] shrink-0 text-[#71717a]">취소 수량</dt>
              <dd>
                <strong>{state.quantity}개 전체</strong>
              </dd>
            </div>
          ) : null}
        </dl>
        {busy ? (
          <p role="status" className="text-[13px] text-[#71717a]">
            취소하고 있어요.
          </p>
        ) : receipt.error ? (
          <div className="space-y-2">
            <p role="alert" className="text-[13px] text-[#aa4037]">
              {receiptFeedback(receipt.error, 'inbound')}
            </p>
            <Button onClick={() => void receipt.refresh().catch(() => {})}>
              다시 확인
            </Button>
          </div>
        ) : !receipt.ready ? (
          <p role="status" className="text-[13px] text-[#71717a]">
            입고 상태를 확인하고 있어요.
          </p>
        ) : null}
        {boxReceipt ? (
          <p role="alert" className="text-[13px] leading-[1.8] text-[#aa4037]">
            선적 상자로 받은 입고예요. 상자째 취소해 주세요 —{' '}
            <Link to="/inbound/history" className="underline">
              입고내역
            </Link>
            의 이 입고에 상자가 적혀 있어요.
          </p>
        ) : blocked ? (
          <p role="alert" className="text-[13px] leading-[1.8] text-[#aa4037]">
            {blocked}
          </p>
        ) : state ? (
          <>
            {fromEarlierDay && (
              <p className="text-[13px] font-semibold text-[#9a681c]">
                오늘 입고한 건이 아니에요. 입고한 날짜를 확인해 주세요.
              </p>
            )}
            <p className="text-[13px] leading-[1.8] text-[#71717a]">
              이 창고 재고에서 {state.quantity}개가 모두 빠져요. 실제로 들어온
              물건이 아닐 때만 취소해 주세요.
            </p>
            {target.source === 'purchase_order' && (
              <p className="text-[13px] leading-[1.8] text-[#71717a]">
                발주 미입고 수량이 복원됩니다.
              </p>
            )}
            {reservations && (
              <ReservationNote
                value={reservations}
                onRecheck={() => void receipt.refresh().catch(() => {})}
              />
            )}
          </>
        ) : null}
        {notice && (
          <p role="status" className="text-[13px] text-[#9a681c]">
            {notice}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <Button
            className="flex-1 border border-[#e4e4e7] bg-white py-[13px] text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100"
            disabled={busy}
            onClick={onClose}
          >
            돌아가기
          </Button>
          <Button
            className="flex-1 border border-[#efcbc4] bg-white py-[13px] text-[#aa4037] hover:bg-[#eff6ff] hover:brightness-100"
            disabled={busy || !receipt.ready || !cancelable}
            onClick={() => void confirm()}
          >
            전량 취소
          </Button>
        </div>
      </section>
    </div>
  );
}

export function CancelReceiptDialog(
  props: Parameters<typeof CancelReceiptContent>[0]
) {
  return (
    <WorkArea kind="inbound">
      <CancelReceiptContent {...props} />
    </WorkArea>
  );
}
