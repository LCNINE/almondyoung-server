'use client';

import { useQuery } from '@tanstack/react-query';
import { eventQueryKeys } from './query-keys';
import { traceClient } from '../../api/domains/events';

export const useTracedResources = (
  resourceType: string,
  service?: string,
  limit = 20,
  offset = 0
) => {
  return useQuery({
    queryKey: eventQueryKeys.tracedResources(resourceType, service, limit, offset),
    queryFn: () => traceClient.getTracedResources(resourceType, { service, limit, offset }),
    enabled: !!resourceType,
  });
};

export const useResourceEvents = (
  resourceType: string,
  resourceId: string,
  service?: string
) => {
  return useQuery({
    queryKey: eventQueryKeys.resourceEvents(resourceType, resourceId, service),
    queryFn: () => traceClient.getResourceEvents(resourceType, resourceId, { service }),
    enabled: !!resourceType && !!resourceId,
  });
};

export const useChainEvents = (chainId: string, service?: string) => {
  return useQuery({
    queryKey: eventQueryKeys.chainEvents(chainId, service),
    queryFn: () => traceClient.getChainEvents(chainId, { service }),
    enabled: !!chainId,
  });
};
