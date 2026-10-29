import type {
  ConsolidationOption,
  ConsolidationOptionShipment,
  ConsolidationProgressSource,
  CreateShipmentConsolidationRequest,
} from '@/lib/types/dto/fulfillment';

export type ConsolidationStep = 'exclude' | 'unpick' | 'void' | 'auto';

export type SourceProgress =
  | { step: ConsolidationStep }
  | {
      step: 'stuck';
      reason: 'dispatch_attempt' | 'waybill_not_registered' | 'short_pick';
    };

const STEP_ORDER: ConsolidationStep[] = ['exclude', 'unpick', 'void', 'auto'];

// 막힘은 없는데 재개가 안 되는 경우는 가리지 않고 리컨실러 포기(gaveUp)로만 드러낸다.
export function sourceProgress(
  source: ConsolidationProgressSource
): SourceProgress {
  const has = (code: string) => source.blockers.includes(code);

  if (has('DISPATCH_ATTEMPT_EXISTS')) {
    return { step: 'stuck', reason: 'dispatch_attempt' };
  }

  if (
    has('ACTIVE_WORK_ITEM') &&
    source.workItemStatus === 'short_pick_recovery'
  ) {
    return { step: 'stuck', reason: 'short_pick' };
  }

  if (has('ACTIVE_INVOICE') && source.waybillStatus !== 'registered') {
    return { step: 'stuck', reason: 'waybill_not_registered' };
  }

  if (has('ACTIVE_WORK_ITEM')) {
    return {
      step: source.workItemStatus === 'withdrawing' ? 'unpick' : 'exclude',
    };
  }

  if (has('CUSTODY_REQUIRES_UNPICK')) {
    return { step: 'unpick' };
  }

  if (has('ACTIVE_INVOICE')) {
    return { step: 'void' };
  }

  return { step: 'auto' };
}

const rank = (progress: SourceProgress): number =>
  progress.step === 'stuck' ? -1 : STEP_ORDER.indexOf(progress.step);

export function overallProgress(sources: ConsolidationProgressSource[]): {
  current: SourceProgress;
  shipmentId: string;
  trackingNo: string | null;
  gaveUp: boolean;
} {
  let laggard: ConsolidationProgressSource | null = null;
  let laggardProgress: SourceProgress = { step: 'auto' };

  for (const source of sources) {
    const progress = sourceProgress(source);

    if (laggard === null || rank(progress) < rank(laggardProgress)) {
      laggard = source;
      laggardProgress = progress;
    }
  }

  return {
    current: laggardProgress,
    shipmentId: laggard?.shipmentId ?? '',
    trackingNo: laggard?.trackingNo ?? null,
    gaveUp: sources.some((source) => source.gaveUpAt !== null),
  };
}

export function buildConsolidationRequest(input: {
  source: ConsolidationOptionShipment;
  picked: ConsolidationOptionShipment[];
  memoFrom: string;
  reason: string;
}): CreateShipmentConsolidationRequest {
  return {
    sources: [input.source, ...input.picked].map((shipment) => ({
      shipmentId: shipment.shipmentId,
      expectedManifestVersion: shipment.manifestVersion,
      expectedReservationVersion: shipment.reservationVersion,
    })),
    recipientSourceShipmentId: input.memoFrom,
    reason: input.reason,
  };
}

const NO_MEMO = '메모 없음';

function deliveryNoteOf(shipment: ConsolidationOptionShipment): string {
  const note = shipment.recipientSnapshot.deliveryNote;

  return typeof note === 'string' && note.trim() !== '' ? note : NO_MEMO;
}

// 서버가 판정한 reason 으로만 갈린다. 받는 사람 문자열은 가려져 올 수 있어 비교하지 않는다.
export function memoChoices(
  source: ConsolidationOptionShipment,
  picked: ConsolidationOption[]
): Array<{ shipmentId: string; label: string; orderNo: string }> {
  if (!picked.some((option) => option.reason === 'memo_differs')) {
    return [];
  }

  const memoDiffers = picked.filter(
    (option) => option.reason === 'memo_differs'
  );

  // reason 이 ok 인 상자는 기준 상자와 메모가 같으니 기준 선택지가 대신한다.
  return [source, ...memoDiffers].map((shipment) => ({
    shipmentId: shipment.shipmentId,
    label: deliveryNoteOf(shipment),
    orderNo: shipment.salesOrderNos[0] ?? '',
  }));
}
