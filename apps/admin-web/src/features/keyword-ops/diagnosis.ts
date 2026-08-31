// 0건 검색어 화면의 숫자를 문장으로 읽어주는 순수 함수.
//
// 이 화면의 값은 두 가지 모수가 섞여 있다 — 검색 "횟수"(회)와 서로 다른 검색어 "종수"(종).
// 둘 다 "0건"이라고만 쓰면 읽는 사람이 "검색 결과가 안 나왔다"로 오독한다.
// 그래서 여기서 만드는 모든 문장은 값마다 단위를 반드시 달고 나간다.

import { formatDays, formatKinds, formatTimes } from './labels';
import type { ZeroHitSummary } from '@/lib/api/domains/search';

export interface DiagnosisInput {
  /** 기간 내 전체 검색 횟수 */
  totalSearches: number | undefined;
  /** 그중 결과가 하나도 없이 끝난 검색 횟수 */
  zeroResultSearches: number | undefined;
  summary: ZeroHitSummary | undefined;
  /** 조회 기간 일수 — "최근 N일" 문구용 */
  rangeDays: number;
}

export interface DiagnosisSentence {
  id: string;
  text: string;
  tone: 'alert' | 'neutral';
}

/** 결과 없이 끝난 검색의 비율. 검색이 0회면 비율이 정의되지 않는다. */
export function zeroSearchRate(
  totalSearches: number | undefined,
  zeroResultSearches: number | undefined,
): number | null {
  if (totalSearches == null || zeroResultSearches == null || totalSearches === 0) return null;
  return zeroResultSearches / totalSearches;
}

function formatRate(rate: number | null): string {
  return rate == null ? '-' : `${(rate * 100).toFixed(1)}%`;
}

/**
 * 화면 최상단에 읽히는 진단 문장.
 * 데이터가 아직 없으면 빈 배열 — 자리를 비워두는 게 0 을 단정하는 것보다 낫다.
 */
export function buildKeywordDiagnosis({
  totalSearches,
  zeroResultSearches,
  summary,
  rangeDays,
}: DiagnosisInput): DiagnosisSentence[] {
  const sentences: DiagnosisSentence[] = [];

  if (totalSearches != null && zeroResultSearches != null) {
    const rate = zeroSearchRate(totalSearches, zeroResultSearches);
    sentences.push({
      id: 'volume',
      tone: 'neutral',
      text:
        totalSearches === 0
          ? `최근 ${rangeDays}일 동안 검색이 한 번도 없었습니다.`
          : `최근 ${rangeDays}일 동안 고객이 ${formatTimes(totalSearches)} 검색했고, ` +
            `그중 ${formatTimes(zeroResultSearches)}(${formatRate(rate)})가 아무 상품도 못 보고 끝났습니다.`,
    });
  }

  if (summary) {
    if (summary.zeroKeywordCount === 0) {
      sentences.push({
        id: 'keywords',
        tone: 'neutral',
        text: '결과를 못 준 검색어가 없습니다.',
      });
    } else {
      const neglected = summary.neglectedOver7Days;
      sentences.push({
        id: 'keywords',
        tone: neglected > 0 ? 'alert' : 'neutral',
        text:
          neglected > 0
            ? `결과를 못 준 검색어는 ${formatKinds(summary.zeroKeywordCount)}이고, ` +
              `그중 ${formatKinds(neglected)}은 7일 넘게 손대지 않았습니다 (최장 ${formatDays(summary.maxNeglectDays)}).`
            : `결과를 못 준 검색어는 ${formatKinds(summary.zeroKeywordCount)}이고, 7일 넘게 방치된 것은 없습니다.`,
      });
    }

    if (summary.unassignedCount > 0) {
      sentences.push({
        id: 'unassigned',
        tone: 'neutral',
        text: `담당자가 정해지지 않은 검색어가 ${formatKinds(summary.unassignedCount)} 남아 있습니다.`,
      });
    }

    if (summary.resolvedByIndexCount > 0) {
      sentences.push({
        id: 'auto-resolved',
        tone: 'neutral',
        text: `${formatKinds(summary.resolvedByIndexCount)}은 이후 결과가 나오기 시작해 저절로 풀렸습니다.`,
      });
    }
  }

  return sentences;
}

/**
 * 결과 없이 끝난 검색 횟수의 추세를 문장으로. 예측은 추세를 그대로 이은 추정치라
 * 계절성·이벤트를 반영하지 않는다 — 문구에서 그 한계를 같이 말한다.
 */
export function buildZeroSearchForecastSentence(
  forecastTotal: number | null,
  horizonDays: number,
): string | null {
  if (forecastTotal == null) return null;
  const rounded = Math.max(0, Math.round(forecastTotal));
  return (
    `지금 추세가 이어지면 앞으로 ${horizonDays}일 동안 ` +
    `${formatTimes(rounded)}의 검색이 결과 없이 끝날 것으로 보입니다 (계절성·이벤트 미반영 추정).`
  );
}
