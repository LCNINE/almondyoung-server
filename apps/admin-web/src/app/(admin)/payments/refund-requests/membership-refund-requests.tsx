'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { usePermissionCheck } from '@/hooks/use-permission';
import { useUserNames, type UserInfo } from '@/hooks/use-user-names';
import type { AdminMemberListItem } from '@/lib/api/domains/membership';
import {
  useCompleteManualRefund,
  useMemberDetail,
  useMembershipMembers,
} from '@/lib/services/membership';
import { bankName, manualRefundState } from '@/lib/utils/manual-refund';

function MembershipRefundRow({
  member,
  user,
}: {
  member: AdminMemberListItem;
  user?: UserInfo;
}) {
  const {
    data: detail,
    isLoading,
    isError,
  } = useMemberDetail(member.userId, member.contractId);
  const complete = useCompleteManualRefund();
  const { canRun } = usePermissionCheck();

  const matchesContract = detail?.contractId === member.contractId;
  const refund = manualRefundState(matchesContract ? detail : undefined);
  const account = matchesContract ? detail?.manualRefundAccount : null;
  const cancelledAt =
    member.cancelledAt ??
    member.cancellation?.requestedAt ??
    member.recurringCancelledAt;

  const handleComplete = async () => {
    if (
      !refund.canComplete ||
      !canRun(useCompleteManualRefund) ||
      complete.isPending
    ) {
      return;
    }

    try {
      await complete.mutateAsync({ contractId: member.contractId });
      toast.success('환불 완료로 기록했어요.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '환불 완료 처리에 실패했어요.'
      );
    }
  };

  const handleCopyAccount = async (accountNumber: string) => {
    try {
      await navigator.clipboard.writeText(accountNumber);
      toast.success('계좌번호를 복사했어요.');
    } catch {
      toast.error('복사하지 못했어요. 직접 선택해서 복사해 주세요.');
    }
  };

  const amountText = `${(detail?.eligibleRefundAmount ?? 0).toLocaleString('ko-KR')}원`;
  const accountText = account
    ? `${bankName(account.bank)} ${account.accountNumber} (${account.holderName})`
    : '고객 계좌';
  const buttonLabel = refund.pgAlreadyRefunded ? refund.label : '이체했어요';

  return (
    <tr className="border-t">
      <td className="p-3">
        <Link
          href={`/customer-window/${member.userId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary hover:underline"
        >
          {user?.loginId || member.userId}
        </Link>
      </td>
      <td className="p-3">{user?.username || '-'}</td>
      <td className="p-3 font-medium">
        {matchesContract
          ? `${(detail?.eligibleRefundAmount ?? 0).toLocaleString('ko-KR')}원`
          : '-'}
      </td>
      <td className="p-3">
        {account ? (
          <>
            {bankName(account.bank)}{' '}
            <span className="font-mono">{account.accountNumber}</span> ·{' '}
            {account.holderName}
            <Button
              size="sm"
              variant="ghost"
              className="ml-1 h-7 px-2 text-xs"
              onClick={() => handleCopyAccount(account.accountNumber)}
            >
              계좌번호 복사
            </Button>
          </>
        ) : isLoading ? (
          '불러오는 중이에요.'
        ) : (
          '계좌 확인이 필요해요.'
        )}
      </td>
      <td className="p-3 text-muted-foreground">
        {cancelledAt ? new Date(cancelledAt).toLocaleString('ko-KR') : '-'}
      </td>
      <td className="p-3 text-right">
        {isError ? (
          <span>상세를 불러오지 못했어요.</span>
        ) : detail && !matchesContract ? (
          <span>환불 대상 계약을 확인해 주세요.</span>
        ) : refund.pgConfirmPending ? (
          <span className="font-medium text-muted-foreground">
            PG 환불 확정을 기다리고 있어요.
          </span>
        ) : refund.canComplete && canRun(useCompleteManualRefund) ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={complete.isPending}>
                {complete.isPending ? '기록하는 중이에요' : buttonLabel}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {refund.pgAlreadyRefunded ? refund.label : '이체를 마쳤나요?'}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  {refund.pgAlreadyRefunded ? (
                    <p>{refund.question}</p>
                  ) : (
                    <div className="space-y-2">
                      <p>
                        <span className="font-semibold text-foreground">
                          {accountText}
                        </span>
                        로{' '}
                        <span className="font-semibold text-foreground">
                          {amountText}
                        </span>
                        을 회사 계좌에서 이체했을 때만 눌러 주세요.
                      </p>
                      <p>
                        이 버튼은 돈을 보내지 않아요. 이체했다는 기록만 남겨요.
                      </p>
                      <p>기록하면 되돌릴 수 없어요.</p>
                    </div>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {refund.pgAlreadyRefunded ? '취소' : '아직이에요'}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleComplete}
                  disabled={complete.isPending}
                >
                  {refund.pgAlreadyRefunded ? refund.label : '네, 이체했어요'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </td>
    </tr>
  );
}

export function MembershipRefundRequests() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data, isLoading, isError } = useMembershipMembers({
    page,
    limit,
    refundPending: true,
  });

  const rows = useMemo(
    () =>
      data?.data.filter((member) => member.hasPaymentIntent !== false) ?? [],
    [data?.data]
  );
  const userIds = useMemo(() => rows.map((member) => member.userId), [rows]);
  const userMap = useUserNames(userIds);
  const total = data?.total ?? 0;

  return (
    <div className="rounded-lg border bg-card">
      <div className="space-y-1 border-b p-4">
        <h1 className="text-lg font-semibold">멤버십 환불 (수동 송금)</h1>
        <p className="text-sm text-muted-foreground">
          효성 CMS 자동이체 결제는 PG 환불이 안 돼요.
        </p>
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li>계좌번호를 복사해서 회사 계좌에서 이체해 주세요.</li>
          <li>이체가 끝나면 이체했어요를 눌러 기록을 남겨 주세요.</li>
        </ol>
        <p className="text-sm font-semibold text-foreground">
          이체했어요 버튼은 돈을 보내지 않아요.
        </p>
      </div>
      {isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : isError ? (
        <p role="alert" className="p-8 text-center text-sm">
          환불 요청을 불러오지 못했어요.
        </p>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          대기 중인 멤버십 환불 요청이 없어요.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">로그인 아이디</th>
                <th className="p-3">성명</th>
                <th className="p-3">환불 금액</th>
                <th className="p-3">환불 계좌</th>
                <th className="p-3">해지 일시</th>
                <th className="p-3 text-right">이체 후 기록</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <MembershipRefundRow
                  key={member.contractId}
                  member={member}
                  user={userMap[member.userId]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(total > limit || page > 1) && (
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span className="text-muted-foreground">
            총 {total}건 · {page}페이지
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              이전
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page * limit >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
