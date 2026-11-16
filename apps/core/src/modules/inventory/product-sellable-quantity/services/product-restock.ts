import { formatInTimeZone } from 'date-fns-tz';

export type RestockSource = 'manual' | 'purchase_order' | 'inbound_shipment';

export interface RestockArrival {
  expectedArrival: string;
  approximate: boolean;
  source: 'purchase_order' | 'inbound_shipment';
}

export interface RestockSchedule {
  inboundDate: string | null;
  inboundApproximate: boolean;
  inboundSource: RestockSource | null;
}

export function restockToday(now = new Date()): string {
  return formatInTimeZone(now, 'Asia/Seoul', 'yyyy-MM-dd');
}

export function resolveRestockSchedule(
  policy: { restockDate?: string | null; restockApproximate?: boolean } | undefined,
  arrivals: RestockArrival[],
  stockBoundQuantity: number,
  today: string,
): RestockSchedule {
  const empty: RestockSchedule = { inboundDate: null, inboundApproximate: false, inboundSource: null };

  if (stockBoundQuantity > 0) {
    return empty;
  }

  if (policy?.restockDate && policy.restockDate >= today) {
    return {
      inboundDate: policy.restockDate,
      inboundApproximate: policy.restockApproximate ?? false,
      inboundSource: 'manual',
    };
  }

  const eligible = arrivals.filter((arrival) => arrival.expectedArrival >= today);
  const earliest = eligible.reduce<string | null>(
    (date, arrival) => (date === null || arrival.expectedArrival < date ? arrival.expectedArrival : date),
    null,
  );

  if (!earliest) {
    return empty;
  }

  const winners = eligible.filter((arrival) => arrival.expectedArrival === earliest);

  return {
    inboundDate: earliest,
    inboundApproximate: winners.some((arrival) => arrival.approximate),
    // 같은 날이면 발주를 먼저 표시한다(고정 순서)
    inboundSource: winners.some((arrival) => arrival.source === 'purchase_order') ? 'purchase_order' : 'inbound_shipment',
  };
}
