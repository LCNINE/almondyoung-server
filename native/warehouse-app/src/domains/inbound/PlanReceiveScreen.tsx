import { useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { scanIncrement } from './packingUnit';
import { usePendingPlans } from './queries';
import { useCancelInbound, useReceiveFromPlan } from './mutations';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { ReceiveSheet } from './ReceiveSheet';
import type { FreshLine, PendingPlanItem } from './types';

export function PlanReceiveScreen({ planId }: { planId: string }) {
  const { warehouseId, isSet } = useWarehouse();
  const plans = usePendingPlans(warehouseId);
  const lookup = useSkuByBarcode();
  const receive = useReceiveFromPlan();
  const cancel = useCancelInbound();

  const [active, setActive] = useState<PendingPlanItem | null>(null);
  const [scanBump, setScanBump] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshLine | null>(null);
  const [putawayOpen, setPutawayOpen] = useState(false);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [confirming, setConfirming] = useState<{ quantity: number } | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const plan = (plans.data?.pendingPlans ?? []).find((p) => p.planId === planId);
  const items = plan?.items ?? [];

  // 멱등키 회전 — 같은 (planItemId, 수량) 재시도는 같은 키를 유지하고, 값이
  // 바뀌면 새 키를 발급한다. "커밋됐는데 응답만 유실" 뒤 값을 고쳐 재제출할 때
  // 옛 payload 를 같은 키로 replay 하는 사고를 막는다.
  const keyPayloadRef = useRef({ planItemId: '', qty: 0, key: crypto.randomUUID() });
  function keyFor(targetPlanItemId: string, quantity: number): string {
    const prev = keyPayloadRef.current;
    if (prev.planItemId === targetPlanItemId && prev.qty === quantity) return prev.key;
    const key = crypto.randomUUID();
    keyPayloadRef.current = { planItemId: targetPlanItemId, qty: quantity, key };
    return key;
  }

  function submitReceive(target: PendingPlanItem, quantity: number) {
    receive.mutate(
      { planItemId: target.planItemId, quantity, idempotencyKey: keyFor(target.planItemId, quantity) },
      {
        onSuccess: (result) => {
          setFresh({
            lineId: result.lineId,
            skuId: target.skuId,
            skuName: target.skuName,
            skuCode: target.skuCode,
            quantity,
            putawayDone: false,
          });
          keyPayloadRef.current = { planItemId: '', qty: 0, key: crypto.randomUUID() };
          closeSheet();
        },
      }
    );
  }

  // 스캔 라우팅: 적치 시트가 열려 있으면 그쪽이 먹고, 수량 시트가 열려 있으면
  // 같은 SKU 만 누적, 목록 상태면 예정 항목을 찾는다.
  useScanner((e) => {
    if (putawayOpen) return;
    lookup.mutate(e.code, {
      onSuccess: (skus) => {
        const sku = skus[0];
        // 바코드가 아예 미등록이든, 등록됐지만 이 예정에 없는 SKU 든 — 작업자
        // 입장에서는 "여기서 못 받는 물건"이라는 같은 결론이라 메시지를 합친다.
        const matched = sku ? items.find((i) => i.skuId === sku.id) : undefined;
        if (!sku || !matched) {
          setNotice('이 예정에 없는 품목이에요.');
          return;
        }
        const step = scanIncrement(sku, e.code);
        setNotice(null);
        if (active) {
          if (active.skuId !== sku.id) {
            setNotice('다른 품목이에요. 지금 수량을 먼저 확정해 주세요.');
            return;
          }
          setScanBump((n) => n + step);
          return;
        }
        setActive(matched);
        setScanBump(0);
      },
      onError: (err) => setNotice(errorMessage(err, 'barcode')),
    });
  });

  function closeSheet() {
    setActive(null);
    setScanBump(0);
  }

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="예정 입고" backTo="/inbound" />
        <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title={plan?.purchaseOrder.supplier?.name ?? '예정 입고'} backTo="/inbound" />

      {notice ? (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          {notice}
        </p>
      ) : null}

      {fresh ? (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-sm text-green-900">
            {fresh.skuName} {fresh.quantity}개 입고됨
            {fresh.putawayDone ? ' · 적치 완료' : ''}
          </p>
          <div className="flex gap-2">
            {!fresh.putawayDone ? (
              <Button type="button" className="flex-1 py-1.5 text-xs" onClick={() => setPutawayOpen(true)}>
                적치하기
              </Button>
            ) : null}
            {/* 취소는 적치 전에만 가능하다 — 서버가 putawayFromOriginQty > 0 이면 거부한다. */}
            {!fresh.putawayDone ? (
              <Button
                type="button"
                className="flex-1 border border-red-300 bg-white py-1.5 text-xs text-red-700 hover:bg-red-50"
                onClick={() => setCancelConfirm(true)}
              >
                취소
              </Button>
            ) : null}
            <Button
              type="button"
              className="flex-1 border border-gray-300 bg-white py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              onClick={() => setFresh(null)}
            >
              닫기
            </Button>
          </div>
          {cancel.isError ? (
            <p role="alert" className="text-xs text-red-700">
              {errorMessage(cancel.error, 'inbound-cancel')}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">예정 품목</h2>
        {plans.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(plans.error, 'inbound')}
          </p>
        ) : plans.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500">남은 예정 품목이 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.planItemId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{item.skuName}</span>
                  <span className="block font-mono text-xs text-gray-500">{item.skuCode}</span>
                  <span className="block text-xs text-gray-500">
                    예정 {item.expectedQty} · 입고 {item.receivedQty} · 잔여 {item.pendingQty}
                  </span>
                </span>
                {/* 시트가 열려 있는 동안은 숨긴다 — 시트의 [입고] 버튼과 접근성 이름이
                    겹쳐서 role 쿼리가 모호해지고, 어차피 한 번에 한 항목만 다룬다. */}
                {!active ? (
                  <Button
                    className="shrink-0 px-3 py-1.5 text-xs"
                    onClick={() => {
                      setActive(item);
                      setScanBump(0);
                      setNotice(null);
                    }}
                  >
                    입고
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {active ? (
        <ReceiveSheet
          item={active}
          scanBump={scanBump}
          pending={receive.isPending}
          onCancel={closeSheet}
          onSubmit={(quantity) => {
            // 예정 잔여를 넘지 않으면 바로 보낸다 — 예정대로 다 온 흔한 경우를
            // 확인창으로 막지 않는다. 초과일 때만 몇 개 많은지 짚어 확인받는다
            // (서버는 초과를 막지 않으므로 여기서 막으면 실물이 안 들어간다).
            if (quantity > active.pendingQty) {
              setConfirming({ quantity });
              return;
            }
            submitReceive(active, quantity);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        title="입고 확인"
        message={
          active && confirming
            ? `예정 잔여(${active.pendingQty})보다 ${confirming.quantity - active.pendingQty}개 많습니다. ${active.skuName} ${confirming.quantity}개를 입고할까요?`
            : ''
        }
        confirmLabel="입고"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = active;
          const quantity = confirming?.quantity ?? 0;
          setConfirming(null);
          if (!target || quantity < 1) return;
          submitReceive(target, quantity);
        }}
      />

      <ConfirmDialog
        open={cancelConfirm}
        title="입고 취소"
        message={fresh ? `${fresh.skuName} ${fresh.quantity}개 입고를 전량 취소합니다.` : ''}
        confirmLabel="취소하기"
        danger
        onCancel={() => setCancelConfirm(false)}
        onConfirm={() => {
          setCancelConfirm(false);
          if (!fresh) return;
          cancel.mutate(
            { lineId: fresh.lineId, quantity: fresh.quantity, idempotencyKey: crypto.randomUUID() },
            { onSuccess: () => setFresh(null) }
          );
        }}
      />

      {putawayOpen && fresh ? (
        <PutawaySheet
          line={fresh}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayOpen(false)}
          onDone={(dest) => {
            setLastDest(dest);
            setPutawayOpen(false);
            setFresh((prev) => (prev ? { ...prev, putawayDone: true } : prev));
          }}
        />
      ) : null}
    </div>
  );
}
