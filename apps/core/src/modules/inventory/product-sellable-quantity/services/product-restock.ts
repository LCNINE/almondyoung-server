import { formatInTimeZone } from 'date-fns-tz';

export interface RestockSchedule {
  inboundDate: string | null;
  inboundApproximate: boolean;
  inboundSource: 'manual' | 'purchase_order' | null;
}

export function restockToday(now = new Date()): string {
  return formatInTimeZone(now, 'Asia/Seoul', 'yyyy-MM-dd');
}

export function resolveRestockSchedule(
  policy: { restockDate?: string | null; restockApproximate?: boolean } | undefined,
  arrivals: Array<{ expectedArrival: string; approximate: boolean }>,
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

  return {
    inboundDate: earliest,
    inboundApproximate: eligible.some((arrival) => arrival.expectedArrival === earliest && arrival.approximate),
    inboundSource: 'purchase_order',
  };
}
