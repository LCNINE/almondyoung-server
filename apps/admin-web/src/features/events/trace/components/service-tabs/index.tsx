'use client';

import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ResourceListTable } from '../resource-list-table';
import { useTracedResources } from '@/lib/services/events';
import type { ServiceResourceResult } from '@/lib/api/domains/events';

interface ServicePagination {
  page: number;
  limit: number;
}

interface ServiceTabsProps {
  resourceType: string;
  initialServices: ServiceResourceResult[];
  pagination: Record<string, ServicePagination>;
  onPageChange: (serviceName: string, page: number) => void;
  onLimitChange: (serviceName: string, limit: number) => void;
}

interface ServiceTabPanelProps {
  serviceName: string;
  resourceType: string;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

function ServiceTabPanel({
  serviceName,
  resourceType,
  page,
  limit,
  onPageChange,
  onLimitChange,
}: ServiceTabPanelProps) {
  const router = useRouter();
  const offset = (page - 1) * limit;
  const { data, isFetching } = useTracedResources(resourceType, serviceName, limit, offset);

  const svc = data?.services?.[0];
  const resources = svc?.resources ?? [];
  const total = svc?.total ?? 0;

  return (
    <ResourceListTable
      resources={resources}
      total={total}
      isLoading={isFetching}
      page={page}
      limit={limit}
      onPageChange={onPageChange}
      onLimitChange={onLimitChange}
      resourceType={resourceType}
      onRowClick={(resourceId) =>
        router.push(
          `/events/trace/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`
        )
      }
    />
  );
}

export function ServiceTabs({
  resourceType,
  initialServices,
  pagination,
  onPageChange,
  onLimitChange,
}: ServiceTabsProps) {
  const visibleServices = initialServices.filter(
    (s) => s.status === 'fulfilled' && (s.total ?? 0) > 0
  );
  const failedServices = initialServices.filter((s) => s.status === 'rejected');

  if (visibleServices.length === 0 && failedServices.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        리소스 타입을 선택하면 결과가 표시됩니다.
      </div>
    );
  }

  if (visibleServices.length === 0) {
    return (
      <div className="space-y-2 py-4">
        {failedServices.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-sm text-red-600">
            <Badge variant="destructive">{s.name}</Badge>
            <span>{s.error}</span>
          </div>
        ))}
      </div>
    );
  }

  const defaultTab = visibleServices[0].name;

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        {visibleServices.map((s) => (
          <TabsTrigger key={s.name} value={s.name} className="gap-1.5">
            {s.name}
            <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700">
              {s.total?.toLocaleString() ?? 0}
            </span>
          </TabsTrigger>
        ))}
        {failedServices.map((s) => (
          <TabsTrigger key={s.name} value={s.name} className="gap-1.5 text-red-500" disabled>
            {s.name}
            <Badge variant="destructive" className="h-4 px-1 text-xs">
              오류
            </Badge>
          </TabsTrigger>
        ))}
      </TabsList>

      {visibleServices.map((s) => {
        const pg = pagination[s.name] ?? { page: 1, limit: 20 };
        return (
          <TabsContent key={s.name} value={s.name} className="mt-0">
            <ServiceTabPanel
              serviceName={s.name}
              resourceType={resourceType}
              page={pg.page}
              limit={pg.limit}
              onPageChange={(page) => onPageChange(s.name, page)}
              onLimitChange={(limit) => onLimitChange(s.name, limit)}
            />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
