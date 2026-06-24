// src/lib/services/customers/mutations.ts
// Customers 도메인 뮤테이션 (관리자 회원 상세정보 수정)
'use client';

import { customerApi } from '@/lib/api/domains/customer';
import {
  AdminUpdateBusinessLicenseDto,
  AdminUpdateUserDto,
} from '@/lib/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customerQueryKeys } from './query-keys';

// 회원 기본정보 수정
export const useUpdateUser = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AdminUpdateUserDto) => customerApi.updateUser(userId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customerQueryKeys.detailById(userId),
      });
    },
  });
};

// 사업자등록증 심사 수정
export const useUpdateBusinessLicense = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      businessId,
      dto,
    }: {
      businessId: string;
      dto: AdminUpdateBusinessLicenseDto;
    }) => customerApi.updateBusinessLicense(businessId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customerQueryKeys.businessLicenseByUserId(userId),
      });
    },
  });
};

// 사업자등록증 등록/수정 (userId 기준 upsert)
export const useUpsertBusinessLicense = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { businessNumber: string; representativeName: string }) =>
      customerApi.upsertBusinessLicense(userId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customerQueryKeys.businessLicenseByUserId(userId),
      });
    },
  });
};

// 회원 역할 일괄 교체
export const useSetUserRoles = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleIds: string[]) => customerApi.setUserRoles(userId, roleIds),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customerQueryKeys.userRoles(userId),
      });
      queryClient.invalidateQueries({
        queryKey: customerQueryKeys.detailById(userId),
      });
    },
  });
};
