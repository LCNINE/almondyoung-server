'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AdminRecurringBillingRow } from '@/lib/types/dto/wallet';

const columnHelper = createColumnHelper<AdminRecurringBillingRow>();

function severityBadge(severity: string): 'default' | 'secondary' | 'destructive' {
  if (severity === 'CRITICAL') return 'destructive';
  if (severity === 'WARNING') return 'secondary';
  return 'default';
}

function issueTypeLabel(issueType: string): string {
  const map: Record<string, string> = {
    PROVIDER_METHOD: '결제수단',
    PROVIDER_MANDATE: '동의자료',
    PROVIDER_CHARGE: '출금',
    PAYMENT_INTENT: '결제',
    CONTRACT: '계약',
  };
  return map[issueType] ?? issueType;
}

function cmsMemberStatusLabel(status: string | undefined): string {
  if (!status) return '-';
  const map: Record<string, string> = {
    PENDING: '심사 중',
    REGISTERED: '사용 가능',
    FAILED: '심사 실패',
    DELETED: '삭제됨',
  };
  return map[status] ?? status;
}

function withdrawalStatusLabel(status: string | undefined): string {
  if (!status) return '-';
  const map: Record<string, string> = {
    REQUESTED: '출금 예약',
    PROCESSING: '출금 처리 중',
    SUCCEEDED: '출금 성공',
    FAILED: '출금 실패',
    DELETED: '출금 취소',
  };
  return map[status] ?? status;
}

function intentStatusLabel(status: string | undefined): string {
  if (!status) return '-';
  const map: Record<string, string> = {
    PENDING_SETTLEMENT: '출금 결과 대기',
    AUTHORIZED: '결제 완료',
    CAPTURED: '결제 완료',
    FAILED: '결제 실패',
  };
  return map[status] ?? status;
}

function formatDate(str: string | undefined | null): string {
  if (!str) return '-';
  return new Date(str).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

type UseColumnsOptions = {
  onDetail: (row: AdminRecurringBillingRow) => void;
  onPollMember?: (row: AdminRecurringBillingRow) => void;
  onPollWithdrawal?: (row: AdminRecurringBillingRow) => void;
  view?: string;
};

export const useRecurringBillingTableColumns = ({
  onDetail,
  onPollMember,
  onPollWithdrawal,
}: UseColumnsOptions = { onDetail: () => {} }) => {
  return useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '고객 ID',
        cell: ({ getValue }) => {
          const id = getValue();
          const short = id ? `${id.slice(0, 8)}...` : '-';
          return (
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs">{short}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs"
                onClick={() => navigator.clipboard.writeText(id ?? '')}
                title="복사"
              >
                복사
              </button>
            </div>
          );
        },
      }),
      columnHelper.accessor('issueType', {
        header: '처리 구분',
        cell: ({ getValue }) => (
          <Badge variant="outline">{issueTypeLabel(getValue())}</Badge>
        ),
      }),
      columnHelper.accessor('severity', {
        header: '심각도',
        cell: ({ getValue }) => {
          const severity = getValue();
          return <Badge variant={severityBadge(severity)}>{severity}</Badge>;
        },
      }),
      columnHelper.display({
        id: 'displayStatus',
        header: '상태',
        cell: ({ row }) => {
          const r = row.original;
          const ps = r.providerState;
          if (ps?.cmsMemberStatus) {
            return <span className="text-sm">{cmsMemberStatusLabel(ps.cmsMemberStatus)}</span>;
          }
          if (ps?.withdrawalStatus) {
            return <span className="text-sm">{withdrawalStatusLabel(ps.withdrawalStatus)}</span>;
          }
          if (r.paymentIntentStatus) {
            return <span className="text-sm">{intentStatusLabel(r.paymentIntentStatus)}</span>;
          }
          return <span className="text-muted-foreground text-sm">-</span>;
        },
      }),
      columnHelper.display({
        id: 'resultMessage',
        header: '실패 사유',
        cell: ({ row }) => {
          const msg = row.original.providerState?.resultMessage;
          if (!msg) return <span className="text-muted-foreground text-sm">-</span>;
          const truncated = msg.length > 40 ? `${msg.slice(0, 40)}...` : msg;
          return (
            <span className="text-sm" title={msg}>
              {truncated}
            </span>
          );
        },
      }),
      columnHelper.accessor('amount', {
        header: '금액',
        cell: ({ getValue }) => {
          const v = getValue();
          if (v == null) return <span className="text-muted-foreground text-sm">-</span>;
          return <span className="text-sm">{v.toLocaleString()}원</span>;
        },
      }),
      columnHelper.display({
        id: 'paymentDate',
        header: '출금일',
        cell: ({ row }) => (
          <span className="text-sm">{formatDate(row.original.providerState?.paymentDate)}</span>
        ),
      }),
      columnHelper.accessor('updatedAt', {
        header: '최근 갱신',
        cell: ({ getValue }) => <span className="text-sm">{formatDate(getValue())}</span>,
      }),
      columnHelper.display({
        id: 'actions',
        header: '액션',
        cell: ({ row }) => {
          const r = row.original;
          const showPollMember =
            !!r.providerState?.cmsMemberId &&
            r.providerState?.cmsMemberStatus === 'PENDING';
          const showPollWithdrawal = !!r.providerState?.withdrawalId;
          return (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onDetail(r)}
              >
                상세
              </Button>
              {showPollMember && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onPollMember?.(r)}
                >
                  심사 새로고침
                </Button>
              )}
              {showPollWithdrawal && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onPollWithdrawal?.(r)}
                >
                  출금 새로고침
                </Button>
              )}
            </div>
          );
        },
      }),
    ],
    [onDetail, onPollMember, onPollWithdrawal],
  );
};
