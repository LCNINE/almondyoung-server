/**
 * 경영 진단 — "이대로 가면 살아남나".
 *
 * 여러 서비스의 요약을 한 판정으로 접는다. 서비스 경계상 이 병합은 화면에서만 가능하다
 * (마진=analytics · 수수료·구독료=wallet · 재고=core). 계산은 전부 여기 순수 함수에 두고
 * 컴포넌트는 그리기만 한다.
 *
 * 원칙:
 * - **모르는 것을 0 으로 두지 않는다.** 고정비 미설정이면 흑자/적자 판정 자체를 하지 않는다.
 * - 근사치는 근사치라고 말한다. 원가·수수료·재고 금액이 전부 추정이다.
 * - 축마다 "무엇을 보고 그렇게 말하는지"를 같이 낸다.
 */

export type HealthTone = 'good' | 'watch' | 'bad' | 'unknown';

export interface HealthAxis {
  key: string;
  label: string;
  tone: HealthTone;
  /** 한눈에 읽는 값 (이미 포맷된 문자열) */
  value: string;
  /** 왜 그렇게 판정했는지 한 줄 */
  detail: string;
}

export interface BusinessHealth {
  verdict: {
    tone: HealthTone;
    headline: string;
    detail: string;
  };
  axes: HealthAxis[];
}

export interface BusinessHealthInput {
  /** 최근 30일 마진(매출총이익) 추정. 원가 미입력 몫은 빠져 있다. */
  estimatedMargin: number | null;
  /** 원가가 입력된 몫의 순매출 — 마진율의 분모 */
  computedNetRevenue: number | null;
  marginRate: number | null;
  /** 전체 순매출(원가 미입력 포함) */
  netRevenue: number | null;
  previousNetRevenue: number | null;
  /** 추정 결제 수수료 (wallet). 요율 미설정 몫은 빠져 있다. */
  estimatedFee: number | null;
  /** 요율 미설정이라 수수료를 못 매긴 캡처 금액 */
  feeUncoveredAmount: number | null;
  /** 기간에 귀속된 고정비. 미설정이면 null. */
  fixedCost: number | null;
  fixedCostUncoveredDays: number;
  /** 멤버십 구독료 수입 (반복 수입) */
  membershipRevenue: number | null;
  /** 재고에 묶인 돈 */
  stockValue: number | null;
  /** 금액을 못 매긴 재고 수량 — 묶인 돈이 과소평가된 정도 */
  stockUncostedQuantity: number | null;
  rangeDays: number;
}

function formatKrwShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억원`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString('ko-KR')}만원`;
  return `${sign}${Math.round(abs).toLocaleString('ko-KR')}원`;
}

function percent(rate: number): string {
  return `${rate > 0 ? '+' : ''}${Math.round(rate * 100)}%`;
}

/** 성장 축이 '주의'로 넘어가는 감소폭. 이보다 작은 등락은 일상적이다. */
const GROWTH_WATCH_DROP = -0.1;
const GROWTH_BAD_DROP = -0.25;
/** 마진율이 이보다 낮으면 팔아도 남는 게 거의 없다. */
const MARGIN_WATCH_RATE = 0.15;
/** 재고에 묶인 돈이 기간 순매출의 이 배를 넘으면 회전이 느리다는 뜻이다. */
const STOCK_HEAVY_MULTIPLE = 2;

export function buildBusinessHealth(input: BusinessHealthInput): BusinessHealth {
  const axes: HealthAxis[] = [];

  // ── 성장 ──
  if (input.netRevenue != null && input.previousNetRevenue != null && input.previousNetRevenue > 0) {
    const rate = (input.netRevenue - input.previousNetRevenue) / input.previousNetRevenue;
    axes.push({
      key: 'growth',
      label: '성장',
      tone: rate <= GROWTH_BAD_DROP ? 'bad' : rate < GROWTH_WATCH_DROP ? 'watch' : 'good',
      value: percent(rate),
      detail: `최근 ${input.rangeDays}일 순매출 ${formatKrwShort(input.netRevenue)} · 직전 ${input.rangeDays}일 대비`,
    });
  } else {
    axes.push({
      key: 'growth',
      label: '성장',
      tone: 'unknown',
      value: '비교 불가',
      detail: '직전 기간 매출이 없어 증감을 낼 수 없습니다',
    });
  }

  // ── 수익성 (수수료 차감 후) ──
  const contributionMargin =
    input.estimatedMargin != null ? input.estimatedMargin - (input.estimatedFee ?? 0) : null;
  if (contributionMargin != null && input.computedNetRevenue != null && input.computedNetRevenue > 0) {
    const rate = contributionMargin / input.computedNetRevenue;
    axes.push({
      key: 'margin',
      label: '수익성',
      tone: rate <= 0 ? 'bad' : rate < MARGIN_WATCH_RATE ? 'watch' : 'good',
      value: percent(rate),
      detail:
        `수수료 뺀 마진 ${formatKrwShort(contributionMargin)}` +
        (input.feeUncoveredAmount != null && input.feeUncoveredAmount > 0
          ? ' · 요율 미설정 구간은 수수료가 빠져 있어 실제보다 높게 나옵니다'
          : ''),
    });
  } else {
    axes.push({
      key: 'margin',
      label: '수익성',
      tone: 'unknown',
      value: '계산 불가',
      detail: '원가가 입력된 상품이 없어 마진을 낼 수 없습니다',
    });
  }

  // ── 영업손익 (고정비까지) ── 생존 판정의 축
  const operatingProfit = contributionMargin != null && input.fixedCost != null ? contributionMargin - input.fixedCost : null;
  if (operatingProfit != null) {
    axes.push({
      key: 'operating',
      label: '영업손익',
      tone: operatingProfit > 0 ? 'good' : 'bad',
      value: formatKrwShort(operatingProfit),
      detail:
        `고정비 ${formatKrwShort(input.fixedCost as number)} 차감 후` +
        (input.fixedCostUncoveredDays > 0 ? ` · ${input.fixedCostUncoveredDays}일은 고정비 미설정 구간` : ''),
    });
  } else {
    axes.push({
      key: 'operating',
      label: '영업손익',
      tone: 'unknown',
      value: '고정비 미설정',
      detail: '월 고정비를 입력하면 흑자·적자와 손익분기 매출을 계산합니다',
    });
  }

  // ── 반복 수입 (멤버십 구독료) ──
  if (input.membershipRevenue != null) {
    const coverage = input.fixedCost != null && input.fixedCost > 0 ? input.membershipRevenue / input.fixedCost : null;
    axes.push({
      key: 'recurring',
      label: '반복 수입',
      tone: coverage == null ? 'good' : coverage >= 1 ? 'good' : coverage >= 0.3 ? 'watch' : 'bad',
      value: formatKrwShort(input.membershipRevenue),
      detail:
        coverage != null
          ? `멤버십 구독료만으로 고정비의 ${Math.round(coverage * 100)}%를 덮습니다`
          : `최근 ${input.rangeDays}일 멤버십 구독료 — 매출이 0인 달에도 들어오는 돈입니다`,
    });
  } else {
    axes.push({
      key: 'recurring',
      label: '반복 수입',
      tone: 'unknown',
      value: '계산 불가',
      detail: '멤버십 구독료를 불러오지 못했습니다',
    });
  }

  // ── 현금 잠김 (재고) ──
  if (input.stockValue != null) {
    const multiple = input.netRevenue != null && input.netRevenue > 0 ? input.stockValue / input.netRevenue : null;
    axes.push({
      key: 'stock',
      label: '재고에 묶인 돈',
      tone: multiple == null ? 'unknown' : multiple >= STOCK_HEAVY_MULTIPLE ? 'watch' : 'good',
      value: formatKrwShort(input.stockValue),
      detail:
        (multiple != null ? `최근 ${input.rangeDays}일 순매출의 ${multiple.toFixed(1)}배` : '매출 대비 비교 불가') +
        (input.stockUncostedQuantity != null && input.stockUncostedQuantity > 0
          ? ` · 원가를 못 매긴 재고 ${input.stockUncostedQuantity.toLocaleString('ko-KR')}개는 빠져 있어 실제로는 더 큽니다`
          : ''),
    });
  } else {
    axes.push({
      key: 'stock',
      label: '재고에 묶인 돈',
      tone: 'unknown',
      value: '계산 불가',
      detail: '재고 금액을 불러오지 못했습니다',
    });
  }

  return { verdict: buildVerdict(input, contributionMargin, operatingProfit), axes };
}

function buildVerdict(
  input: BusinessHealthInput,
  contributionMargin: number | null,
  operatingProfit: number | null,
): BusinessHealth['verdict'] {
  if (operatingProfit == null) {
    return {
      tone: 'unknown',
      headline: '흑자인지 적자인지 아직 알 수 없습니다',
      detail:
        contributionMargin == null
          ? '상품 원가와 월 고정비를 입력하면 이 자리에서 판정합니다.'
          : '월 고정비를 입력하면 이 자리에서 흑자·적자와 손익분기 매출을 판정합니다.',
    };
  }

  const monthly = Math.round((operatingProfit / input.rangeDays) * 30);
  if (operatingProfit > 0) {
    return {
      tone: 'good',
      headline: `이 추세면 월 ${formatKrwShort(monthly)} 남습니다`,
      detail: `최근 ${input.rangeDays}일 기준 고정비까지 빼고 남은 돈을 월로 환산한 값입니다. 원가·수수료가 근사치라 실제와 차이가 납니다.`,
    };
  }

  const shortfall = Math.abs(operatingProfit);
  const marginRate =
    contributionMargin != null && input.computedNetRevenue != null && input.computedNetRevenue > 0
      ? contributionMargin / input.computedNetRevenue
      : null;
  const extraSales = marginRate != null && marginRate > 0 ? Math.round(shortfall / marginRate) : null;
  return {
    tone: 'bad',
    headline: `이 추세면 월 ${formatKrwShort(Math.abs(monthly))} 모자랍니다`,
    detail:
      extraSales != null
        ? `본전이 되려면 최근 ${input.rangeDays}일 동안 ${formatKrwShort(extraSales)}를 더 팔았어야 합니다. 원가·수수료가 근사치라 실제와 차이가 납니다.`
        : '마진율이 0 이하라 더 파는 것으로는 본전이 되지 않습니다. 원가나 판매가를 먼저 봐야 합니다.',
  };
}
