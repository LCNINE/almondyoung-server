/**
 * 놓친 수요를 금액으로 환산한다 — "빈손 검색 1,200회"보다 "약 340만원어치를 놓쳤다"가 판단에 쓰인다.
 *
 * **세 인자는 전부 실측값이다.** 지어낸 상수가 없다.
 * - 빈손 검색 횟수: 검색 로그
 * - 전환율: GA4 구매 ÷ 세션
 * - 객단가: 주문 집계
 *
 * **가정은 하나뿐이고, 화면에 드러내야 한다**: "찾던 상품이 있었다면 이 사람들도
 * 사이트 평균만큼 샀을 것이다". 이건 근사이지 관측이 아니다.
 *
 * **알려진 과대 요인**: 전환율의 모수는 세션인데 빈손 검색은 횟수다. 한 사람이 같은 것을
 * 여러 번 검색하면 그만큼 부풀려진다. 익명 세션 식별자(#758)가 붙으면 사람 수로 나눠
 * 이 왜곡을 없앨 수 있다 — 그때까지는 상한에 가까운 값으로 읽어야 한다.
 */

export interface MissedDemandInput {
  /** 결과 없이 끝난 검색 횟수 */
  zeroResultSearches: number | undefined;
  /** GA4 구매 세션 수 */
  purchases: number | undefined;
  /** GA4 전체 세션 수 */
  sessions: number | undefined;
  /** 객단가(원) */
  avgOrderValue: number | null | undefined;
}

export interface MissedDemand {
  /** 추정 금액(원). 인자가 하나라도 없으면 null — 0 으로 두면 "놓친 게 없다"로 읽힌다. */
  amount: number | null;
  /** 관측된 세션 전환율. 세션이 0이면 null. */
  conversionRate: number | null;
  /** 왜 계산할 수 없는지 — 화면이 그대로 보여준다. null 이면 계산됐다는 뜻. */
  blockedBy: string | null;
}

export function estimateMissedDemand({
  zeroResultSearches,
  purchases,
  sessions,
  avgOrderValue,
}: MissedDemandInput): MissedDemand {
  const conversionRate = sessions != null && sessions > 0 && purchases != null ? purchases / sessions : null;

  if (zeroResultSearches == null) {
    return { amount: null, conversionRate, blockedBy: '검색 로그를 불러오지 못했습니다' };
  }
  if (zeroResultSearches === 0) {
    return { amount: 0, conversionRate, blockedBy: null };
  }
  if (conversionRate == null) {
    return { amount: null, conversionRate: null, blockedBy: 'GA4 세션이 없어 전환율을 낼 수 없습니다' };
  }
  if (avgOrderValue == null || avgOrderValue <= 0) {
    return { amount: null, conversionRate, blockedBy: '조회 기간에 주문이 없어 객단가를 낼 수 없습니다' };
  }
  return {
    amount: Math.round(zeroResultSearches * conversionRate * avgOrderValue),
    conversionRate,
    blockedBy: null,
  };
}

function formatKrwShort(value: number): string {
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}억원`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString('ko-KR')}만원`;
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

/** 진단 문장. 계산 불가면 왜 못 하는지를 말한다 — 빈칸으로 두면 사람이 0 으로 읽는다. */
export function missedDemandSentence(demand: MissedDemand, rangeDays: number): string {
  if (demand.blockedBy) return `놓친 매출을 추정할 수 없습니다 — ${demand.blockedBy}.`;
  if (demand.amount === 0) return `최근 ${rangeDays}일 동안 결과 없이 끝난 검색이 없습니다.`;
  const rate = demand.conversionRate != null ? `${(demand.conversionRate * 100).toFixed(1)}%` : '-';
  return (
    `찾던 상품이 있었다면 최근 ${rangeDays}일 동안 약 ${formatKrwShort(demand.amount as number)}어치가 더 팔렸을 것으로 봅니다 ` +
    `(사이트 평균 전환율 ${rate} × 객단가 기준의 근사치 — 같은 사람의 반복 검색이 섞여 있어 상한에 가깝습니다).`
  );
}
