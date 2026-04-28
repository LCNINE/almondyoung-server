'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { membershipApi, AdminMembersQuery, AdminBillingHistoryQuery, AdminTierWithPlans } from '@/lib/api/domains/membership';
import { membershipQueryKeys } from './query-keys';

export const useMembershipMembers = (
  query: AdminMembersQuery,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: membershipQueryKeys.memberList(query),
    queryFn: () => membershipApi.getAdminMembers(query),
    enabled: options?.enabled ?? true,
  });
};

export const useMemberDetail = (userId: string | null) => {
  return useQuery({
    queryKey: membershipQueryKeys.memberDetail(userId ?? ''),
    queryFn: () => membershipApi.getMemberDetail(userId!),
    enabled: !!userId,
  });
};

export const useMemberBillingEvents = (contractId: string | null) => {
  return useQuery({
    queryKey: membershipQueryKeys.billingEvents(contractId ?? ''),
    queryFn: () => membershipApi.getMemberBillingEvents(contractId!),
    enabled: !!contractId,
  });
};

export const useMemberContractEvents = (contractId: string | null) => {
  return useQuery({
    queryKey: membershipQueryKeys.contractEvents(contractId ?? ''),
    queryFn: () => membershipApi.getMemberContractEvents(contractId!),
    enabled: !!contractId,
  });
};

export const useSetAutoRenewal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contractId, autoRenewal }: { contractId: string; autoRenewal: boolean }) =>
      membershipApi.setAutoRenewal(contractId, autoRenewal),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipQueryKeys.all });
    },
  });
};

export const useAdjustEntitlement = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      days,
      reason,
    }: {
      userId: string;
      days: number;
      reason: string;
    }) => membershipApi.adjustEntitlement(userId, days, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipQueryKeys.all });
    },
  });
};

export const useBillingHistory = (query: AdminBillingHistoryQuery) => {
  return useQuery({
    queryKey: membershipQueryKeys.billingHistory(query),
    queryFn: () => membershipApi.getAllBillingHistory(query),
  });
};

export const useTiersWithPlans = () => {
  return useQuery({
    queryKey: membershipQueryKeys.tiersWithPlans(),
    queryFn: () => membershipApi.getAllTiersWithPlans(),
  });
};

export const useCreateTier = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { code: string; priorityLevel: number }) => membershipApi.createTier(body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: membershipQueryKeys.tiersWithPlans() }); },
  });
};

export const useUpdateTier = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tierId, ...body }: { tierId: string; priorityLevel?: number }) =>
      membershipApi.updateTier(tierId, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: membershipQueryKeys.tiersWithPlans() }); },
  });
};

export const useCreatePlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { tierId: string; price: number; durationDays: number; currency?: string; trialDays?: number }) =>
      membershipApi.createPlan(body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: membershipQueryKeys.tiersWithPlans() }); },
  });
};

export const useUpdatePlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, ...body }: { planId: string; price?: number; durationDays?: number; trialDays?: number }) =>
      membershipApi.updatePlan(planId, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: membershipQueryKeys.tiersWithPlans() }); },
  });
};

export const useDeactivatePlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, reason }: { planId: string; reason: string }) =>
      membershipApi.deactivatePlan(planId, reason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: membershipQueryKeys.tiersWithPlans() }); },
  });
};

export const useForceCancelSubscription = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      contractId,
      reason,
      refundType,
      refundAmount,
      adminNote,
    }: {
      contractId: string;
      reason: string;
      refundType: 'FULL' | 'PARTIAL' | 'NONE';
      refundAmount?: number;
      adminNote?: string;
    }) =>
      membershipApi.forceCancelSubscription(contractId, {
        reason,
        refundType,
        refundAmount,
        adminNote,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipQueryKeys.all });
    },
  });
};
