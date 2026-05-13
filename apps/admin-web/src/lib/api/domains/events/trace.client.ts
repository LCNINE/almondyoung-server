import { client } from '../../client';

export interface TraceLink {
  id: string;
  eventId: string;
  chainId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  direction: 'CAUSE' | 'EFFECT';
  action: string | null;
  description: string | null;
  serviceName: string | null;
  createdAt: string;
}

export interface ServiceResourceResult {
  name: string;
  status: 'fulfilled' | 'rejected';
  resources?: { resourceId: string }[];
  total?: number;
  error?: string;
}

export interface ServiceLinkResult {
  name: string;
  status: 'fulfilled' | 'rejected';
  links?: TraceLink[];
  chainIds?: string[];
  total?: number;
  error?: string;
}

export interface TracedResourcesResponse {
  services: ServiceResourceResult[];
}

export interface ResourceEventsResponse {
  services: ServiceLinkResult[];
}

export interface ChainEventsResponse {
  services: ServiceLinkResult[];
}

export interface GetTracedResourcesOptions {
  service?: string;
  limit?: number;
  offset?: number;
}

export const traceClient = {
  getTracedResources: async (
    resourceType: string,
    options: GetTracedResourcesOptions = {}
  ): Promise<TracedResourcesResponse> => {
    const params = new URLSearchParams();
    if (options.service) params.set('service', options.service);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));

    const qs = params.toString();
    const res = await client.get(
      `/events/trace/resource/${encodeURIComponent(resourceType)}${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  getResourceEvents: async (
    resourceType: string,
    resourceId: string,
    options: { service?: string } = {}
  ): Promise<ResourceEventsResponse> => {
    const params = new URLSearchParams();
    if (options.service) params.set('service', options.service);

    const qs = params.toString();
    const res = await client.get(
      `/events/trace/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  getChainEvents: async (
    chainId: string,
    options: { service?: string } = {}
  ): Promise<ChainEventsResponse> => {
    const params = new URLSearchParams();
    if (options.service) params.set('service', options.service);

    const qs = params.toString();
    const res = await client.get(
      `/events/trace/chain/${encodeURIComponent(chainId)}${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },
};
