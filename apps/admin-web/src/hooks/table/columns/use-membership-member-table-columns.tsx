'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AdminMemberListItem } from '@/lib/api/domains/membership';

const columnHelper = createColumnHelper<AdminMemberListItem>();

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  ACTIVE: { label: '활성화', variant: 'default' },
  PAUSED: { label: '일시정지', variant: 'secondary' },
  CANCELLED: { label: '해지', variant: 'destructive' },
  EXPIRED: { label: '만료', variant: 'outline' },
};

function getRemainingDays(endsAt: string | null): string {
  if (!endsAt) return '-';
  const end = new Date(endsAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return '만료됨';
  if (diff === 0) return '오늘 만료';
  return `${diff}일 남음`;
}

function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return '-';
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-';
  return `${fmt(startsAt)} ~ ${fmt(endsAt)}`;
}

function getPlanLabel(durationDays: number): string {
  if (durationDays >= 365) return '연간';
  if (durationDays >= 28) return '월간';
  return `${durationDays}일`;
}

import { UserInfo } from '@/hooks/use-user-names';

type UseColumnsOptions = {
  onEdit?: (row: AdminMemberListItem) => void;
  userMap?: Record<string, UserInfo>;
};

export const useMembershipMemberTableColumns = ({ onEdit, userMap = {} }: UseColumnsOptions = {}) => {
  return useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '로그인 아이디',
        cell: ({ getValue }) => {
          const userId = getValue();
          const loginId = userMap[userId]?.loginId;
          return (
            <Link
              href={`/customer-window/${userId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary text-xs hover:underline"
            >
              {loginId || userId}
            </Link>
          );
        },
      }),
      columnHelper.display({
        id: 'name',
        header: '성명',
        cell: ({ row }) => (
          <span className="text-sm">
            {userMap[row.original.userId]?.username ?? <span className="text-muted-foreground">-</span>}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'remainingDays',
        header: '남은 구독 기간',
        cell: ({ row }) => (
          <span className="text-sm">{getRemainingDays(row.original.endsAt)}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const status = getValue();
          const config = statusConfig[status] ?? { label: status, variant: 'outline' as const };
          return <Badge variant={config.variant}>{config.label}</Badge>;
        },
      }),
      columnHelper.accessor('tierCode', {
        header: '플랜',
        cell: ({ getValue, row }) => (
          <span className="text-sm">
            {getValue()} ({getPlanLabel(row.original.planDurationDays)})
          </span>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: '최초 등록일',
        cell: ({ getValue }) => (
          <span className="text-sm">
            {new Date(getValue()).toLocaleDateString('ko-KR')}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'subscriptionPeriod',
        header: '구독 시작 ~ 종료',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateRange(row.original.startsAt, row.original.endsAt)}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onEdit?.(row.original)}
          >
            수정
          </Button>
        ),
      }),
    ],
    [onEdit, userMap],
  );
};
