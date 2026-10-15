'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { eventQueryKeys } from './query-keys';
import { eventFailuresClient, type EventFailureService } from '../../api/domains/events';

// 운영 화면이라 캐시를 믿지 않는다(staleTime 0). 재시도는 끈다 — axios 가 GET 5xx 를 이미 두 번 재시도하므로
// react-query 재시도까지 겹치면 마이그 전 배포의 500 이 화면에 늦게 뜬다.
const LIVE = { staleTime: 0, retry: false } as const;

export const useEventFailureSummary = (service: EventFailureService) =>
  useQuery({
    queryKey: eventQueryKeys.failureSummary(service),
    queryFn: () => eventFailuresClient.summary(service),
    refetchInterval: 30_000,
    ...LIVE,
  });

export const useDeadLetterSequences = (service: EventFailureService) =>
  useInfiniteQuery({
    queryKey: eventQueryKeys.deadLetterList(service),
    queryFn: ({ pageParam }) => eventFailuresClient.deadLetters(service, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...LIVE,
  });

export const useDeadLetterDetail = (service: EventFailureService, id: number) =>
  useQuery({
    queryKey: eventQueryKeys.deadLetterDetail(service, id),
    queryFn: () => eventFailuresClient.deadLetter(service, id),
    ...LIVE,
  });

export const useOutboxFailures = (service: EventFailureService) =>
  useInfiniteQuery({
    queryKey: eventQueryKeys.outboxList(service),
    queryFn: ({ pageParam }) => eventFailuresClient.outboxFailed(service, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...LIVE,
  });

export const useOutboxFailureDetail = (service: EventFailureService, id: number) =>
  useQuery({
    queryKey: eventQueryKeys.outboxDetail(service, id),
    queryFn: () => eventFailuresClient.outboxRow(service, id),
    ...LIVE,
  });
