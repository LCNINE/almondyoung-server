'use client';

import Link from 'next/link';
import { useState } from 'react';
import { kstToday } from '@/features/order/matching/lib/date-key';
import {
  ReserveShortageView,
  arrivalLabel,
  shortageKindsText,
} from '@/lib/api/domains/orders/order-progress.shape';

// 둘까지는 펼쳐 두고, 셋부터 첫 상품만 보인 채 접는다
const OPEN_LIMIT = 2;

/** 예약 줄에서 모자란 상품·수량·입고 예정. 화면을 옮기지 않고 줄 안에서 전부 펼친다. */
export function ShortageCell(props: {
  shortage: ReserveShortageView;
  now: Date;
}) {
  const { shortage, now } = props;
  const [expanded, setExpanded] = useState(false);
  const { items } = shortage;
  const foldable = items.length > OPEN_LIMIT;
  const shown = foldable && !expanded ? items.slice(0, 1) : items;
  const today = kstToday(now);

  return (
    <div className="min-w-56 break-keep">
      <div className="flex flex-wrap gap-x-3 text-xs">
        <span className="text-muted-foreground">
          {shortageKindsText(shortage)}
        </span>
        {foldable && (
          <button
            type="button"
            aria-expanded={expanded}
            className="text-primary underline underline-offset-2"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '접기' : `외 ${items.length - 1}개 보기`}
          </button>
        )}
        <Link
          href={`/order/fulfillments?shipmentId=${encodeURIComponent(shortage.shipmentId)}`}
          className="whitespace-nowrap text-primary underline underline-offset-2"
        >
          상자 상세
        </Link>
      </div>
      <ul role="list" aria-label="모자란 상품" className="space-y-0.5">
        {shown.map((item) => (
          <li key={item.skuId}>
            {item.skuName}{' '}
            <span className="whitespace-nowrap tabular-nums">
              {item.shortQty.toLocaleString('ko-KR')}개
            </span>{' '}
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {arrivalLabel(item.expectedArrival, today) || '입고 예정일 없음'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
