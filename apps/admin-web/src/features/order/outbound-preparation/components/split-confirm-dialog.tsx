'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { PreparationShipmentDto } from '@/lib/types/dto/fulfillment';
import { kstToday } from '@/features/order/matching/lib/date-key';
import { incomingText } from '../blocked-copy';
import {
  isSplittableUnreserved,
  plannedOrderText,
  splitQuantities,
  waitingProducts,
} from '../preparation-model';

/** 나누기 전에 송장이 몇 장이 되는지, 무엇을 언제까지 기다리는지 보이고 기다릴 상자를 여기서 뺀다. */
export function SplitConfirmDialog({
  shipments,
  onClose,
  onConfirm,
}: {
  shipments: PreparationShipmentDto[];
  onClose: () => void;
  onConfirm: (shipmentIds: string[]) => void;
}) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const splittable = shipments.filter(isSplittableUnreserved);
  const consolidated = shipments.filter(
    (shipment) => !isSplittableUnreserved(shipment)
  );
  const chosen = splittable.filter(
    ({ shipmentId }) => !excluded.includes(shipmentId)
  );
  const excludedCount = splittable.length - chosen.length;
  const totals = splitQuantities(chosen.flatMap(({ lines }) => lines ?? []));
  const today = kstToday();
  const products = waitingProducts(chosen, today);

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            부분출고 {chosen.length}건을 나눌까요?
          </AlertDialogTitle>
          <AlertDialogDescription>
            재고가 있는 만큼은 지금 보낼 상자로, 모자란 만큼은 출고불가 상자로
            나눠요.
          </AlertDialogDescription>
          {chosen.length > 0 && (
            <p className="text-sm text-foreground">
              지금 재고로는 상자 {chosen.length}개가 {chosen.length * 2}개로
              나뉘어 송장도 {chosen.length * 2}장 필요해요.
            </p>
          )}
          {totals.now + totals.wait > 0 && (
            <p className="text-sm font-semibold text-foreground">
              지금 보낼 상품 {totals.now}개, 기다릴 상품 {totals.wait}개
            </p>
          )}
        </AlertDialogHeader>
        {products.length > 0 && (
          <ul
            role="list"
            aria-label="기다릴 상품"
            className="max-h-72 space-y-3 overflow-y-auto text-sm"
          >
            {products.map((product) => (
              <li
                key={product.skuId}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0 break-keep">
                  <span className="block font-medium text-foreground">
                    {product.name}
                  </span>
                  <span className="block tabular-nums text-muted-foreground">
                    상자 {product.shipmentIds.length}개에서 {product.qty}개
                    기다림
                  </span>
                  <span className="block text-muted-foreground">
                    {incomingText(product.stock, today)}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  aria-label={`${product.name} 기다리는 ${product.shipmentIds.length}건 빼기`}
                  onClick={() =>
                    setExcluded((previous) => [
                      ...previous,
                      ...product.shipmentIds,
                    ])
                  }
                >
                  {product.shipmentIds.length}건 빼기
                </Button>
              </li>
            ))}
          </ul>
        )}
        {excludedCount > 0 && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground"
          >
            <span>{excludedCount}건은 나누지 않고 부분출고에 그대로 둬요.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setExcluded([])}
            >
              뺀 상자 되돌리기
            </Button>
          </div>
        )}
        {consolidated.length > 0 && (
          <div className="text-sm text-foreground">
            <p>
              합포장한 상자 {consolidated.length}건은 여기서 나눌 수 없어
              뺐어요. 상자 상세에서 나눠 주세요.
            </p>
            <ul
              role="list"
              aria-label="합포장한 상자"
              className="mt-1 max-h-24 space-y-1 overflow-y-auto"
            >
              {consolidated.map((shipment) => (
                <li key={shipment.shipmentId}>
                  <Link
                    href={`/order/fulfillments?shipmentId=${encodeURIComponent(shipment.shipmentId)}`}
                    className="text-primary underline underline-offset-2"
                  >
                    {plannedOrderText(shipment)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={chosen.length === 0}
            onClick={() =>
              onConfirm(chosen.map(({ shipmentId }) => shipmentId))
            }
          >
            나누기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
