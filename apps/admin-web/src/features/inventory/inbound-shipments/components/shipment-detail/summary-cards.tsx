import type { InboundShipmentDetail } from '@/lib/types/dto/inbound-shipment';

/** 진행 상황판 — 0 인 카드도 숨기지 않고 흐리게 둔다. */
export function SummaryCards({
  shipment,
}: {
  shipment: InboundShipmentDetail;
}) {
  const s = shipment.summary;
  const cards: Array<[string, string, number]> = [
    ['상자 확정', `${s.boxesReceived}/${s.boxesTotalStock}`, s.boxesReceived],
    ['모자람', `${s.shortLines}`, s.shortLines],
    ['남음', `${s.overLines}`, s.overLines],
    ['안 옴', `${s.notArrivedLines}`, s.notArrivedLines],
    ['리스트에 없던 물건', `${s.unplannedCounts}`, s.unplannedCounts],
    ['전달용', `${s.forwardBoxes}`, s.forwardBoxes],
    ['리스트에 없던 상자', `${s.addedBoxes}`, s.addedBoxes],
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {cards.map(([label, text, n]) => (
        <div
          key={label}
          className={`min-w-28 rounded border px-3 py-2 ${n === 0 ? 'opacity-50' : ''}`}
        >
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-medium">{text}</div>
        </div>
      ))}
    </div>
  );
}
