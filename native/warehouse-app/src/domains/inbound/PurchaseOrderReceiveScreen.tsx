import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { scanIncrement } from './packingUnit';
import { useExpectedArrivals } from './queries';
import { useCancelPurchaseOrderReceipt, useReceivePurchaseOrder } from './mutations';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { ReceiveSheet } from './ReceiveSheet';
import type { ExpectedArrivalLine, FreshLine } from './types';

export function PurchaseOrderReceiveScreen({ poId }: { poId: string }) {
  const { warehouseId, isSet } = useWarehouse();
  const arrivals = useExpectedArrivals(warehouseId);
  const lookup = useSkuByBarcode();
  const receive = useReceivePurchaseOrder();
  const cancel = useCancelPurchaseOrderReceipt();

  const [active, setActive] = useState<ExpectedArrivalLine | null>(null);
  const [scanBump, setScanBump] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshLine | null>(null);
  const [putawayOpen, setPutawayOpen] = useState(false);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const purchaseOrder = (arrivals.data?.arrivals ?? []).find((arrival) => arrival.documentId === poId);
  const lines = purchaseOrder?.lines ?? [];

  // 시트는 열릴 때 스냅샷(active)을 잡지만, 표시는 매 렌더 lines 에서 같은
  // skuId 를 다시 찾아 쓴다 — onSettled 무효화로 잔여/입고 수량이 바뀌어도
  // 시트가 옛 숫자를 계속 보여주면 "응답만 유실됐지 실제로는 커밋된" 제출 뒤
  // 작업자가 고쳐서 다시 누르는 이중입고로 이어진다. lines 에서 사라졌다면(전량
  // 도달로 서버가 confirmed 로 굳힌 경우) 스냅샷으로 폴백만 하고, 아래 effect 가
  // 시트를 닫는다.
  const activeItem = active ? (lines.find((line) => line.skuId === active.skuId) ?? active) : null;
  const activeStillPending = active ? lines.some((line) => line.skuId === active.skuId) : true;

  useEffect(() => {
    if (active && !activeStillPending) closeSheet();
  }, [active, activeStillPending]);

  // 멱등키 회전 — 같은 (skuId, 수량) 재시도는 같은 키를 유지하고, 값이
  // 바뀌면 새 키를 발급한다. "커밋됐는데 응답만 유실" 뒤 값을 고쳐 재제출할 때
  // 옛 payload 를 같은 키로 replay 하는 사고를 막는다.
  const keyPayloadRef = useRef({ skuId: '', qty: 0, key: crypto.randomUUID() });
  function keyFor(skuId: string, quantity: number): string {
    const prev = keyPayloadRef.current;
    if (prev.skuId === skuId && prev.qty === quantity) return prev.key;
    const key = crypto.randomUUID();
    keyPayloadRef.current = { skuId, qty: quantity, key };
    return key;
  }

  // 취소도 같은 회전 규칙을 따라야 한다. receiptLineId 가 있는 한 payload 는
  // 배너가 떠 있는 동안 고정이므로, 재시도는 새 키가 아니라 같은
  // 키로 replay 해야 한다 — 안 그러면 "응답만 유실, 취소는 이미 성공" 뒤 다시
  // 누른 두 번째 시도가 새 키로 서버에 다시 들어가 "이미 취소됨" 400 을 받고,
  // 성공한 취소를 실패로 오인해 배너가 안 내려간다.
  const cancelKeyRef = useRef<{ receiptLineId: string; key: string } | null>(null);
  function cancelKeyFor(receiptLineId: string): string {
    if (cancelKeyRef.current?.receiptLineId === receiptLineId) return cancelKeyRef.current.key;
    const key = crypto.randomUUID();
    cancelKeyRef.current = { receiptLineId, key };
    return key;
  }

  function submitReceive(target: ExpectedArrivalLine, quantity: number) {
    if (!warehouseId) return;
    receive.mutate(
      {
        poId,
        warehouseId,
        lines: [{ skuId: target.skuId, quantity }],
        idempotencyKey: keyFor(target.skuId, quantity),
      },
      {
        onSuccess: (result) => {
          setFresh({
            lineId: result.lines[0].receiptLineId,
            skuId: target.skuId,
            skuName: target.skuName,
            skuCode: target.skuCode,
            quantity,
            putawayDoneQty: 0,
          });
          keyPayloadRef.current = { skuId: '', qty: 0, key: crypto.randomUUID() };
          closeSheet();
        },
      }
    );
  }

  // 스캔 라우팅: 적치 시트가 열려 있으면 그쪽이 먹고, 수량 시트가 열려 있으면
  // 같은 SKU 만 누적, 목록 상태면 예정 항목을 찾는다.
  useScanner((e) => {
    // 적치 시트나 취소 확인창이 열린 동안은 작업자가 현재 결정을 마치기 전이라
    // 뒤에서 수량 시트가 열리지 않게 한다.
    if (putawayOpen || cancelConfirm) return;
    lookup.mutate(e.code, {
      onSuccess: (skus) => {
        const sku = skus[0];
        // 바코드가 아예 미등록이든, 등록됐지만 이 예정에 없는 SKU 든 — 작업자
        // 입장에서는 "여기서 못 받는 물건"이라는 같은 결론이라 메시지를 합친다.
        const matched = sku ? lines.find((line) => line.skuId === sku.id) : undefined;
        if (!sku || !matched) {
          setNotice('이 발주에 없는 품목이에요.');
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
        // 시트를 여는 이 스캔도 물리적으로 1 회다 — 0 을 넘기면 이 스캔이 안
        // 세져 N 번 스캔에 N-1 개만 입고되는 조용한 과소입고가 생긴다
        // (ReceiveSheet 가 기준선으로 프리필은 그대로 지켜준다).
        setActive(matched);
        setScanBump(step);
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
        <ScreenHeader title="발주 입고" backTo="/inbound" />
        <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title={purchaseOrder?.supplier?.name ?? '발주 입고'} backTo="/inbound" />

      {notice ? (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          {notice}
        </p>
      ) : null}

      {fresh ? (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-sm text-green-900">
            {fresh.skuName} {fresh.quantity}개 입고됨
            {/* 간편입고 적치 대기 행과 같은 어휘("잔여 N개 · M개 적치됨")를 쓴다 —
                두 화면의 부분 적치 진행 표시를 맞추기로 한 결정. */}
            {fresh.putawayDoneQty >= fresh.quantity
              ? ' · 적치 완료'
              : fresh.putawayDoneQty > 0
                ? ` · 잔여 ${fresh.quantity - fresh.putawayDoneQty}개 · ${fresh.putawayDoneQty}개 적치됨`
                : ''}
          </p>
          <div className="flex gap-2">
            {fresh.putawayDoneQty < fresh.quantity ? (
              <Button type="button" className="flex-1 py-1.5 text-xs" onClick={() => setPutawayOpen(true)}>
                적치하기
              </Button>
            ) : null}
            {/* 취소는 적치 전에만 가능하다 — 서버가 putawayFromOriginQty > 0 이면 거부한다.
                부분 적치도 그 조건에 걸리므로 누계가 0 일 때만 노출한다.
                확인 다이얼로그가 뜬 동안은 감춘다 — 다이얼로그도 [취소] 버튼을 쓰므로
                접근성 이름이 겹치고, 배너 쪽은 어차피 조작할 대상이 아니다. */}
            {fresh.putawayDoneQty === 0 && !cancelConfirm ? (
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
        <h2 className="text-sm font-semibold text-gray-700">발주 품목</h2>
        {arrivals.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(arrivals.error, 'po-receive')}
          </p>
        ) : arrivals.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-gray-500">남은 발주 품목이 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((item) => (
              <li
                key={item.skuId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{item.skuName}</span>
                  <span className="block font-mono text-xs text-gray-500">{item.skuCode}</span>
                  <span className="block text-xs text-gray-500">
                    발주 {item.orderedQty} · 입고 {item.receivedQty} · 남은 {item.outstandingQty}
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

      {activeItem ? (
        <ReceiveSheet
          item={activeItem}
          scanBump={scanBump}
          pending={receive.isPending}
          error={receive.isError ? errorMessage(receive.error, 'po-receive') : null}
          onCancel={closeSheet}
          onSubmit={(quantity) => submitReceive(activeItem, quantity)}
        />
      ) : null}

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
            {
              receiptLineId: fresh.lineId,
              idempotencyKey: cancelKeyFor(fresh.lineId),
            },
            {
              onSuccess: () => {
                cancelKeyRef.current = null;
                setFresh(null);
              },
            }
          );
        }}
      />

      {putawayOpen && fresh ? (
        <PutawaySheet
          target={{
            lineId: fresh.lineId,
            skuName: fresh.skuName,
            skuCode: fresh.skuCode,
            pendingQty: fresh.quantity - fresh.putawayDoneQty,
            originLocationCode: '입고기본존',
          }}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayOpen(false)}
          onDone={(dest, quantity) => {
            setLastDest(dest);
            setPutawayOpen(false);
            setFresh((prev) =>
              prev ? { ...prev, putawayDoneQty: prev.putawayDoneQty + quantity } : prev
            );
          }}
        />
      ) : null}
    </div>
  );
}
