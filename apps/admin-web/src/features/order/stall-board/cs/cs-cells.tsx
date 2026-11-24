'use client';

import {
  contactPeople,
  followUpText,
  goodsText,
  outcomeLabel,
  type CsBrief,
} from '@/lib/api/domains/orders/order-cs.shape';
import { formatDwell } from '@/lib/api/domains/orders/order-progress.shape';
import { kstToday } from '@/features/order/matching/lib/date-key';
import { CopyText } from './copy-text';

export function CustomerCell(props: {
  customerName: string | null;
  cs: CsBrief | null;
}) {
  if (!props.cs)
    return (
      <div>
        <div>{props.customerName ?? ''}</div>
        <div className="text-xs text-red-600">연락처를 불러오지 못했어요</div>
      </div>
    );
  const people = contactPeople(props.customerName, props.cs);
  return (
    <div className="flex min-w-32 flex-col gap-0.5">
      {people.map((p) => (
        <div key={p.who} className="flex flex-wrap items-baseline gap-x-1.5">
          {people.length > 1 && (
            <span className="text-xs text-muted-foreground">{p.who}</span>
          )}
          <span>{p.name ?? '이름 없음'}</span>
          {p.phone ? (
            <CopyText
              value={p.phone}
              what={`${p.who} 연락처`}
              className="text-[13px]"
            />
          ) : (
            <span className="text-xs text-muted-foreground">연락처 없음</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function GoodsCell(props: { cs: CsBrief | null }) {
  if (!props.cs)
    return (
      <span className="text-xs text-red-600">상품을 불러오지 못했어요</span>
    );
  return (
    <div className="min-w-40 max-w-64 break-keep">
      <div>{goodsText(props.cs)}</div>
      {props.cs.totalAmount !== null && (
        <div className="text-xs tabular-nums text-muted-foreground">
          {props.cs.totalAmount.toLocaleString('ko-KR')}원
        </div>
      )}
    </div>
  );
}

/** 마지막 연락·다시 연락할 날·메모가 있는지 */
export function ContactCell(props: {
  cs: CsBrief | null;
  now: Date;
  authorName: (id: string) => string;
}) {
  const { cs, now } = props;
  if (!cs)
    return (
      <span className="text-xs text-red-600">
        연락 기록을 불러오지 못했어요
      </span>
    );
  const last = cs.lastContact;
  const follow = followUpText(last?.followUpOn ?? null, kstToday(now));
  const author = last ? props.authorName(last.authorId) : '';
  return (
    <div className="flex min-w-28 flex-col items-start gap-0.5 whitespace-nowrap text-xs">
      {last && (
        <span>
          {formatDwell(
            Math.max(0, now.getTime() - new Date(last.at).getTime())
          )}{' '}
          전 {author && `${author} `}
          {outcomeLabel(last.outcome)}
        </span>
      )}
      {follow && (
        <span
          className={
            follow.due ? 'font-semibold text-red-600' : 'text-muted-foreground'
          }
        >
          {follow.text}
        </span>
      )}
      {cs.hasMemo && (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
          메모 있음
        </span>
      )}
    </div>
  );
}
