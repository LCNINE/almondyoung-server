export const eventQueryKeys = {
  tracedResources: (
    resourceType: string,
    service?: string,
    limit?: number,
    offset?: number
  ) =>
    [
      'events',
      'trace',
      'resource',
      resourceType,
      { service, limit, offset },
    ] as const,

  resourceEvents: (
    resourceType: string,
    resourceId: string,
    service?: string
  ) =>
    [
      'events',
      'trace',
      'resource',
      resourceType,
      resourceId,
      { service },
    ] as const,

  chainEvents: (chainId: string, service?: string) =>
    ['events', 'trace', 'chain', chainId, { service }] as const,
} as const;
