'use client';

import type { FulfillmentConsolidation } from '@/lib/types/dto/fulfillment';

const VOWEL_ENDING_DIGITS = new Set(['2', '4', '5', '9']);

function withPartner(partnerOrderNos: string[]) {
  const [first, ...rest] = partnerOrderNos;
  if (first == null) return '';
  if (rest.length > 0) return `#${first} 외 ${rest.length}건과`;

  return VOWEL_ENDING_DIGITS.has(first.slice(-1))
    ? `#${first}와`
    : `#${first}과`;
}

export const FoConsolidationCell = ({
  value,
}: {
  value: FulfillmentConsolidation | null | undefined;
}) => {
  if (value == null) return null;

  if (value.state === 'mergeable') {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-blue-700">
        {withPartner(value.partnerOrderNos)} 합칠 수 있어요
      </span>
    );
  }

  if (value.state === 'merging') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-700">
        {withPartner(value.partnerOrderNos)} 합치는 중
      </span>
    );
  }

  if (value.state === 'merged') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-green-700">
        {withPartner(value.partnerOrderNos)} 한 상자
      </span>
    );
  }

  return null;
};
