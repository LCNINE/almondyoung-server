'use client';

import Link from 'next/link';
import { useOptionalAdminUser } from '@/lib/services/users/queries';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPhoneNumber } from '@/lib/utils/phone';

export function EntryAuthor({
  userId,
  maskedName,
}: {
  userId: string;
  maskedName: string;
}) {
  const { data: user, isLoading } = useOptionalAdminUser(userId);

  if (isLoading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }

  if (!user) {
    return (
      <span className="text-sm text-muted-foreground">{maskedName}</span>
    );
  }

  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <Link
        href={`/customer-window/${userId}`}
        target="_blank"
        className="font-medium hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {user.username}
      </Link>
      <p className="text-xs text-muted-foreground">{user.loginId}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {user.profile?.phoneNumber ? formatPhoneNumber(user.profile.phoneNumber) : '연락처 없음'}
      </p>
    </div>
  );
}
