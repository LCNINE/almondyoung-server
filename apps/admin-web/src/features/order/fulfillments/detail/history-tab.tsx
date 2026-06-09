'use client';

import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';

interface TimelineEvent {
  label: string;
  at: string | null | undefined;
}

export function HistoryTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const events: TimelineEvent[] = [
    { label: '생성됨', at: fo.createdAt },
    { label: '할당됨', at: fo.allocatedAt },
    { label: '출고 완료', at: fo.shippedAt },
    { label: '취소됨', at: fo.canceledAt },
  ];

  const occurred = events.filter((e) => !!e.at);

  return (
    <div className="flex flex-col gap-4 py-4">
      <section>
        <h3 className="mb-3 text-sm font-semibold">상태 타임라인</h3>
        {occurred.length === 0 ? (
          <p className="text-sm text-muted-foreground">기록된 이벤트 없음</p>
        ) : (
          <ol className="relative ml-3 border-l border-muted-foreground/20">
            {occurred.map((e) => (
              <li key={e.label} className="mb-5 ml-4">
                <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border border-background bg-muted-foreground/40" />
                <p className="text-sm font-medium">{e.label}</p>
                <time className="text-xs text-muted-foreground">
                  {new Date(e.at!).toLocaleString('ko-KR')}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-md border p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">이벤트/아웃박스 추적</p>
        <p>
          Core outbox 이벤트 trace(FulfillmentShipped, FulfillmentDelivered 등) 연결은
          이후 Phase에서 구현됩니다.
        </p>
      </section>
    </div>
  );
}
