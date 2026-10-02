/**
 * 데이터 신뢰 — «이 화면의 숫자를 얼마나 믿어도 되나»를 숫자 옆에 정직하게 둔다.
 *
 * 표시 기준(좋음/주의/낮음)은 업계 표준값이 아니라 이 화면의 안내용 구분이다. 근거는 각 항목 detail 에 쓴다.
 */

export type TrustTone = 'good' | 'watch' | 'bad' | 'info' | 'unknown';

export interface TrustItem {
  key: 'ga4-capture' | 'payment-returns' | 'member-coverage' | 'refund' | 'pre-coverage';
  label: string;
  tone: TrustTone;
  value: string;
  detail: string;
}

export interface TrustInput {
  ga4Status: 'ok' | 'disabled' | 'failed';
  /** 같은 기간 GA4 구매(transactions) */
  ga4Transactions: number | null;
  /** 같은 기간 자사몰 주문(DB) */
  ownMallOrders: number;
  /** 결제사에서 돌아와 Referral 로 잡힌 방문·구매 */
  paymentReturns: { sessions: number; transactions: number } | null;
  memberOrders: number;
  refundDeducted: boolean | null;
  missingPreCoverage: boolean | null;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** GA4 수집률 이 값 이상이면 채널별 구매율을 그대로 읽어도 된다. */
export const CAPTURE_GOOD = 0.9;
export const CAPTURE_WATCH = 0.7;
/** GA4 구매 중 «결제사 복귀»로 잘못 잡힌 비중이 이 값을 넘으면 채널별 구매가 그만큼 엉뚱한 채널(Referral)로 간다. */
export const PAYMENT_RETURN_WATCH = 0.02;
export const PAYMENT_RETURN_BAD = 0.05;

export function buildTrust(input: TrustInput): TrustItem[] {
  const items: TrustItem[] = [];

  if (input.ga4Status !== 'ok') {
    items.push({
      key: 'ga4-capture',
      label: 'GA4 수집률',
      tone: 'unknown',
      value: input.ga4Status === 'disabled' ? '미연동' : '조회 실패',
      detail: '방문·채널·퍼널 숫자를 낼 수 없습니다. 주문·재구매 숫자는 GA4 와 무관합니다.',
    });
  } else if (input.ga4Transactions != null && input.ownMallOrders > 0) {
    const rate = input.ga4Transactions / input.ownMallOrders;
    items.push({
      key: 'ga4-capture',
      label: 'GA4 수집률',
      tone: rate >= CAPTURE_GOOD ? 'good' : rate >= CAPTURE_WATCH ? 'watch' : 'bad',
      value: pct(rate),
      detail: `GA4 구매 ${input.ga4Transactions.toLocaleString('ko-KR')}건 ÷ 실제 주문 ${input.ownMallOrders.toLocaleString('ko-KR')}건. 낮을수록 채널·기기별 구매율은 참고용입니다(광고 차단·동의 미수집·결제 도메인 이동).`,
    });
  }

  if (input.ga4Status === 'ok' && input.paymentReturns && input.ga4Transactions && input.ga4Transactions > 0) {
    const share = input.paymentReturns.transactions / input.ga4Transactions;
    items.push({
      key: 'payment-returns',
      label: '결제사 복귀로 잘못 잡힌 구매',
      tone: share >= PAYMENT_RETURN_BAD ? 'bad' : share >= PAYMENT_RETURN_WATCH ? 'watch' : 'good',
      value: pct(share),
      detail: `결제창(결제사)을 다녀온 방문 ${input.paymentReturns.sessions.toLocaleString('ko-KR')}회·구매 ${input.paymentReturns.transactions.toLocaleString('ko-KR')}건이 «추천(Referral) 유입»으로 잡혀 원래 채널에서 빠졌습니다. GA4 관리 › 데이터 스트림 › 태그 설정 › «원치 않는 참조 목록»에 결제사 도메인을 넣으면 그 뒤부터 바로잡힙니다.`,
    });
  }

  if (input.ownMallOrders > 0) {
    const share = Math.min(input.memberOrders / input.ownMallOrders, 1);
    items.push({
      key: 'member-coverage',
      label: '재구매 모수(회원 주문)',
      tone: 'info',
      value: pct(share),
      detail: '재구매·성장 회계는 자사몰 회원 주문만 셉니다. 비회원·네이버·쿠팡 주문은 사람을 이을 수 없어 빠집니다.',
    });
  }

  if (input.refundDeducted != null) {
    items.push({
      key: 'refund',
      label: '목표 달성액의 환불 반영',
      tone: input.refundDeducted ? 'good' : 'watch',
      value: input.refundDeducted ? '반영' : '미반영',
      detail: input.refundDeducted
        ? '결제 서비스의 상품 주문 환불을 달성액에서 뺐습니다. 결제된 주문을 «취소»하면 취소 차감과 환불 차감이 겹쳐 두 번 빠지므로, 달성액은 실제보다 약간 낮게(보수적으로) 나옵니다.'
        : '결제 서비스 환불을 불러오지 못해 달성액이 환불만큼 부풀어 있을 수 있습니다.',
    });
  }

  if (input.missingPreCoverage) {
    items.push({
      key: 'pre-coverage',
      label: '집계 시작 전 실적',
      tone: 'watch',
      value: '미입력',
      detail: '집계가 연중에 시작돼 그 이전 매출이 없습니다. 연간 달성률이 낮게 나옵니다 — 설정에서 «집계 시작 전 실적»을 넣으세요.',
    });
  }

  return items;
}
