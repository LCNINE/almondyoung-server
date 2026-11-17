import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConsolidationItemList } from './consolidation-items';
import { itemsTotalText, type MergedItem } from './consolidation-sheet-model';

export type ConsolidationOutcome = {
  orderNos: string;
  items: MergedItem[] | null;
  // 바로 합쳐졌으면 새 상자, 출고 준비가 시작된 상자가 있어 기다리면 null
  targetShipmentId: string | null;
  warehouseId: string | null;
  progressShipmentId: string;
};

export function preparationHref(
  shipmentId: string,
  warehouseId: string | null
): string {
  const params = new URLSearchParams(
    warehouseId ? { warehouseId, prepare: shipmentId } : { prepare: shipmentId }
  );

  return `/order/waybill-issue?${params}`;
}

export function progressHref(shipmentId: string): string {
  return `/order/fulfillments?${new URLSearchParams({ shipmentId })}`;
}

export function ConsolidationOutcomeView({
  outcome,
  onPrepare,
}: {
  outcome: ConsolidationOutcome;
  onPrepare?: (shipmentId: string) => void;
}) {
  const { targetShipmentId, items } = outcome;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm break-keep">
        {targetShipmentId
          ? `주문 ${outcome.orderNos} → 새 상자 1개`
          : `주문 ${outcome.orderNos} 은 출고 준비가 시작된 상자가 있어 아직 합쳐지지 않았어요. 상자 화면에서 남은 순서를 확인해 주세요.`}
      </p>
      {targetShipmentId && items ? (
        <div className="rounded-md bg-muted px-3 py-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            새 상자 · {itemsTotalText(items)}
          </div>
          <ConsolidationItemList
            label={`주문 ${outcome.orderNos} 새 상자 상품`}
            items={items}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {targetShipmentId ? (
          onPrepare ? (
            <Button size="sm" onClick={() => onPrepare(targetShipmentId)}>
              이 상자 출고 준비
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link
                href={preparationHref(targetShipmentId, outcome.warehouseId)}
              >
                이 상자 출고 준비
              </Link>
            </Button>
          )
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link href={progressHref(outcome.progressShipmentId)}>
              진행 보기
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
