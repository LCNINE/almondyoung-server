import type {
  BillingRecoveryOverview,
  OutstandingDebtCard,
  RecoveryCase,
} from '@/lib/api/domains/membership/recovery';
import type {
  MembershipNoticeLookup,
  MembershipNoticeStatus,
} from '@/lib/api/domains/alimtalk';
import { cmsFailureReason } from '@/lib/utils/cms-failure-reason';

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export const rate = (r: number | null): string =>
  r == null ? '-' : `${Math.round(r * 100)}%`;

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** 한국 시간 「10/3(금)」 */
export function kstDay(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]})`;
}

/** 한국 시간 「10/3(금) 08:00」 */
export function kstDayTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${kstDay(iso)} ${hh}:${mm}`;
}

/** 두 시각 사이 일수(소수 버림). 같은 날이면 0 */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(
    Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000),
    0
  );
}

export function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

/** 알림을 못 보낸 이유 */
export const NOTICE_SKIP_LABEL: Record<string, string> = {
  NO_PHONE: '전화번호 없음',
  NO_CONTACT: '회원 정보 없음',
  CONTACT_LOOKUP_FAILED: '연락처 조회 실패',
};

/** 해지됐는데 미납으로 남기지 않은 이유 */
export const NOT_RECORDED_LABEL: Record<string, string> = {
  TERMS_NOT_IN_FORCE: '새 약관(미납 조항) 동의 전 계약',
  WITHDRAWAL_ELIGIBLE: '이용 7일 안 · 혜택 안 씀(청약철회 대상)',
  NO_ENTITLEMENT: '이용권이 없었음',
  PERIOD_NOT_COVERED: '그 기간 이용권이 열리지 않았음',
  AMOUNT_UNKNOWN: '금액을 정할 수 없었음',
  UNRECORDED: '이유 기록 이전에 해지된 건',
};

/** 은행이 준 실패 사유. 원문이 없으면 코드 매핑, 그것도 없으면 코드 그대로 */
export function failureReason(
  c: Pick<RecoveryCase, 'lastErrorMessage' | 'lastErrorCode'>
): string {
  return (
    c.lastErrorMessage ??
    cmsFailureReason(c.lastErrorCode) ??
    (c.lastErrorCode ? `사유 코드 ${c.lastErrorCode}` : '사유 기록 없음')
  );
}

export function terminationLabel(c: RecoveryCase): string {
  if (c.terminationKind === 'MANDATE_REJECTED') {
    if (c.lastErrorCode === 'MANDATE_TIMEOUT')
      return '계좌 심사 기한 초과로 해지';
    return '계좌 심사 거절로 해지';
  }
  if (c.terminationKind === 'EXHAUSTED')
    return `${c.attempts}번 모두 실패해 해지`;
  if (c.terminationKind === 'VOIDED') return '청구가 취소돼 종료';
  return '다른 이유로 종료';
}

// ─── 알림 ────────────────────────────────────────────────────────────────────

export const attemptRef = (invoiceId: string, attemptNo: number) =>
  `attempt:${invoiceId}:${attemptNo}`;
export const terminatedRef = (contractId: string) => `terminated:${contractId}`;

/** 보드 카드에 붙일 안내의 접수 상태를 한 번에 묻기 위한 목록 */
export function noticeLookupFor(
  cases: RecoveryCase[],
  debts: OutstandingDebtCard[]
): MembershipNoticeLookup {
  const attempts: MembershipNoticeLookup['attempts'] = [];
  const terminations: MembershipNoticeLookup['terminations'] = [];
  for (const c of cases) {
    if (c.invoiceId)
      for (const n of c.attemptNotices)
        if (n.state === 'QUEUED')
          attempts.push({ invoiceId: c.invoiceId, attemptNo: n.attemptNo });
    if (c.finalNotice?.state === 'QUEUED')
      terminations.push({ contractId: c.contractId });
  }
  for (const d of debts)
    if (d.finalNotice?.state === 'QUEUED')
      terminations.push({ contractId: d.contractId });
  return { attempts, terminations };
}

export type NoticeTone = 'ok' | 'pending' | 'warn' | 'muted';

export interface NoticeBadge {
  tone: NoticeTone;
  text: string;
}

/**
 * 안내 한 건의 상태를 사람 말로. 멤버십 기록(접수함/못 보냄)과 알림 서비스 기록(카카오 접수/거절)을 합친다.
 * 알림 서비스를 못 물었으면(statuses 없음) 멤버십 기록만으로 말한다 — 「확인 못 함」을 「안 감」으로 바꾸지 않는다.
 */
export function noticeBadge(
  record:
    | { state: 'QUEUED' | 'SKIPPED'; reason: string | null }
    | null
    | undefined,
  ref: string | null,
  statuses: Map<string, MembershipNoticeStatus> | undefined,
  /** 정책·알림 시행 전에 일어난 일이라 원래 알림 대상이 아니었다 */
  beforePolicy = false
): NoticeBadge {
  if (!record)
    return {
      tone: 'muted',
      text: beforePolicy ? '시행 전 · 알림 대상 아님' : '알림 기록 없음',
    };
  if (record.state === 'SKIPPED')
    return {
      tone: 'warn',
      text: `알림 못 보냄 · ${NOTICE_SKIP_LABEL[record.reason ?? ''] ?? '이유 미상'}`,
    };
  const status = ref ? statuses?.get(ref) : undefined;
  if (!statuses || !status) return { tone: 'pending', text: '알림 보냄' };
  if (!status.found) return { tone: 'pending', text: '알림 보내는 중' };
  if (status.status === 'SENT')
    return {
      tone: 'ok',
      text: status.scheduledFor
        ? `카카오 접수 · ${status.scheduledFor.slice(5).replace('-', '/')} 예약`
        : '카카오 접수',
    };
  if (status.status === 'FAILED')
    return { tone: 'warn', text: '카카오 접수 실패' };
  return { tone: 'pending', text: '알림 보내는 중' };
}

/** 카드에 보일 «가장 최근» 회차 안내 */
export function latestAttemptNotice(c: RecoveryCase) {
  return c.attemptNotices.at(-1) ?? null;
}

/** 안내 기록이 하나도 없는 건이 정책 시행 전 실패뿐이라 알림 대상이 아니었는가 */
export function noNoticeBecauseBeforePolicy(c: RecoveryCase): boolean {
  return (
    c.attemptNotices.length === 0 &&
    c.attemptNoticesMissing.length === 0 &&
    c.attemptNoticesBeforePolicy.length > 0
  );
}

// ─── 정책 시행 전/후 ──────────────────────────────────────────────────────────

export type PolicyScope = 'UNDER' | 'BEFORE';

/** 「9/30」 — 시행 시각(KST) 날짜 */
export function policyDayLabel(
  o: Pick<BillingRecoveryOverview, 'policy'>
): string | null {
  if (!o.policy.effectiveAt) return null;
  const d = new Date(Date.parse(o.policy.effectiveAt) + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 고른 범위(시행 후/전)로 퍼널·지표·건 목록을 바꿔 끼운 현황. 보드·경보·추이는 «지금»이라 그대로 둔다.
 * 시행 전 건이 없는 달은 언제나 시행 후 그대로다.
 */
export function scopedOverview(
  o: BillingRecoveryOverview,
  scope: PolicyScope
): BillingRecoveryOverview {
  const era =
    scope === 'BEFORE' && o.beforePolicy ? 'BEFORE_POLICY' : 'UNDER_POLICY';
  const picked =
    era === 'BEFORE_POLICY' && o.beforePolicy
      ? o.beforePolicy
      : { funnel: o.funnel, kpis: o.kpis };
  return {
    ...o,
    funnel: picked.funnel,
    kpis: picked.kpis,
    cohort: { ...o.cohort, cases: o.cohort.cases.filter((c) => c.era === era) },
  };
}

// ─── 한 줄 브리핑 ─────────────────────────────────────────────────────────────

/** 숫자를 사람 문장으로 — 경영자가 표를 읽지 않아도 상황이 잡히게 */
export function briefing(
  o: BillingRecoveryOverview,
  scope: PolicyScope = 'UNDER'
): string[] {
  const f = o.funnel;
  const day = policyDayLabel(o);
  // 시행 전 건이 섞인 달에만 어느 쪽 숫자인지 붙인다
  const m =
    o.beforePolicy && day
      ? `${monthLabel(o.period.month)}(${day} 미납 정책 시행 ${scope === 'BEFORE' ? '전' : '후'} 시작분)`
      : monthLabel(o.period.month);
  const lines: string[] = [];

  if (f.withdrawalFailed.cases === 0 && f.mandateRejected.cases === 0) {
    lines.push(`${m}에는 출금 실패도, 계좌 거절 해지도 없었습니다.`);
  } else {
    const parts: string[] = [];
    if (f.withdrawalFailed.cases > 0)
      parts.push(
        `출금이 실패한 청구 ${f.withdrawalFailed.cases}건(${f.withdrawalFailed.people}명)`
      );
    const mandateOnly = f.mandateRejected.cases - countMandateAfterFailure(o);
    if (mandateOnly > 0) parts.push(`출금 전 계좌 거절 해지 ${mandateOnly}건`);
    lines.push(`${m}에 ${parts.join(', ')}이 있었습니다.`);

    if (f.withdrawalFailed.cases > 0) {
      const amount = `${won(f.recovered.amount)}${f.recovered.amountUnknownCases > 0 ? ` + 금액 기록 없는 ${f.recovered.amountUnknownCases}건` : ''}`;
      const r = f.recovered.cases;
      const e = f.exhausted.cases;
      if (r > 0 && e > 0)
        lines.push(
          `그중 ${r}건은 재시도로 받았고(${amount}), ${e}건은 끝내 실패해 해지됐습니다.`
        );
      else if (r > 0)
        lines.push(`그중 ${r}건은 재시도로 받았습니다(${amount}).`);
      else if (e > 0) lines.push(`그중 ${e}건은 끝내 실패해 해지됐습니다.`);
      if (f.retrying.cases > 0)
        lines.push(
          `${f.retrying.cases}건은 아직 재시도 중입니다${f.retrying.lastChance > 0 ? `(그중 ${f.retrying.lastChance}건은 다음 출금이 마지막 기회)` : ''}.`
        );
      if (f.awaitingResult.cases > 0)
        lines.push(
          `${f.awaitingResult.cases}건은 일주일 넘게 결과가 오지 않아 확인이 필요합니다.`
        );
    }

    const owed = f.debt.outstanding.amount + f.debt.paying.amount;
    if (f.debt.recorded.cases > 0) {
      const head = `해지로 생긴 미납 ${won(f.debt.recorded.amount)}`;
      const parts: string[] = [];
      if (f.debt.settled.amount > 0)
        parts.push(`${won(f.debt.settled.amount)}을 받았고`);
      if (f.debt.waived.amount > 0)
        parts.push(`${won(f.debt.waived.amount)}은 면제했고`);
      const paying =
        f.debt.paying.amount > 0
          ? `(그중 ${won(f.debt.paying.amount)}은 고객이 입금을 시작함)`
          : '';
      if (parts.length === 0)
        lines.push(`${head}은 아직 받지 못했습니다${paying}.`);
      else if (owed > 0)
        lines.push(
          `${head} 중 ${parts.join(' ')} ${won(owed)}이 남아 있습니다${paying}.`
        );
      else
        lines.push(
          `${head} 중 ${parts.join(' ').replace(/고$/, '습니다')} — 남은 돈은 없습니다.`
        );
    } else if (f.exhausted.cases + f.mandateRejected.cases > 0) {
      lines.push(
        scope === 'BEFORE'
          ? '해지된 건은 미납 정책 시행 전이라 미납으로 남지 않았습니다.'
          : '해지된 건은 미납으로 남지 않았습니다(이유는 아래 흐름에).'
      );
    }
  }

  lines.push(
    o.now.outstanding.people > 0
      ? `지금 받을 돈은 모두 ${won(o.now.outstanding.amount)}(${o.now.outstanding.people}명)입니다.`
      : '지금 남아 있는 미납은 없습니다.'
  );
  return lines;
}

/** 출금 실패 뒤 계좌 거절로 끝난 건 — 퍼널에서 «계좌 거절»에 같이 세지만 문장에서는 출금 실패 쪽에 넣는다 */
function countMandateAfterFailure(o: BillingRecoveryOverview): number {
  return o.cohort.cases.filter(
    (c) => c.kind === 'WITHDRAWAL' && c.terminationKind === 'MANDATE_REJECTED'
  ).length;
}

// ─── 퍼널 칸 → 건 목록 ─────────────────────────────────────────────────────────

export type FlowNodeKey =
  | 'failed'
  | 'recovered'
  | 'retrying'
  | 'awaitingResult'
  | 'endedOther'
  | 'exhausted'
  | 'mandate'
  | 'mandateOnly'
  | 'debtRecorded'
  | 'notRecorded'
  | 'settled'
  | 'paying'
  | 'outstanding'
  | 'waived';

/** 퍼널 칸 하나에 해당하는 건인가 — 서버 퍼널과 같은 판정(stage·terminationKind·debtState)만 쓴다 */
export function inFlowNode(c: RecoveryCase, node: FlowNodeKey): boolean {
  switch (node) {
    case 'failed':
      return c.kind === 'WITHDRAWAL';
    case 'recovered':
      return c.stage === 'RECOVERED';
    case 'retrying':
      return c.stage === 'RETRYING';
    case 'awaitingResult':
      return c.stage === 'AWAITING_RESULT';
    case 'endedOther':
      return (
        c.stage === 'ENDED_OTHER' ||
        c.terminationKind === 'OTHER' ||
        c.terminationKind === 'VOIDED'
      );
    case 'exhausted':
      return c.terminationKind === 'EXHAUSTED';
    case 'mandate':
      return c.terminationKind === 'MANDATE_REJECTED';
    case 'mandateOnly':
      return c.kind === 'MANDATE';
    case 'debtRecorded':
      return c.arrears != null && c.debtState != null;
    case 'notRecorded':
      return c.debtState === 'NOT_RECORDED';
    case 'settled':
      return c.debtState === 'SETTLED';
    case 'paying':
      return c.debtState === 'PAYING';
    case 'outstanding':
      return c.debtState === 'OUTSTANDING';
    case 'waived':
      return c.debtState === 'WAIVED';
  }
}

/** 한 건이 지금 어디에 있는지 한 마디로 */
export function caseNowLabel(c: RecoveryCase): string {
  switch (c.stage) {
    case 'RECOVERED':
      return '재시도로 받음';
    case 'RETRYING':
      return c.remainingAttempts <= 1 ? '재시도 중 · 마지막 기회' : '재시도 중';
    case 'AWAITING_RESULT':
      return '결과가 안 옴 · 확인 필요';
    case 'ENDED_OTHER':
      return '계약이 먼저 끝남';
    case 'TERMINATED':
      switch (c.debtState) {
        case 'SETTLED':
          return '해지 · 미납 받음';
        case 'PAYING':
          return '해지 · 입금 대기';
        case 'OUTSTANDING':
          return '해지 · 미납 남음';
        case 'WAIVED':
          return '해지 · 미납 면제';
        case 'NOT_RECORDED':
          return '해지 · 미납 없음';
        default:
          return terminationLabel(c);
      }
  }
}
