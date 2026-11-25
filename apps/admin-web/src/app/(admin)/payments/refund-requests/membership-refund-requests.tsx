'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
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
  useSetRefundResolution,
} from '@/lib/services/membership';
import { bankName, manualRefundState } from '@/lib/utils/manual-refund';

type ResolutionFilter = 'all' | 'need' | 'ready';

const formatResolutionTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function MembershipRefundRow({
  member,
  user,
  submitter,
}: {
  member: AdminMemberListItem;
  user?: UserInfo;
  submitter?: UserInfo;
}) {
  const {
    data: detail,
    isLoading,
    isError,
  } = useMemberDetail(member.userId, member.contractId);
  const complete = useCompleteManualRefund();
  const resolution = useSetRefundResolution();
  const { canRun } = usePermissionCheck();
  const resolutionAt = member.refundResolutionSubmittedAt ?? null;

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

  const handleResolution = async (submitted: boolean) => {
    if (!canRun(useSetRefundResolution) || resolution.isPending) {
      return;
    }

    try {
      await resolution.mutateAsync({
        contractId: member.contractId,
        submitted,
      });
      toast.success(
        submitted
          ? '결의서를 올렸다고 기록했어요.'
          : '결의서 기록을 되돌렸어요.'
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '결의서 기록에 실패했어요.'
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
      <td className="whitespace-nowrap p-3">
        {resolutionAt ? (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              <Check className="size-3" aria-hidden />
              올렸어요
            </span>
            <span className="text-xs text-muted-foreground">
              {formatResolutionTime(resolutionAt)}
              {submitter?.username ? ` · ${submitter.username}` : ''}
              {canRun(useSetRefundResolution) && (
                <button
                  type="button"
                  className="ml-1 underline disabled:opacity-50"
                  disabled={resolution.isPending}
                  onClick={() => handleResolution(false)}
                >
                  되돌리기
                </button>
              )}
            </span>
          </div>
        ) : canRun(useSetRefundResolution) ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={resolution.isPending}
              >
                올렸어요
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  셀메이트에 결의서를 올렸나요?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold text-foreground">
                        {user?.loginId || member.userId}
                      </span>{' '}
                      회원의{' '}
                      <span className="font-semibold text-foreground">
                        {amountText}
                      </span>{' '}
                      환불 결의서예요.
                    </p>
                    <p>올린 시각과 올린 사람이 기록돼요.</p>
                    <p>잘못 눌렀으면 되돌릴 수 있어요.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>아직이에요</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleResolution(true)}>
                  네, 올렸어요
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span className="text-muted-foreground">아직 안 올렸어요</span>
        )}
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
        ) : refund.canComplete &&
          canRun(useCompleteManualRefund) &&
          refund.needsResolution ? (
          <div className="inline-flex flex-col items-end gap-0.5">
            <Button size="sm" variant="outline" disabled>
              이체했어요
            </Button>
            <span className="text-xs text-muted-foreground">
              결의서를 먼저 올려 주세요
            </span>
          </div>
        ) : refund.canComplete && canRun(useCompleteManualRefund) ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={complete.isPending}>
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
  const [filter, setFilter] = useState<ResolutionFilter>('all');
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
  const userIds = useMemo(
    () => [
      ...rows.map((member) => member.userId),
      ...rows.flatMap((member) =>
        member.refundResolutionSubmittedBy
          ? [member.refundResolutionSubmittedBy]
          : []
      ),
    ],
    [rows]
  );
  const userMap = useUserNames(userIds);
  const total = data?.total ?? 0;

  // ponytail: 요약·필터는 지금 페이지(최대 20건) 기준. 대기 건이 20건을 넘기면 서버 집계로 옮긴다.
  const needResolution = rows.filter(
    (member) => !member.refundResolutionSubmittedAt
  );
  const needTransfer = rows.filter(
    (member) => member.refundResolutionSubmittedAt
  );
  const pendingAmount = rows.reduce(
    (sum, member) => sum + (member.eligibleRefundAmount ?? 0),
    0
  );
  const visibleRows =
    filter === 'need'
      ? needResolution
      : filter === 'ready'
        ? needTransfer
        : rows;
  const filters: { key: ResolutionFilter; label: string; count: number }[] = [
    { key: 'all', label: '전체', count: rows.length },
    { key: 'need', label: '결의서 올릴 것', count: needResolution.length },
    { key: 'ready', label: '이체 완료 누를 것', count: needTransfer.length },
  ];

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-6 border-b p-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">멤버십 환불 (수동 송금)</h1>
          <p className="text-sm text-muted-foreground">
            효성 CMS 자동이체 결제는 PG 환불이 안 돼요.
          </p>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
            <li>
              셀메이트에 지출결의서를 올리고{' '}
              <b className="text-foreground">올렸어요</b>를 눌러 주세요.
            </li>
            <li>계좌번호를 복사해서 회사 계좌에서 이체해 주세요.</li>
            <li>
              이체가 끝나면 <b className="text-foreground">이체했어요</b>를 눌러
              기록을 남겨 주세요.
            </li>
          </ol>
          <p className="text-sm font-semibold text-foreground">
            결의서 작성이 끝나고 이체까지 마치면 이체했어요를 눌러 주세요.
          </p>
        </div>
        {rows.length > 0 && (
          <dl className="flex flex-wrap gap-2">
            {[
              ['결의서 올릴 것', `${needResolution.length}건`],
              ['이체 완료 누를 것', `${needTransfer.length}건`],
              ['이체 대기 금액', `${pendingAmount.toLocaleString('ko-KR')}원`],
            ].map(([label, value]) => (
              <div key={label} className="min-w-32 rounded-lg border px-4 py-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        )}
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
        <>
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-3">
            {filters.map((item) => (
              <Button
                key={item.key}
                size="sm"
                variant={filter === item.key ? 'default' : 'outline'}
                className="h-8 rounded-full"
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                {item.label} <span className="font-semibold">{item.count}</span>
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">로그인 아이디</th>
                  <th className="p-3">성명</th>
                  <th className="p-3">환불 금액</th>
                  <th className="p-3">환불 계좌</th>
                  <th className="p-3">해지 일시</th>
                  <th className="p-3">셀메이트 결의서</th>
                  <th className="p-3 text-right">이체 후 기록</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((member) => (
                  <MembershipRefundRow
                    key={member.contractId}
                    member={member}
                    user={userMap[member.userId]}
                    submitter={
                      member.refundResolutionSubmittedBy
                        ? userMap[member.refundResolutionSubmittedBy]
                        : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
            {visibleRows.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                이 조건의 환불 요청이 없어요.
              </p>
            )}
          </div>
        </>
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
