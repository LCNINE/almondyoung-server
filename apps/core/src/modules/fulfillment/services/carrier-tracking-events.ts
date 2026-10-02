import type { CarrierCode, CarrierScan } from '../waybill/carrier/carrier-gateway.interface';
import type { ShipmentTrackingEventDto } from '../dto/shipment-tracking-event.dto';

/**
 * 캐리어 스캔 이력을 수신 경로(`ShipmentDeliveryTrackingService.recordProviderEvent`)가 받는 이벤트로 옮긴다.
 *
 * - **in_transit·delivered 만 넘긴다.** 수신 경로가 아는 상태가 그 둘뿐이다. `pending`(예약·출력)은 출고
 *   전 단계라 의미가 없고, `unknown` 은 «건너뛴다» — `pending` 처럼 읽으면 배송 중인 운송장이 뒤로 간다.
 *   `pickup_missed`(08)·`failed`(92)·`canceled`(03)는 받을 자리가 아직 없다(#917 에서 별도 이슈로 분리).
 * - **출고 시각보다 앞선 스캔은 버린다.** 수신 경로가 409 로 거절하므로 매 주기 같은 409 를 쌓을 뿐이다.
 * - **`providerEventId` 는 `캐리어:작업상태코드:발생시각`** 이다. 한진은 스캔별 id 를 주지 않는다. 같은
 *   스캔은 매 주기 같은 id 가 되므로 재전송은 수신 경로에서 멱등 재생으로 끝난다.
 */
export function carrierScansToTrackingEvents(
  carrier: CarrierCode,
  scans: CarrierScan[],
  dispatchedAt: Date,
): ShipmentTrackingEventDto[] {
  const seen = new Set<string>();
  const events: Array<{ at: number; event: ShipmentTrackingEventDto }> = [];
  for (const scan of scans) {
    if (scan.status !== 'in_transit' && scan.status !== 'delivered') continue;
    const at = scan.occurredAt.getTime();
    if (!Number.isFinite(at) || at < dispatchedAt.getTime()) continue;
    const occurredAt = scan.occurredAt.toISOString();
    const providerEventId = `${carrier}:${scan.statusCode}:${occurredAt}`;
    if (seen.has(providerEventId)) continue;
    seen.add(providerEventId);
    events.push({
      at,
      event: {
        providerEventId,
        status: scan.status,
        occurredAt,
        ...(scan.location ? { location: scan.location } : {}),
      },
    });
  }
  return events.sort((a, b) => a.at - b.at).map(({ event }) => event);
}
