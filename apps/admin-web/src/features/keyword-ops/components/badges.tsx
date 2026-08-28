'use client';

import { cn } from '@/lib/utils/ui';
import type { ZeroHitKeywordRow } from '@/lib/api/domains/search';

/**
 * "N일 방치" 배지 — 방치가 길수록 진한 경고색.
 * 방치 일수는 마지막으로 결과가 있었던 날(없으면 최초 0건일)부터 오늘까지다.
 */
export function NeglectBadge({ days, resolved }: { days: number; resolved: boolean }) {
  if (resolved) {
    return (
      <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
        저절로 풀림
      </span>
    );
  }
  const cls =
    days >= 30
      ? 'border-red-200 bg-red-50 text-red-700'
      : days >= 14
        ? 'border-orange-200 bg-orange-50 text-orange-700'
        : days >= 7
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-gray-200 bg-gray-50 text-gray-600';
  return (
    <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium tabular-nums', cls)}>
      {days}일 방치
    </span>
  );
}

/**
 * 색인 대조 근거 — 자동 판정은 하지 않고 재료만 보여준다.
 * 자동 분류는 한글 오타를 오판한 이력이 있어 걷어냈다. 개발/MD 판단은 사람이 상태로 지정한다.
 *
 * 다만 "색인에 상품이 있는데 검색은 0건이었다"는 것은 판정이 아니라 관측된 사실이라
 * 그 대비만 눈에 띄게 갈라 놓는다.
 */
export function IndexEvidence({
  matchedProductsCount,
  matchedProductNames,
  similarProductNames,
  correctedQuery,
}: Pick<
  ZeroHitKeywordRow,
  'matchedProductsCount' | 'matchedProductNames' | 'similarProductNames' | 'correctedQuery'
>) {
  if (matchedProductsCount === 0 && similarProductNames.length === 0 && !correctedQuery) {
    return (
      <div className="space-y-0.5">
        <p className="font-medium text-gray-700">색인에 일치 상품 없음</p>
        <p className="text-gray-400">안 파는 물건일 가능성 — 소싱 쪽에서 볼 후보</p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {matchedProductsCount > 0 ? (
        <>
          <p className="font-medium text-blue-700" title={matchedProductNames.join(' · ')}>
            색인에 {matchedProductsCount.toLocaleString('ko-KR')}개 있는데 검색은 0건
          </p>
          {matchedProductNames.length > 0 ? (
            <p className="text-gray-500">
              {matchedProductNames[0]}
              {matchedProductsCount > 1 ? ' 외' : ''} · 노출 쪽에서 볼 후보
            </p>
          ) : (
            <p className="text-gray-500">노출 쪽에서 볼 후보</p>
          )}
        </>
      ) : null}
      {similarProductNames.length > 0 ? (
        <p className="text-gray-500" title={similarProductNames.join(' · ')}>
          비슷한 이름: {similarProductNames.slice(0, 2).join(', ')}
          {similarProductNames.length > 2 ? ' 외' : ''}
        </p>
      ) : null}
      {correctedQuery ? <p className="text-gray-500">영타로 치면 &ldquo;{correctedQuery}&rdquo;</p> : null}
    </div>
  );
}
