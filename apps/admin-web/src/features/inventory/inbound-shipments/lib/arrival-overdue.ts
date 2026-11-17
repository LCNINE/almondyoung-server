import type { InboundShipmentStatus } from '@/lib/types/dto/inbound-shipment';

const day = (v: string) => v.slice(0, 10);

/** 아직 오는 중(expected·receiving)인데 도착 예정일이 오늘(KST yyyy-MM-dd)보다 앞이면 true. */
export function isArrivalOverdue(
  status: InboundShipmentStatus,
  expectedArrival: string | null,
  today: string
): boolean {
  if (status !== 'expected' && status !== 'receiving') return false;
  return expectedArrival !== null && day(expectedArrival) < today;
}

/** 처음 약속한 날과 지금 예정일이 둘 다 있고 다를 때만 «처음 예정» 을 보인다. */
export function showPromisedArrival(
  expectedArrival: string | null,
  promisedArrival: string | null
): boolean {
  return (
    expectedArrival !== null &&
    promisedArrival !== null &&
    day(expectedArrival) !== day(promisedArrival)
  );
}

/** yyyy-MM-dd → M/D */
export function formatMonthDay(date: string): string {
  const [, m, d] = day(date).split('-');
  return `${Number(m)}/${Number(d)}`;
}
