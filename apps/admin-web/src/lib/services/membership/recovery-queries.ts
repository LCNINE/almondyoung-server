'use client';

import { useQuery } from '@tanstack/react-query';
import { membershipRecoveryApi } from '@/lib/api/domains/membership/recovery';
import {
  alimtalkApi,
  MembershipNoticeLookup,
} from '@/lib/api/domains/alimtalk';
import { membershipQueryKeys } from './query-keys';

export const useBillingRecovery = (month: string) =>
  useQuery({
    queryKey: membershipQueryKeys.billingRecovery(month),
    queryFn: () => membershipRecoveryApi.getOverview(month),
    staleTime: 30 * 1000,
  });

export const useBillingRecoveryJourney = (userId: string | null) =>
  useQuery({
    queryKey: membershipQueryKeys.billingRecoveryJourney(userId ?? ''),
    queryFn: () => membershipRecoveryApi.getJourney(userId as string),
    enabled: !!userId,
  });

const refKeys = (refs: MembershipNoticeLookup): string[] => [
  ...refs.attempts.map((a) => `attempt:${a.invoiceId}:${a.attemptNo}`),
  ...refs.terminations.map((t) => `terminated:${t.contractId}`),
];

/**
 * 안내가 알림 서비스에 접수됐는지. 알림 서비스가 죽어도 현황은 멤버십 기록만으로 보여야 하므로,
 * 실패하면 화면은 «확인 못 함»으로 둔다(재시도 1번).
 */
export const useMembershipNoticeStatuses = (refs: MembershipNoticeLookup) => {
  const keys = refKeys(refs);
  return useQuery({
    queryKey: membershipQueryKeys.membershipNotices(keys),
    queryFn: async () => {
      const items = await alimtalkApi.lookupMembershipNotices(refs);
      return new Map(items.map((item) => [item.ref, item]));
    },
    enabled: keys.length > 0,
    staleTime: 30 * 1000,
    retry: 1,
  });
};
