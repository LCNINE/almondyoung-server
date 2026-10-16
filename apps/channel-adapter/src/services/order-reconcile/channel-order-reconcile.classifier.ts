import type { ChannelOrderSnapshot } from '../order-collection/channel-order-source.interface';
import type { FindingHandling, FindingKind, HumanReason, ReconcileMode } from './order-reconcile.types';
import { CancelNotAppliedRule } from './rules/cancel-not-applied.rule';
import { MissingOrderRule } from './rules/missing-order.rule';

const MINUTE = 60 * 1000;
export const RECONCILE_WINDOW_MS = 3 * 24 * 60 * MINUTE;
export const RECONCILE_GRACE_MS = 30 * MINUTE;
/** 폴러의 lookback(`order-poller.orchestrator.ts` WATERMARK_LOOKBACK_MS)과 같은 값. */
export const POLL_LOOKBACK_MS = 2 * MINUTE;
export const MAX_REDELIVERY_ATTEMPTS = 3;
/** 셀메이트 스크립트가 쓴 `shipped` 등에 취소를 보내면 core 가 거절한다(스펙 D6). */
const AUTO_CANCEL_CORE_STATUSES: ReadonlySet<string> = new Set(['pending', 'confirmed']);

export const RECONCILE_RULES: Record<FindingKind, { mode: ReconcileMode }> = {
  missing_order: new MissingOrderRule(),
  cancel_not_applied: new CancelNotAppliedRule(),
};

export interface ClassifyInput {
  snapshot: Pick<ChannelOrderSnapshot, 'externalOrderId' | 'paymentState' | 'sourceUpdatedAt' | 'createdAt' | 'lifecycle'>;
  wmsOrderId: string | null;
  openQuarantine: boolean;
  adapterOutboxFailed: boolean;
  core: { salesOrderStatus: string | null; openEventFailure: boolean };
  /** 이미 열린 행의 시도 수. 종류는 판정 뒤에야 알므로 함수로 받는다. */
  attemptCountFor: (kind: FindingKind) => number;
  pollWatermark: Date | null;
  now: Date;
}

export interface ClassifyVerdict {
  kind: FindingKind;
  handling: FindingHandling;
  humanReason: HumanReason | null;
  coreStatus: string | null;
}

/**
 * 채널 스냅샷 하나를 «core 에 있어야 하는 모양»과 비교한다(스펙 §5.3·§5.4). 기대값은 폴러가 쓰는 스냅샷 해석
 * (`paymentState`·lifecycle 관측) 그대로다 — 수집 조건을 여기서 다시 구현하지 않는다.
 * null = 정상이거나 아직 판정할 때가 아니다.
 */
export function classifyChannelOrder(input: ClassifyInput): ClassifyVerdict | null {
  const { snapshot, core, now } = input;
  if (input.openQuarantine) return null;
  if (!input.pollWatermark) return null;

  // 두 기준 중 «이른» 쪽보다 뒤면 아직 폴링·전달 중일 수 있다(계획 정정 1).
  const cutoff = Math.min(now.getTime() - RECONCILE_GRACE_MS, input.pollWatermark.getTime() - POLL_LOOKBACK_MS);
  if (new Date(snapshot.sourceUpdatedAt).getTime() > cutoff) return null;

  const cancelledOnChannel = snapshot.lifecycle.some((observation) => observation.eventType === 'OrderCancelled');
  const soStatus = core.salesOrderStatus;
  let kind: FindingKind;
  if (cancelledOnChannel) {
    if (!input.wmsOrderId) return null;
    if (soStatus === null) kind = 'missing_order';
    else if (soStatus === 'cancelled') return null;
    else kind = 'cancel_not_applied';
  } else if (snapshot.paymentState === 'accepted') {
    if (soStatus !== null) return null;
    kind = 'missing_order';
  } else {
    return null;
  }

  return { kind, coreStatus: soStatus, ...handlingFor(kind, input) };
}

function handlingFor(
  kind: FindingKind,
  input: ClassifyInput,
): { handling: FindingHandling; humanReason: HumanReason | null } {
  const human = (humanReason: HumanReason) => ({ handling: 'human' as const, humanReason });
  if (input.adapterOutboxFailed || input.core.openEventFailure) return human('event_failure_open');
  if (input.attemptCountFor(kind) >= MAX_REDELIVERY_ATTEMPTS) return human('attempts_exhausted');
  if (kind === 'missing_order') {
    const age = input.now.getTime() - new Date(input.snapshot.createdAt).getTime();
    if (age > RECONCILE_WINDOW_MS) return human('out_of_window');
  }
  if (kind === 'cancel_not_applied' && !AUTO_CANCEL_CORE_STATUSES.has(input.core.salesOrderStatus ?? '')) {
    return human('core_status');
  }
  return { handling: 'auto', humanReason: null };
}
