'use client';

import { useReadGate } from '@/features/main/read-gate';
import { useMembershipMembers } from '@/lib/services/membership';
import { useRefundRequests } from '@/lib/services/wallet';

export function useRefundRequestCounts() {
  const walletGate = useReadGate(['payment.refund.read']);
  const billingGate = useReadGate(['membership.billing.read']);
  const memberGate = useReadGate(['membership.member.read']);
  const membershipEnabled = billingGate.enabled && memberGate.enabled;

  const wallet = useRefundRequests(1, 1, { enabled: walletGate.enabled });
  const membership = useMembershipMembers(
    { page: 1, limit: 1, refundPending: true },
    { enabled: membershipEnabled }
  );

  const walletTotal = walletGate.enabled ? (wallet.data?.total ?? 0) : 0;
  const membershipTotal = membershipEnabled ? (membership.data?.total ?? 0) : 0;

  return {
    wallet,
    membership,
    walletEnabled: walletGate.enabled,
    membershipEnabled,
    walletTotal,
    membershipTotal,
    count: walletTotal + membershipTotal,
    isLoading:
      walletGate.pending ||
      billingGate.pending ||
      memberGate.pending ||
      (walletGate.enabled && wallet.isLoading) ||
      (membershipEnabled && membership.isLoading),
    isError:
      walletGate.failed ||
      billingGate.failed ||
      memberGate.failed ||
      (walletGate.enabled && wallet.isError) ||
      (membershipEnabled && membership.isError),
    hiddenReason:
      walletGate.enabled || membershipEnabled
        ? null
        : (walletGate.hiddenReason ??
          billingGate.hiddenReason ??
          memberGate.hiddenReason),
  };
}
