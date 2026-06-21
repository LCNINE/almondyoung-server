// src/lib/services/customers/mutations.ts
// Customers 도메인 뮤테이션 함수들
'use client';

import { customerApi } from '@/lib/api/domains/customer';
import { BusinessLicenseUpsertDto } from '@/lib/types/dto/business-licenses';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customerQueryKeys } from './query-keys';

// 특정 고객의 사업자 등록 정보 등록/수정 (upsert)
export const useUpsertBusinessLicenseByUserId = (userId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: BusinessLicenseUpsertDto) =>
      customerApi.upsertBusinessLicenseByUserId(userId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customerQueryKeys.businessLicenseByUserId(userId),
      });
    },
  });
};
