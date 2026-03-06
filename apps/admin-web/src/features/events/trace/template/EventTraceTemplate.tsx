'use client';

import { useState, useCallback } from 'react';
import { ResourceTypeFilter } from '../components/resource-type-filter';
import { ServiceTabs } from '../components/service-tabs';
import { useTracedResources } from '@/lib/services/events';
import type { ServiceResourceResult } from '@/lib/api/domains/events';

interface ServicePagination {
  page: number;
  limit: number;
}

export default function EventTraceTemplate() {
  const [resourceType, setResourceType] = useState('');
  const [pagination, setPagination] = useState<Record<string, ServicePagination>>({});

  const { data, isFetching } = useTracedResources(resourceType);

  const initialServices: ServiceResourceResult[] = data?.services ?? [];

  const handlePageChange = useCallback((serviceName: string, page: number) => {
    setPagination((prev) => ({
      ...prev,
      [serviceName]: { ...( prev[serviceName] ?? { limit: 20 }), page },
    }));
  }, []);

  const handleLimitChange = useCallback((serviceName: string, limit: number) => {
    setPagination((prev) => ({
      ...prev,
      [serviceName]: { page: 1, limit },
    }));
  }, []);

  const handleResourceTypeChange = useCallback((value: string) => {
    setResourceType(value);
    setPagination({});
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">이벤트 추적</h1>
        <p className="mt-1 text-sm text-gray-500">
          리소스 타입별로 각 서비스의 이벤트 추적 데이터를 조회합니다.
        </p>
      </div>

      <ResourceTypeFilter value={resourceType} onChange={handleResourceTypeChange} />

      {resourceType && isFetching && initialServices.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm text-gray-400">
          조회 중...
        </div>
      ) : (
        <ServiceTabs
          resourceType={resourceType}
          initialServices={initialServices}
          pagination={pagination}
          onPageChange={handlePageChange}
          onLimitChange={handleLimitChange}
        />
      )}
    </div>
  );
}
