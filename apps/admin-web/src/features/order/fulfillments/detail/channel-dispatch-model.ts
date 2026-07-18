export type ChannelDispatchProjectionStatus =
  | 'pending'
  | 'succeeded'
  | 'recovery_required'
  | 'manual_adjustment_required';

export interface ChannelDispatchOperation {
  dispatchAttemptId: string;
  shipmentId: string;
  salesOrderId: string;
  operation: 'dispatch' | 'delivery' | 'recall';
  channel: string;
  externalOrderId: string;
  status: ChannelDispatchProjectionStatus;
  attempts: number;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  updatedAt: string;
}

export interface ChannelDispatchQueryTarget {
  dispatchAttemptId: string;
  salesOrderId: string;
}

interface ShipmentForChannelDispatch {
  lines: Array<{
    id: string;
    origin: { salesOrderId: string } | null;
  }>;
  dispatchAttempts: Array<{
    id: string;
    sources: Array<{ shipmentLineId: string }>;
  }>;
}

export interface ChannelDispatchRead {
  target: ChannelDispatchQueryTarget;
  availability: 'loading' | 'ready' | 'error';
  operations: ChannelDispatchOperation[];
}

export interface ChannelDispatchAttemptProjection {
  dispatchAttemptId: string;
  orders: Array<{
    salesOrderId: string;
    availability: ChannelDispatchRead['availability'];
    operations: ChannelDispatchOperation[];
  }>;
}

export interface ChannelDispatchViewModel {
  attempts: ChannelDispatchAttemptProjection[];
  manualOperations: ChannelDispatchOperation[];
  hasUnavailable: boolean;
  hasLoading: boolean;
}

export function buildChannelDispatchTargets(
  shipment: ShipmentForChannelDispatch
): ChannelDispatchQueryTarget[] {
  const salesOrderByLineId = new Map(
    shipment.lines.flatMap((line) =>
      line.origin ? [[line.id, line.origin.salesOrderId] as const] : []
    )
  );
  const seen = new Set<string>();
  const targets: ChannelDispatchQueryTarget[] = [];

  for (const attempt of shipment.dispatchAttempts) {
    for (const source of attempt.sources) {
      const salesOrderId = salesOrderByLineId.get(source.shipmentLineId);
      if (!salesOrderId) continue;
      const key = `${attempt.id}:${salesOrderId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ dispatchAttemptId: attempt.id, salesOrderId });
    }
  }
  return targets;
}

export function buildChannelDispatchViewModel(
  reads: ChannelDispatchRead[]
): ChannelDispatchViewModel {
  const attemptMap = new Map<string, ChannelDispatchAttemptProjection>();
  const manualOperations: ChannelDispatchOperation[] = [];

  for (const read of reads) {
    const attempt = attemptMap.get(read.target.dispatchAttemptId) ?? {
      dispatchAttemptId: read.target.dispatchAttemptId,
      orders: [],
    };
    attempt.orders.push({
      salesOrderId: read.target.salesOrderId,
      availability: read.availability,
      operations: read.operations,
    });
    attemptMap.set(read.target.dispatchAttemptId, attempt);
    manualOperations.push(
      ...read.operations.filter(
        (operation) => operation.status === 'manual_adjustment_required'
      )
    );
  }

  return {
    attempts: [...attemptMap.values()],
    manualOperations,
    hasUnavailable: reads.some((read) => read.availability === 'error'),
    hasLoading: reads.some((read) => read.availability === 'loading'),
  };
}
