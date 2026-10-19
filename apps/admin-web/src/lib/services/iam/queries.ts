'use client';

import { iamApi } from '@/lib/api/domains/iam';
import type { IamAuditFilter, PiiAccessFilter } from '@/lib/types/dto/iam';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { iamQueryKeys } from './query-keys';

/** 역할·권한·부여 변경 이력(최신순, 커서로 더 불러오기). */
export const useIamAuditLogs = (filter: IamAuditFilter) =>
  useInfiniteQuery({
    queryKey: iamQueryKeys.auditLogs(filter),
    queryFn: ({ pageParam }) => iamApi.auditLogs(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

/** 개인정보 접속기록(최신순). 조회 자체도 서버가 변경 이력에 남긴다. */
export const usePiiAccessLogs = (filter: PiiAccessFilter) =>
  useInfiniteQuery({
    queryKey: iamQueryKeys.piiAccessLogs(filter),
    queryFn: ({ pageParam }) => iamApi.piiAccessLogs(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

export const usePiiAccessSummary = (from: string, to: string) =>
  useQuery({
    queryKey: iamQueryKeys.piiAccessSummary(from, to),
    queryFn: () => iamApi.piiAccessSummary(from, to),
  });

export const usePiiAccessReviews = () =>
  useQuery({
    queryKey: iamQueryKeys.piiAccessReviews(),
    queryFn: () => iamApi.piiAccessReviews(),
  });
