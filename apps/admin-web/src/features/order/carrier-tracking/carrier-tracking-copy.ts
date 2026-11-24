import { formatDwell } from '@/lib/utils/format-dwell';
import type {
  CarrierAttentionKind,
  CarrierTrackingConfirmation,
  CarrierTrackingItem,
  CarrierTrackingSummary,
} from '@/lib/api/domains/orders/carrier-tracking.client';

export const CARRIER_ATTENTION_HREF = '/order/stall-board?stage=track';

const SCAN_STATUS: Record<string, string> = {
  pending: '집하 전',
  in_transit: '배송 중',
  pickup_missed: '미집하',
  failed: '배송불가',
  canceled: '예약취소',
  delivered: '배송완료',
};
export const scanStatusLabel = (status: string) =>
  SCAN_STATUS[status] ?? status;

const HANJIN_SCAN: Record<string, string> = {
  '01': '예약등록',
  '03': '예약취소',
  '05': '운송장출력',
  '07': '집하출발',
  '08': '미집하',
  '11': '집하완료',
  '14': '입고',
  '31': '상품출발',
  '32': '상품도착',
  '63': '배송출발',
  '66': '배송완료',
  '92': '배송불가',
};

function scanLabel(item: CarrierTrackingItem): string {
  if (!item.scan) return '';
  const named =
    item.carrier === 'HANJIN' ? HANJIN_SCAN[item.scan.code] : undefined;
  return named ?? scanStatusLabel(item.scan.status);
}

export function ago(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  return ms < 60_000 ? '방금' : `${formatDwell(ms)} 전`;
}

const since = (iso: string, now: Date) =>
  formatDwell(Math.max(0, now.getTime() - new Date(iso).getTime()));

const withReason = (text: string, item: CarrierTrackingItem) =>
  item.scan?.reason ? `${text} · ${item.scan.reason}` : text;

/** 왜 확인해야 하는지. 정상이면 빈 문자열 */
export function attentionText(item: CarrierTrackingItem, now: Date): string {
  switch (item.kind) {
    case 'recalled_but_moving':
      return '되돌린 출고의 송장을 택배사가 가져갔어요 — 고객에게 두 번 갈 수 있어요';
    case 'invalid_waybill':
      return '택배사가 이 송장번호는 틀린 번호라고 답했어요';
    case 'canceled':
      return withReason('택배사에서 예약이 취소됐어요', item);
    case 'pickup_missed':
      return withReason('기사가 가져가지 못했어요(미집하)', item);
    case 'undeliverable':
      return withReason('배송하지 못했어요(배송불가)', item);
    case 'not_applied':
      return '택배사는 배송완료인데 우리 기록은 배송 전이에요';
    case 'no_scan':
      return `출고한 지 ${since(item.dispatchedAt, now)} · 택배사 집하 기록이 없어요`;
    case 'unverified':
      return `출고한 지 ${since(item.dispatchedAt, now)} · 택배사에 물어보지 못했어요`;
    case 'poll_ended':
      return item.accepted
        ? '출고한 지 14일이 지나 자동 조회를 멈췄어요 · 배송완료 기록이 없어요'
        : '출고한 지 14일이 지나 자동 조회를 멈췄어요 · 집하 기록이 없어요';
    default:
      return '';
  }
}

export const ATTENTION_TITLE: Record<CarrierAttentionKind, string> = {
  recalled_but_moving: '되돌린 송장을 택배사가 가져감',
  invalid_waybill: '송장번호 오류',
  canceled: '택배사 예약취소',
  pickup_missed: '미집하',
  undeliverable: '배송불가',
  not_applied: '배송완료가 반영되지 않음',
  no_scan: '집하 기록 없음',
  unverified: '택배사에 묻지 못함',
  poll_ended: '자동 조회 끝남',
};

/** 같은 이유끼리 묶는다 — 다음 할 일을 한 번만 말한다. 순서는 받은 순서(급한 것부터)다. */
export function groupByKind(
  items: CarrierTrackingItem[]
): { kind: CarrierAttentionKind; items: CarrierTrackingItem[] }[] {
  const groups = new Map<CarrierAttentionKind, CarrierTrackingItem[]>();
  for (const item of items) {
    if (!item.kind) continue;
    groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
  }
  return [...groups].map(([kind, rows]) => ({ kind, items: rows }));
}

/** 이 상자를 어떻게 끝내는지. 되돌리기 권한이 없는 사람에게는 넘길 사람을 말한다. */
export function nextStepText(
  kind: CarrierAttentionKind | null,
  canRecall: boolean
): string {
  const recall = canRecall
    ? '상자가 창고에 있으면 «상자 상세»에서 출고를 되돌린 뒤 다시 출고 준비하세요.'
    : '상자가 창고에 있으면 물류 관리자에게 송장번호를 알리고 출고 되돌리기를 맡기세요.';
  const handed =
    '이미 넘겼으면 택배사에 송장번호로 확인하고 «확인 기록»을 남기세요.';
  switch (kind) {
    case 'recalled_but_moving':
      return '다시 출고하기 전에 택배사에 송장번호로 확인하세요. 새 송장으로 이미 나갔으면 택배사에 회수를 요청하고 «확인 기록»을 남기세요.';
    case 'invalid_waybill':
    case 'canceled':
    case 'pickup_missed':
    case 'no_scan':
      return `${recall} ${handed}`;
    case 'unverified':
      return `자동으로 다시 물어요. «지금 다시 조회»도 안 되면 택배사에 송장번호로 확인하세요. ${recall}`;
    case 'undeliverable':
      return '받는 분 연락처·주소를 확인해 택배사에 다시 배송을 요청하고 «확인 기록»을 남기세요. 반송되면 주문내역에서 반품을 접수하세요.';
    case 'not_applied':
      return '«지금 다시 조회»를 눌러도 그대로면 배송을 확인했다고 «확인 기록»에 적어 끝내세요. 고객 화면의 배송 상태는 바뀌지 않아요.';
    case 'poll_ended':
      return '«지금 다시 조회»로 다시 묻고, 그대로면 택배사에 송장번호로 확인해 결과를 «확인 기록»에 적으세요.';
    default:
      return '';
  }
}

/** 마지막으로 확인한 것 — 묻지 못했으면 언제 것인지 함께 말한다 */
export function lastCheckText(item: CarrierTrackingItem, now: Date): string {
  const scan = item.scan
    ? `최근 스캔 ${scanLabel(item)}${item.scan.location ? ` · ${item.scan.location}` : ''} · ${ago(item.scan.at, now)}`
    : '';
  const asked = !item.attemptedAt
    ? '아직 택배사에 묻지 않았어요'
    : item.lastOutcome === 'unknown'
      ? item.answeredAt
        ? `택배사가 답하지 않음 · 마지막 답 ${ago(item.answeredAt, now)}`
        : '택배사가 아직 한 번도 답하지 않았어요'
      : `${ago(item.attemptedAt, now)} 확인`;
  return [scan, asked].filter(Boolean).join(' · ');
}

/** 확인할 일이 아닐 때의 한 줄(상자 상세) */
export function normalText(item: CarrierTrackingItem, now: Date): string {
  if (item.recalled) return '되돌린 출고예요. 택배사가 가져간 기록은 없어요.';
  if (item.accepted) return '택배사가 받았어요.';
  if (new Date(item.dueAt) <= now) return '';
  return `집하를 기다리는 중 — ${kstDateTime(item.dueAt)}까지 집하 기록이 없으면 확인할 송장으로 떠요.`;
}

export function confirmationText(
  row: CarrierTrackingConfirmation,
  actorName: string
): string {
  const who = actorName || '담당자';
  const until =
    row.outcome === 'closed'
      ? '끝남'
      : `${row.resumeAt ? kstDateTime(row.resumeAt) : ''}까지 기다림`;
  return `${kstDateTime(row.createdAt)} ${who} · ${until} · ${row.note}`;
}

export function pollingText(
  polling: CarrierTrackingSummary['polling'],
  now: Date
): string {
  if (!polling.failing) return '';
  return polling.lastAnsweredAt
    ? `택배사 자동 조회가 안 되고 있어요(마지막 답 ${ago(polling.lastAnsweredAt, now)}). 아래는 그때까지 확인한 내용이고, 자동으로 다시 물어요.`
    : '택배사가 아직 한 번도 답하지 않았어요. 자동으로 다시 물어요.';
}

export function recheckResult(
  before: CarrierTrackingItem,
  after: CarrierTrackingItem | undefined,
  now: Date
): { tone: 'success' | 'info' | 'error'; text: string } {
  if (!after || after.lastOutcome === 'unknown') {
    return {
      tone: 'error',
      text: '택배사가 답하지 않았어요. 자동으로 다시 물어요.',
    };
  }
  if (after.kind !== null) {
    const same = after.kind === before.kind && after.scanKey === before.scanKey;
    return {
      tone: 'info',
      text: same
        ? '다시 물었지만 그대로예요.'
        : `다시 물었어요. ${attentionText(after, now)}`,
    };
  }
  return {
    tone: 'success',
    text:
      before.kind === null
        ? `다시 물었어요. ${after.accepted ? '택배사가 받았어요.' : '택배사 기록이 아직 없어요.'}`
        : '다시 물었어요. 확인할 것이 없어졌어요.',
  };
}

export function kstDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
