'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EVENT_FAILURE_SERVICES, type EventFailureService } from '@/lib/api/domains/events';
import { useEventFailureSummary } from '@/lib/services/events';
import { tabBadgeCount } from '../display';
import { DeadLetterSection } from '../components/dead-letter-section';
import { OutboxSection } from '../components/outbox-section';

export default function EventFailuresTemplate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-4 p-5">
      <h1 className="text-xl font-bold">이벤트 실패</h1>
      <Tabs defaultValue={EVENT_FAILURE_SERVICES[0]}>
        <TabsList>
          {EVENT_FAILURE_SERVICES.map((service) => (
            <ServiceTab key={service} service={service} />
          ))}
        </TabsList>
        {EVENT_FAILURE_SERVICES.map((service) => (
          <TabsContent key={service} value={service} className="mt-4 flex flex-col gap-8">
            <DeadLetterSection service={service} now={now} />
            <OutboxSection service={service} now={now} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** 배지는 안 푼 건수가 있을 때만. 요약을 못 읽으면 «오류» — 0 으로 보이면 정상으로 오독한다 */
function ServiceTab({ service }: { service: EventFailureService }) {
  const summary = useEventFailureSummary(service);
  const count = tabBadgeCount(summary.data);
  return (
    <TabsTrigger value={service} className="gap-1.5">
      {service}
      {summary.isError ? (
        <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
          오류
        </span>
      ) : count ? (
        <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
          {count.toLocaleString()}
        </span>
      ) : null}
    </TabsTrigger>
  );
}
