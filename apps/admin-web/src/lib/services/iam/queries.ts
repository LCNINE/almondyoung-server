'use client';

import { iamApi } from '@/lib/api/domains/iam';
import type { IamAuditFilter } from '@/lib/types/dto/iam';
import { useInfiniteQuery } from '@tanstack/react-query';
import { iamQueryKeys } from './query-keys';

/** 역할·권한·부여 변경 이력(최신순, 커서로 더 불러오기). */
export const useIamAuditLogs = (filter: IamAuditFilter) =>
  useInfiniteQuery({
    queryKey: iamQueryKeys.auditLogs(filter),
    queryFn: ({ pageParam }) => iamApi.auditLogs(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
