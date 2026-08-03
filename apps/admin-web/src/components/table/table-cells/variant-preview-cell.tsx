'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { VariantPreviewDto } from '@/lib/types/dto/products';

/** 접힌 상태에서 보여줄 품목 수. 품목이 많은 상품이 행 높이를 독점하지 않도록 제한한다. */
const COLLAPSED_COUNT = 5;

const won = (v: number) => v.toLocaleString('ko-KR');

function VariantRow({ variant }: { variant: VariantPreviewDto }) {
  const inactive = variant.status !== 'active';

  return (
    <div className="flex items-baseline justify-between gap-2">
      <span
        className={`min-w-0 truncate ${inactive ? 'text-muted-foreground line-through' : ''}`}
        title={variant.name}
      >
        {variant.name || '이름 없음'}
      </span>
      <span className="shrink-0 tabular-nums">
        {variant.basePrice == null ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <>
            <span className="text-[#3f6212]">{won(variant.basePrice)}</span>
            {variant.membershipPrice != null && (
              <span className="text-[#a86500]">
                {' / '}
                {won(variant.membershipPrice)}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}

export function VariantPreviewCell({
  optionGroupNames,
  variantCount,
  variantPreviews,
}: {
  optionGroupNames: string[];
  variantCount: number;
  variantPreviews: VariantPreviewDto[];
}) {
  const [expanded, setExpanded] = useState(false);

  // 옵션 그룹이 없는 상품은 품목이 하나뿐이고 그 이름이 비어 있는 게 정상이다.
  // 이 경우 품목 줄을 그리면 '이름 없음' 만 남으므로 종전처럼 단일상품으로 표시한다.
  if (optionGroupNames.length === 0) {
    return <span className="text-[#1e3a89]">단일상품</span>;
  }

  // 미리보기를 만들지 않는 호출 경로(전량 조회)도 있으므로 종전 요약 표기로 물러선다.
  if (variantPreviews.length === 0) {
    return variantCount > 0 ? (
      <span className="text-[#1e3a89]">{`${optionGroupNames.join(' / ')} / ${variantCount}`}</span>
    ) : (
      <span className="text-muted-foreground">품목 없음</span>
    );
  }

  const shown = expanded
    ? variantPreviews
    : variantPreviews.slice(0, COLLAPSED_COUNT);
  const hiddenCount = variantCount - shown.length;
  // 서버가 상품당 미리보기 개수를 자르므로, 다 펼쳐도 남는 품목이 있을 수 있다.
  const beyondPreview = variantCount - variantPreviews.length;

  return (
    <div className="flex w-full flex-col gap-0.5 text-left text-xs">
      {optionGroupNames.length > 0 && (
        <p className="truncate text-[11px] text-muted-foreground">
          {optionGroupNames.join(' / ')} · {variantCount}개
        </p>
      )}
      {shown.map((variant) => (
        <VariantRow key={variant.variantId} variant={variant} />
      ))}
      {hiddenCount > 0 && !expanded && (
        <button
          type="button"
          className="flex items-center gap-0.5 text-[11px] text-[#1e40ae] hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          <ChevronDown className="h-3 w-3" aria-hidden="true" />+{hiddenCount}개
          더보기
        </button>
      )}
      {expanded && (
        <>
          {beyondPreview > 0 && (
            <p className="text-[11px] text-muted-foreground">
              외 {beyondPreview}개는 상세에서 확인
            </p>
          )}
          <button
            type="button"
            className="flex items-center gap-0.5 text-[11px] text-[#1e40ae] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
          >
            <ChevronUp className="h-3 w-3" aria-hidden="true" />
            접기
          </button>
        </>
      )}
    </div>
  );
}
