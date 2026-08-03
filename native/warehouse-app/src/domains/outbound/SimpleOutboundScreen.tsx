import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  localStoragePrefs,
  type DevicePrefs,
} from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { NumberPad } from '../../core/design/NumberPad';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { clearLastBox } from './lastBox';
import { useForceSimpleOutbound, useSimpleOutboundScan } from './mutations';
import type { ShipmentByWaybill, SimpleOutboundLineProgress } from './types';

function initialProgress(
  shipment: ShipmentByWaybill
): SimpleOutboundLineProgress[] {
  return shipment.lines.map((line) => ({
    shipmentLineId: line.shipmentLineId,
    skuId: line.skuId,
    qty: line.qty,
    // inspectedQty 는 전량 스캔 전까지 0 에 머문다 — 박스를 내려놨다가 다시 스캔하는
    // 재개 흐름에서는 pickedQty(활성 세션의 실제 스캔 진행)를 우선 쓴다.
    pickedQty: Math.max(line.pickedQty, line.inspectedQty),
    inspectedQty: line.inspectedQty,
  }));
}

export function SimpleOutboundScreen({
  shipmentId,
  shipment,
  prefs = localStoragePrefs,
}: {
  shipmentId: string;
  shipment: ShipmentByWaybill | null;
  prefs?: DevicePrefs;
}) {
  const [progress, setProgress] = useState<SimpleOutboundLineProgress[]>(() =>
    shipment ? initialProgress(shipment) : []
  );
  const [shipped, setShipped] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [padOpen, setPadOpen] = useState(false);
  const scan = useSimpleOutboundScan();
  const force = useForceSimpleOutbound();

  // idempotency-key 는 스캔 1회당 하나다. 재시도(httpClient 의 409 1회 재시도)가
  // 이중 계상되지 않게 같은 키를 그대로 쓴다.
  const submit = (barcode: string, quantity: number) => {
    if (shipped) return;
    setNotice(null);
    scan.mutate(
      { shipmentId, barcode, quantity, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: (state) => {
          setProgress(state.lines);
          if (state.status === 'shipped') {
            setShipped(true);
            clearLastBox(prefs);
          }
        },
        onError: (error) => setNotice(errorMessage(error, 'outbound')),
      }
    );
  };

  // 수량은 스캔 1회에만 적용된다 — 다음 상품에 옛 값이 새어들지 않도록 매 스캔 후 1로 되돌린다.
  useScanner((event) => {
    const scanQuantity = quantity < 1 ? 1 : quantity;
    setQuantity(1);
    setPadOpen(false);
    submit(event.code, scanQuantity);
  });

  if (!shipment) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="단순출고" backTo="/outbound" />
        <p role="alert">송장 정보를 잃었어요. 송장을 다시 스캔해 주세요.</p>
        <Link to="/outbound">
          <Button>출고작업으로</Button>
        </Link>
      </div>
    );
  }

  const skuLabel = (skuId: string) =>
    shipment.lines.find((line) => line.skuId === skuId)?.skuName ?? skuId;

  return (
    <div className="space-y-4">
      <ScreenHeader title="단순출고" backTo="/outbound" />
      <section className="rounded border px-3 py-2">
        <p className="font-medium">
          {shipment.carrier} {shipment.trackingNo}
        </p>
        <p className="text-sm text-neutral-500">{shipment.recipientMasked}</p>
      </section>

      <ul className="space-y-1">
        {progress.map((line) => (
          <li
            key={line.shipmentLineId}
            className="flex items-center justify-between rounded border px-3 py-2"
          >
            <span>{skuLabel(line.skuId)}</span>
            <span className="text-lg font-semibold">
              {line.pickedQty} / {line.qty}
            </span>
          </li>
        ))}
      </ul>

      {notice !== null && <p role="alert">{notice}</p>}

      {shipped ? (
        <section className="space-y-2">
          <p className="text-xl font-semibold">출고완료</p>
          <Link to="/outbound">
            <Button>다음 송장 스캔</Button>
          </Link>
        </section>
      ) : (
        <section className="space-y-2">
          <p className="text-sm text-neutral-500">상품 바코드를 스캔하세요.</p>
          {padOpen ? (
            <>
              <NumberPad value={quantity} onChange={setQuantity} />
              <p className="text-sm">
                다음 스캔 수량: {quantity < 1 ? 1 : quantity}
              </p>
            </>
          ) : (
            <Button
              type="button"
              className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setQuantity(0);
                setPadOpen(true);
              }}
            >
              수량 지정
            </Button>
          )}
          <Button
            type="button"
            className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            onClick={() => setForceOpen(true)}
            disabled={force.isPending}
          >
            강제출고
          </Button>
        </section>
      )}

      <ConfirmDialog
        open={forceOpen}
        title="남은 수량을 스캔 없이 처리할까요?"
        message="실물을 이미 확인했을 때만 사용하세요. 재고가 부족한 경우가 아니라 스캔을 생략하는 것이며, 사유가 감사 기록에 남습니다."
        confirmLabel="강제출고"
        onCancel={() => setForceOpen(false)}
        onConfirm={() => {
          setForceOpen(false);
          force.mutate(
            {
              shipmentId,
              reason: '현장 확인 후 스캔 생략',
              idempotencyKey: crypto.randomUUID(),
            },
            {
              onSuccess: (state) => {
                setProgress(state.lines);
                if (state.status === 'shipped') {
                  setShipped(true);
                  clearLastBox(prefs);
                }
              },
              onError: (error) => setNotice(errorMessage(error, 'outbound')),
            }
          );
        }}
      />
    </div>
  );
}
