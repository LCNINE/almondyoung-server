import type { EventFailureService } from '../../api/domains/events';

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

  // 이벤트 실패 출구 (#1016 7·8번). 뮤테이션은 `failures(service)` 접두사로 그 서비스 전부를 무효화한다 —
  // 그래서 하위 키는 전부 이 접두사로 시작하고 undefined 를 섞지 않는다.
  failures: (service: EventFailureService) => ['events', 'failures', service] as const,
  failureSummary: (service: EventFailureService) =>
    ['events', 'failures', service, 'summary'] as const,
  deadLetterList: (service: EventFailureService) =>
    ['events', 'failures', service, 'dead-letters', 'list'] as const,
  deadLetterDetail: (service: EventFailureService, id: number) =>
    ['events', 'failures', service, 'dead-letters', 'detail', id] as const,
  outboxList: (service: EventFailureService) =>
    ['events', 'failures', service, 'outbox', 'list'] as const,
  outboxDetail: (service: EventFailureService, id: number) =>
    ['events', 'failures', service, 'outbox', 'detail', id] as const,
} as const;
