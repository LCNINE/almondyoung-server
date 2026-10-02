'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AxisMembersQuery,
  MemberAxis,
  membershipPeopleApi,
} from '@/lib/api/domains/membership/people';
import { membershipQueryKeys } from './query-keys';

export const useMembershipInsights = () =>
  useQuery({
    queryKey: membershipQueryKeys.membersInsights(),
    queryFn: () => membershipPeopleApi.getInsights(),
    staleTime: 30 * 1000,
  });

export const useMembersByAxis = <A extends MemberAxis>(
  axis: A,
  query: AxisMembersQuery,
  options?: { enabled?: boolean }
) =>
  useQuery({
    queryKey: membershipQueryKeys.memberAxisList(
      axis,
      query as unknown as Record<string, unknown>
    ),
    queryFn: () => membershipPeopleApi.getMembersByAxis(axis, query),
    enabled: options?.enabled ?? true,
  });

export const useMemberArrears = (userId: string | null) =>
  useQuery({
    queryKey: membershipQueryKeys.memberArrears(userId ?? ''),
    queryFn: () => membershipPeopleApi.getMemberArrears(userId as string),
    enabled: !!userId,
  });

/** 면제·조정 뒤에는 그 사람의 미납 탭과 요약·목록 숫자가 모두 바뀐다. */
function useInvalidateArrears(userId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: membershipQueryKeys.memberArrears(userId),
      }),
      queryClient.invalidateQueries({
        queryKey: membershipQueryKeys.members(),
      }),
    ]);
}

export const useWaiveArrears = (userId: string) => {
  const invalidate = useInvalidateArrears(userId);
  return useMutation({
    mutationFn: ({
      arrearsId,
      reason,
    }: {
      arrearsId: string;
      reason: string;
    }) => membershipPeopleApi.waiveArrears(arrearsId, reason),
    onSettled: invalidate,
  });
};

export const useAdjustArrearsAmount = (userId: string) => {
  const invalidate = useInvalidateArrears(userId);
  return useMutation({
    mutationFn: ({
      arrearsId,
      amount,
      reason,
    }: {
      arrearsId: string;
      amount: number;
      reason: string;
    }) => membershipPeopleApi.adjustArrearsAmount(arrearsId, amount, reason),
    onSettled: invalidate,
  });
};
