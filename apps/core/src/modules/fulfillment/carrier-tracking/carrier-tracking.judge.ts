import { addBusinessDaysKst } from '../order-progress/order-progress.thresholds';
import type { CarrierScan, CarrierScanStatus } from '../waybill/carrier/carrier-gateway.interface';

/** 자동 조회는 매시 한 번이다. 이만큼 답을 못 받았으면 마지막으로 본 상태를 «지금»이라고 말하지 않는다. */
export const TRACKING_STALE_MS = 3 * 60 * 60 * 1000;

/**
 * 출고 후 이 기간이 지난 운송장은 자동으로 부르지 않는다. 공동현관 비번 백스톱(`EntrancePasswordCleaner`)의
 * 보관 상한과 같은 14일이다.
 */
export const CARRIER_TRACKING_WINDOW_DAYS = 14;
const WINDOW_MS = CARRIER_TRACKING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** 먼저 볼 것부터. 목록 순서도 이 순서다. */
export const CARRIER_ATTENTION_KINDS = [
  'recalled_but_moving',
  'invalid_waybill',
  'canceled',
  'pickup_missed',
  'undeliverable',
  'not_applied',
  'no_scan',
  'unverified',
  'poll_ended',
] as const;
export type CarrierAttentionKind = (typeof CARRIER_ATTENTION_KINDS)[number];

export type TrackingCheckFacts = {
  attemptedAt: Date;
  outcome: 'scans' | 'no_scan' | 'rejected' | 'unknown';
  errorCode: string | null;
  answeredAt: Date | null;
  scanCode: string | null;
  scanStatus: string | null;
  scanAt: Date | null;
  scanLocation: string | null;
  scanReason: string | null;
  acceptedScanAt: Date | null;
};

export type TrackingConfirmationFacts = {
  id: string;
  kind: string;
  scanKey: string;
  outcome: 'wait' | 'closed';
  resumeAt: Date | null;
  note: string;
  actorId: string;
  createdAt: Date;
};

export type TrackingFacts = {
  attemptStatus: string;
  shipmentStatus: string;
  dispatchedAt: Date;
  carrierAcceptedAt: Date | null;
  check: TrackingCheckFacts | null;
  confirmation: TrackingConfirmationFacts | null;
};

export type TrackingJudgement = {
  /** 사람이 확인해야 하는 이유. 없으면 정상이거나 우리가 더 볼 일이 없다. */
  kind: CarrierAttentionKind | null;
  /** 지금 확인할 일로 띄운다 — 확인 기록으로 내려 둔 것은 false */
  raised: boolean;
  /** 집하 스캔이 이때까지 없으면 확인할 일이 된다 */
  dueAt: Date;
  scanKey: string;
  accepted: boolean;
};

export function trackingDueAt(dispatchedAt: Date): Date {
  return addBusinessDaysKst(dispatchedAt, 1);
}

export function confirmationResumeAt(now: Date): Date {
  return addBusinessDaysKst(now, 1);
}

/** 사람이 본 마지막 스캔. 이 값이 바뀌면 앞선 확인 기록은 지난 일이다. */
export function scanKeyOf(check: TrackingCheckFacts | null): string {
  if (!check) return '';
  if (check.outcome === 'rejected') return `rejected:${check.errorCode ?? ''}`;
  if (!check.scanCode || !check.scanAt) return '';
  return `${check.scanCode}@${check.scanAt.toISOString()}`;
}

export function judgeTracking(facts: TrackingFacts, now: Date): TrackingJudgement {
  const { check } = facts;
  const accepted = facts.carrierAcceptedAt !== null || (check?.acceptedScanAt ?? null) !== null;
  const dueAt = trackingDueAt(facts.dispatchedAt);
  const scanKey = scanKeyOf(check);
  const kind = attentionKind(facts, accepted, dueAt, now);
  return {
    kind,
    raised: kind !== null && !settledBy(facts.confirmation, kind, scanKey, now),
    dueAt,
    scanKey,
    accepted,
  };
}

function attentionKind(facts: TrackingFacts, accepted: boolean, dueAt: Date, now: Date): CarrierAttentionKind | null {
  const { check } = facts;
  if (facts.attemptStatus === 'recalled') return accepted ? 'recalled_but_moving' : null;
  if (facts.attemptStatus !== 'dispatched') return null;
  if (facts.shipmentStatus !== 'shipped' && facts.shipmentStatus !== 'in_transit') return null;
  if (check?.outcome === 'rejected') return 'invalid_waybill';
  if (check?.scanStatus === 'canceled') return 'canceled';
  if (check?.scanStatus === 'pickup_missed') return 'pickup_missed';
  if (check?.scanStatus === 'failed') return 'undeliverable';
  if (check?.scanStatus === 'delivered') return 'not_applied';
  if (now.getTime() - facts.dispatchedAt.getTime() > WINDOW_MS) return 'poll_ended';
  if (accepted || now.getTime() < dueAt.getTime()) return null;
  const answeredAt = check?.answeredAt ?? null;
  return answeredAt !== null && now.getTime() - answeredAt.getTime() <= TRACKING_STALE_MS ? 'no_scan' : 'unverified';
}

/** 조회가 되다 말다 해도 «집하 스캔이 없다»는 같은 일이다 — 확인 기록이 풀리지 않게 한다. */
export function attentionFamily(kind: string): string {
  return kind === 'unverified' ? 'no_scan' : kind;
}

function settledBy(
  confirmation: TrackingConfirmationFacts | null,
  kind: CarrierAttentionKind,
  scanKey: string,
  now: Date,
): boolean {
  if (!confirmation || confirmation.scanKey !== scanKey) return false;
  if (confirmation.outcome === 'closed') return true;
  return (
    attentionFamily(confirmation.kind) === attentionFamily(kind) &&
    confirmation.resumeAt !== null &&
    now.getTime() < confirmation.resumeAt.getTime()
  );
}

export type ScanSummary = {
  latest: CarrierScan | null;
  acceptedScanAt: Date | null;
};

const ACCEPTED_STATUSES: ReadonlySet<CarrierScanStatus> = new Set(['in_transit', 'delivered']);

/** 우리 표에 없는 코드와 시각을 못 읽는 스캔은 세지 않는다. 같은 시각이면 뒤에 온 것이 최근이다. */
export function summarizeScans(scans: CarrierScan[]): ScanSummary {
  let latest: CarrierScan | null = null;
  let acceptedScanAt: Date | null = null;
  for (const scan of scans) {
    const at = scan.occurredAt.getTime();
    if (!Number.isFinite(at) || scan.status === 'unknown') continue;
    if (!latest || at >= latest.occurredAt.getTime()) latest = scan;
    if (ACCEPTED_STATUSES.has(scan.status) && (!acceptedScanAt || at < acceptedScanAt.getTime())) {
      acceptedScanAt = scan.occurredAt;
    }
  }
  return { latest, acceptedScanAt };
}
