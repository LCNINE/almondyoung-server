'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Crown, CalendarClock, SlidersHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TOSS_BANKS } from '@/lib/constants/toss-banks';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AdminMemberListItem } from '@/lib/api/domains/membership';
import {
  useMemberDetail,
  useMemberBillingEvents,
  useMemberContractEvents,
  useSetAutoRenewal,
  useAdjustEntitlement,
  useForceCancelSubscription,
  useScheduleCancelSubscription,
  useCompleteManualRefund,
  useCancellationQuote,
  useRetryBilling,
  useReconcileInvoice,
  useGrantSubscriptionByDays,
} from '@/lib/services/membership';
import { useUserNames } from '@/hooks/use-user-names';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import {
  getRemainingDays,
  getMembershipUsageDays,
  getBillingEventLabel,
  getMembershipStatus,
} from '@/lib/utils/membership';

interface MembershipMemberDetailDialogProps {
  member: AdminMemberListItem | null;
  open: boolean;
  onClose: () => void;
}

/** 서버가 내려준 안내 메시지(환불 한도 초과 사유 등)를 그대로 쓰기 위한 추출기. */
function serverMessage(error: unknown): string | undefined {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message;
  return typeof msg === 'string' && msg.trim() ? msg : undefined;
}

/** 은행코드를 사람이 읽는 이름으로. 모르는 코드는 코드 그대로 — 송금할 때 대조할 수 있어야 한다. */
function bankName(code: string): string {
  return TOSS_BANKS.find((b) => b.code === code)?.name ?? code;
}

// 라벨-값 한 줄 (shadcn Card 안에서 사용).
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all">{value ?? '-'}</span>
    </div>
  );
}

// 즉시 해지 + 환불 다이얼로그.
// 정책 견적(cancellation-quote)을 먼저 보여주고, 관리자는 그 금액을 그대로 쓰거나 사유와 함께 바꾼다.
interface ForceCancelDialogProps {
  open: boolean;
  onClose: () => void;
  contractId: string;
  /** 해지 안내 메일 수신 주소. membership 은 사용자 조회를 하지 않아 여기서 실어 보낸다. */
  customerEmail?: string;
  onSuccess: () => void;
}

function ForceCancelDialog({
  open,
  onClose,
  contractId,
  customerEmail,
  onSuccess,
}: ForceCancelDialogProps) {
  const [reason, setReason] = useState('');
  const [refundType, setRefundType] = useState<'FULL' | 'PARTIAL' | 'NONE'>(
    'NONE'
  );
  const [refundAmount, setRefundAmount] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [bank, setBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const forceCancelMutation = useForceCancelSubscription();
  const { data: quote, isLoading: quoteLoading } = useCancellationQuote(
    contractId,
    open
  );

  const immediate = quote?.options.find((o) => o.mode === 'IMMEDIATE_REFUND');
  const policyAmount = immediate?.refundAmount ?? 0;
  const isAnnual = (quote?.planName.durationDays ?? 0) >= 180;
  // 자동환불이 불가한 수단(효성 CMS)은 계좌 송금이 유일한 방법이라 계좌를 반드시 받는다.
  const manualRefund = immediate?.refundExecution === 'MANUAL';
  const needsAccount =
    refundType !== 'NONE' &&
    (manualRefund || !!immediate?.requiresReceiveAccount);
  const accountFilled = !!bank && !!accountNumber.trim() && !!holderName.trim();

  const handleClose = () => {
    setReason('');
    setRefundType('NONE');
    setRefundAmount('');
    setAdminNote('');
    setBank('');
    setAccountNumber('');
    setHolderName('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!reason.trim()) {
      toast.error('취소 사유를 입력해주세요.');
      return;
    }
    if (refundType === 'PARTIAL') {
      const amount = Number(refundAmount);
      if (!refundAmount || isNaN(amount) || amount <= 0) {
        toast.error('올바른 환불 금액을 입력해주세요.');
        return;
      }
    }
    if (needsAccount && !accountFilled) {
      toast.error('환불 송금 계좌(은행·계좌번호·예금주)를 입력해주세요.');
      return;
    }
    try {
      const result = await forceCancelMutation.mutateAsync({
        contractId,
        reason: reason.trim(),
        refundType,
        refundAmount:
          refundType === 'PARTIAL' ? Number(refundAmount) : undefined,
        adminNote: adminNote.trim() || undefined,
        customerEmail,
        refundReceiveAccount:
          needsAccount && accountFilled
            ? {
                bank,
                accountNumber: accountNumber.trim(),
                holderName: holderName.trim(),
              }
            : undefined,
      });
      // 환불 결과를 그대로 알린다 — PENDING/FAILED 는 돈이 아직 나가지 않았다는 뜻이다.
      if (result.refundStatus === 'FAILED') {
        toast.warning(
          '구독은 취소되었으나 환불이 실패했습니다. 계좌 송금으로 수동 처리해주세요.'
        );
      } else if (result.refundStatus === 'PENDING') {
        toast.warning(
          '구독이 취소되었습니다. 환불은 수동 송금 대기 상태입니다 — 송금 후 결제관리에서 완료 처리해주세요.'
        );
      } else if (result.refundStatus === 'COMPLETED') {
        toast.success(
          `구독이 즉시 취소되고 ${result.refundAmount.toLocaleString()}원이 환불되었습니다.`
        );
      } else {
        toast.success('구독이 즉시 취소되었습니다. (환불 없음)');
      }
      onSuccess();
      handleClose();
    } catch (error) {
      // 403(환불 한도 초과)·409(이미 해지됨) 처럼 조치 방법이 담긴 서버 메시지를 덮지 않는다.
      toast.error(serverMessage(error) ?? '강제 취소에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            즉시 해지 + 환불
          </DialogTitle>
          <DialogDescription>
            현재 구독 기간까지 즉시 종료됩니다. 이 작업은 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 정책 견적 — 관리자가 금액을 짐작하지 않게 한다 */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1.5">
            <p className="font-semibold">정책 기준 환불액</p>
            {quoteLoading ? (
              <Skeleton className="h-4 w-32 bg-gray-200" />
            ) : immediate ? (
              <>
                <p className="text-base font-bold">
                  {policyAmount.toLocaleString()}원
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {immediate.refundKind === 'WITHDRAWAL_FULL'
                      ? '(7일 내 청약철회 · 전액)'
                      : immediate.refundKind === 'ANNUAL_PRORATION'
                        ? '(연간 중도해지 정산)'
                        : '(정책상 환불 없음)'}
                  </span>
                </p>
                {immediate.breakdown && (
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    <li>
                      결제액 {immediate.breakdown.paidAmount.toLocaleString()}원
                    </li>
                    <li>
                      이용 {immediate.breakdown.monthsElapsed}개월 × 월 정가{' '}
                      {immediate.breakdown.monthlyListPrice.toLocaleString()}원 =
                      -{immediate.breakdown.usageDeduction.toLocaleString()}원
                    </li>
                    {immediate.breakdown.benefitDeduction > 0 && (
                      <li>
                        사용한 할인 혜택 -
                        {immediate.breakdown.benefitDeduction.toLocaleString()}원
                      </li>
                    )}
                  </ul>
                )}
                {!immediate.available && immediate.unavailableReason && (
                  <p className="text-xs text-amber-700">
                    {immediate.unavailableReason} (예외 환불은 아래에서 금액을
                    직접 지정)
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  환불 수단:{' '}
                  {manualRefund
                    ? '자동환불 불가 — 계좌 송금 필요(효성 CMS 등)'
                    : 'PG 자동환불 가능'}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                견적을 불러올 수 없습니다. 금액을 직접 지정해주세요.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>
              취소 사유 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder="취소 사유를 입력해주세요"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>
              환불 유형 <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={refundType}
              onValueChange={(v) => {
                const next = v as 'FULL' | 'PARTIAL' | 'NONE';
                setRefundType(next);
                // 정책 금액을 기본값으로 채워 오타·짐작을 줄인다.
                if (next === 'PARTIAL' && !refundAmount && policyAmount > 0) {
                  setRefundAmount(String(policyAmount));
                }
              }}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="NONE" id="refund-none" />
                <Label
                  htmlFor="refund-none"
                  className="font-normal cursor-pointer"
                >
                  환불 없음
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="PARTIAL" id="refund-partial" />
                <Label
                  htmlFor="refund-partial"
                  className="font-normal cursor-pointer"
                >
                  {policyAmount > 0 ? '정책 금액/직접 입력' : '금액 직접 입력'}
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="FULL" id="refund-full" />
                <Label
                  htmlFor="refund-full"
                  className="font-normal cursor-pointer"
                >
                  전액 환불{isAnnual ? ' (연간 전액 — 주의)' : ''}
                </Label>
              </div>
            </RadioGroup>
            {refundType === 'FULL' && isAnnual && (
              <p className="text-xs text-amber-700">
                연간 플랜 전액 환불은 정책 정산(
                {policyAmount.toLocaleString()}원)보다 큽니다. 장애 보상 등
                예외인지 확인해주세요.
              </p>
            )}
          </div>

          {refundType === 'PARTIAL' && (
            <div className="space-y-1.5">
              <Label>
                환불 금액 (원) <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="환불 금액 입력"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  min={0}
                />
                {policyAmount > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRefundAmount(String(policyAmount))}
                  >
                    정책 금액
                  </Button>
                )}
              </div>
            </div>
          )}

          {needsAccount && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                환불 송금 계좌 <span className="text-destructive">*</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {manualRefund
                  ? '자동이체(효성 CMS) 결제는 PG 환불이 불가해 이 계좌로 송금합니다.'
                  : '무통장 결제 환불은 이 계좌로 송금됩니다. 예금주명이 정확해야 합니다(실명 검증).'}
              </p>
              {/* 은행은 코드 직접 입력이 아니라 선택 — 결제관리 환불 화면과 같은 방식(오타로 송금 실패 방지) */}
              <div className="space-y-1">
                <Label htmlFor="refund-bank">환불 은행</Label>
                <select
                  id="refund-bank"
                  className="w-full rounded border p-2 text-sm"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                >
                  <option value="">은행 선택</option>
                  {TOSS_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="refund-account-number">계좌번호</Label>
                <Input
                  id="refund-account-number"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="숫자만 입력 (예: 110123456789)"
                  value={accountNumber}
                  onChange={(e) =>
                    setAccountNumber(e.target.value.replace(/[^0-9]/g, ''))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="refund-holder-name">예금주명</Label>
                <Input
                  id="refund-holder-name"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="예금주 실명"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>관리자 메모 (선택)</Label>
            <Textarea
              placeholder="내부 메모 (고객에게 표시되지 않음)"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            닫기
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={forceCancelMutation.isPending}
          >
            {forceCancelMutation.isPending ? '처리 중...' : '즉시 해지 확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustForm({ userId }: { userId: string }) {
  const mutation = useAdjustEntitlement();
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = async () => {
    const d = Number(days);
    if (!d || !reason.trim()) {
      toast.error('일수와 사유를 입력해주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({ userId, days: d, reason: reason.trim() });
      toast.success('구독 기간이 조정되었습니다.');
      setDays('');
      setReason('');
    } catch {
      toast.error('구독 기간 조정에 실패했습니다.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <SlidersHorizontal className="text-indigo-500 size-4" />
          구독 기간 조정
        </CardTitle>
        <CardDescription>양수: 연장 / 음수: 단축 (예: 7, -3)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="일수 (예: 7)"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-32"
          />
          <Input
            placeholder="사유 입력"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex-1"
          />
        </div>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={mutation.isPending}
          className="w-full"
        >
          {mutation.isPending ? '처리 중...' : '변경하기'}
        </Button>
      </CardContent>
    </Card>
  );
}

function GrantForm({ userId }: { userId: string }) {
  const mutation = useGrantSubscriptionByDays();
  const [days, setDays] = useState('');
  const [memo, setMemo] = useState('');

  const handleSubmit = async () => {
    const d = Number(days);
    if (!d || d < 1) {
      toast.error('1일 이상의 일수를 입력해주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        userId,
        days: d,
        memo: memo.trim() || undefined,
      });
      toast.success('구독이 지급되었습니다.');
      setDays('');
      setMemo('');
    } catch (e: any) {
      const msg: string = e?.response?.data?.message ?? e?.message ?? '';
      if (msg.includes('이미 활성')) {
        toast.error(
          '이미 활성 구독이 있는 회원입니다. 기간 조정 기능을 이용하세요.'
        );
      } else {
        toast.error('구독 지급에 실패했습니다.');
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Crown className="text-indigo-500 size-4" />
          구독 지급
        </CardTitle>
        <CardDescription>
          지급할 일수와 사유(메모)를 입력하세요. 마이페이지에서 확인할 수
          있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="일수 (예: 30)"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            min={1}
            className="w-32"
          />
          <Input
            placeholder="메모 (예: 계좌이체 확인)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="flex-1"
          />
        </div>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={mutation.isPending || !days}
          className="w-full"
        >
          {mutation.isPending ? '처리 중...' : '구독 지급'}
        </Button>
      </CardContent>
    </Card>
  );
}

// 첫번째 탭: 기간 관리
function PeriodTab({ userId }: { userId: string }) {
  const { data: detail, isLoading } = useMemberDetail(userId);

  if (isLoading) return <Skeleton className="w-full h-48 bg-gray-200" />;

  const isActive = detail?.status === 'ACTIVE' || detail?.status === 'PAUSED';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="gap-0 py-3 ">
          <CardContent className="px-3">
            <p className="text-xs text-muted-foreground">남은 구독 기간</p>
            <p className="mt-0.5 text-sm font-semibold text-primary">
              {getRemainingDays(detail?.endsAt ?? null)}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-3">
          <CardContent className="px-3">
            <p className="text-xs text-muted-foreground">만료일</p>
            <p className="mt-0.5 text-sm font-semibold">
              {formatDate(detail?.endsAt)}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-3">
          <CardContent className="px-3">
            <p className="text-xs text-muted-foreground">일시정지 횟수</p>
            <p className="mt-0.5 text-sm font-semibold">
              {detail?.pauseCount ?? 0}회
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-3">
          <CardContent className="px-3">
            <p className="text-xs text-muted-foreground">일시정지 중</p>
            <p className="mt-0.5 text-sm font-semibold">
              {detail?.isPaused ? '예' : '아니오'}
            </p>
          </CardContent>
        </Card>
      </div>

      {isActive ? (
        <AdjustForm userId={userId} />
      ) : (
        <GrantForm userId={userId} />
      )}
    </div>
  );
}

// 두번째 탭: 플랜 / 결제 방식 / 해지·환불 관리
//
// 해지는 두 가지뿐이고 둘 다 1급 액션으로 노출한다.
//  - 해지 예약: 잔여 기간은 그대로 쓰고 다음 결제만 중단 (고객 셀프해지 기본값과 동일)
//  - 즉시 해지 + 환불: 자격을 즉시 회수하고 정책 견적대로 환불
// 예전에는 해지예약이 '자동 연장' 토글에 숨어 있어 CS 가 해지 처리 창구로 인식하지 못했다.
function PlanTab({
  userId,
  contractId,
  allowForceCancel,
  customerEmail,
}: {
  userId: string;
  contractId: string;
  allowForceCancel: boolean;
  customerEmail?: string;
}) {
  const { data: detail, isLoading, refetch } = useMemberDetail(userId);
  const setAutoRenewalMutation = useSetAutoRenewal();
  const scheduleCancelMutation = useScheduleCancelSubscription();
  const completeManualRefundMutation = useCompleteManualRefund();
  const [forceCancelOpen, setForceCancelOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleReason, setScheduleReason] = useState('');

  const isActive = detail?.status === 'ACTIVE' || detail?.status === 'PAUSED';
  const autoRenewal = detail?.autoRenewal ?? false;
  // 정기결제 여부·해지예약은 recurringCancelledAt 이 SoT다. nextBillingDate 로 추론하면
  // 해지 시 null 로 지워져 1회 결제와 구분되지 않는다.
  //
  // 다만 recurringCancelledAt 만으로 '정기결제'로 단정하면 안 된다 — 1회 결제 고객도 해지 예약을 하고,
  // 그때 철회 버튼을 열어주면 자동이체 약정이 새로 생겨 동의한 적 없는 정기결제가 시작된다.
  // 되살릴 자동결제가 있는지는 서버가 가입/해지 시점의 사실로 판정해 내려준다.
  const canUndoCancellation = detail?.canUndoCancellation ?? false;
  const isRecurringContract = autoRenewal || canUndoCancellation;
  const isCancellationScheduled = isActive && !!detail?.recurringCancelledAt;
  const manualRefundAccount = detail?.manualRefundAccount ?? null;
  // 계좌로 보내기 전에 결제관리(wallet) 쪽 사실을 먼저 본다 — 이미 나갔거나 확정만 남은 건에
  // 또 송금하면 돈이 두 번 나간다. null 은 '알 수 없음'이라 아무것도 단정하지 않는다.
  const settlement = detail?.refundSettlement ?? null;
  const requestedRefund = detail?.eligibleRefundAmount ?? 0;
  const pgAlreadyRefunded =
    !!settlement && requestedRefund > 0 && settlement.alreadyRefundedAmount >= requestedRefund;
  const pgConfirmPending = !!settlement && settlement.pendingRefundAmount > 0;
  // 결제한 적이 없는 계약(관리자 지급·이관)은 환불할 대상 자체가 없다. 옛 화면은 "미완료 — N원
  // 처리 필요" 만 띄워서, 보낼 곳도 근거도 없는 건을 CS 가 찾아 헤매게 만들었다.
  const refundImpossible =
    !!detail && detail.refundRequested && !detail.refundCompleted && !detail.hasPaymentIntent;

  const handleScheduleCancel = async () => {
    if (!scheduleReason.trim()) {
      toast.error('해지 사유를 입력해주세요.');
      return;
    }
    try {
      // 고객 셀프해지와 같은 처리(해지 시각·사유 기록 + 자동이체 약정 종료)를 하는 전용 API.
      // auto-renewal 토글은 청구만 멈춰 효성 약정이 은행에 그대로 남는다.
      await scheduleCancelMutation.mutateAsync({
        contractId,
        reason: scheduleReason.trim(),
        customerEmail,
      });
      toast.success(
        `해지가 예약되었습니다. ${formatDate(detail?.endsAt)}까지 이용 후 자동 결제가 중단됩니다.`
      );
      setScheduleOpen(false);
      setScheduleReason('');
      refetch();
    } catch (error) {
      toast.error(serverMessage(error) ?? '해지 예약에 실패했습니다.');
    }
  };

  const handleCompleteManualRefund = async () => {
    const account = detail?.manualRefundAccount;
    const where = account
      ? `${bankName(account.bank)} ${account.accountNumber} (${account.holderName})`
      : '고객 계좌';
    // PG 로 이미 나간 건은 '송금 확인'이 아니라 '기록 정리'다. 같은 문구로 물으면 관리자가
    // 보내지 않아도 될 돈을 보내고 나서 누른다.
    const question = pgAlreadyRefunded
      ? `결제관리에서 이미 ${settlement!.alreadyRefundedAmount.toLocaleString()}원이 환불된 건입니다. 추가 송금 없이 완료로 정리할까요?`
      : `${where}로 ${requestedRefund.toLocaleString()}원을 실제로 송금했나요? 완료로 확정합니다.`;
    if (!window.confirm(question)) return;
    try {
      await completeManualRefundMutation.mutateAsync({ contractId });
      toast.success('환불 완료로 기록했습니다.');
      refetch();
    } catch (error) {
      toast.error(serverMessage(error) ?? '환불 완료 처리에 실패했습니다.');
    }
  };

  const handleUndoCancel = async () => {
    try {
      await setAutoRenewalMutation.mutateAsync({
        contractId,
        autoRenewal: true,
      });
      toast.success('해지 예약이 철회되었습니다. 자동 결제가 재개됩니다.');
      refetch();
    } catch (error) {
      // 이미 만료된 구독은 재활성으로 복구되지 않는다(서버가 409로 거부) — 메시지를 그대로 보여준다.
      toast.error(serverMessage(error) ?? '해지 철회에 실패했습니다.');
    }
  };

  function getBillingTypeLabel() {
    if (!detail) return '-';
    if (autoRenewal) return '정기결제 (자동갱신)';
    if (!isRecurringContract) return '일시결제 (자동갱신 없음)';
    return '정기결제 (해지 예약됨)';
  }

  if (isLoading) return <Skeleton className="w-full h-48 bg-gray-200" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <CalendarClock className="text-indigo-500 size-4" />
            현재 플랜
          </CardTitle>
          <CardDescription>
            {detail?.tierCode ?? '-'} /{' '}
            {detail?.planDurationDays && detail.planDurationDays >= 365
              ? '연간'
              : detail?.planDurationDays && detail.planDurationDays >= 28
                ? '월간'
                : `${detail?.planDurationDays ?? '-'}일`}
          </CardDescription>
          <CardAction>
            <Badge
              variant={detail?.status === 'ACTIVE' ? 'default' : 'outline'}
            >
              {getMembershipStatus(detail?.status).label}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">결제 방식</span>
            <span className="font-medium">{getBillingTypeLabel()}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {autoRenewal ? '다음 결제일' : '이용 종료일'}
            </span>
            <span>
              {autoRenewal
                ? formatDate(detail?.nextBillingDate)
                : formatDate(detail?.endsAt)}
            </span>
          </div>
          {/* 환불 미완료 건은 눈에 띄게 — 자격은 회수됐는데 돈이 안 나간 상태를 놓치지 않도록 */}
          {(detail?.refundRequested || detail?.refundCompleted) && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">환불</span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    detail?.refundCompleted ? '' : 'font-medium text-amber-700'
                  }
                >
                  {detail?.refundCompleted
                    ? `완료 ${formatDate(detail.refundCompletedAt)} (${(detail.eligibleRefundAmount ?? 0).toLocaleString()}원)`
                    : refundImpossible
                      ? '환불 대상 결제 없음'
                      : `미완료 — ${(detail?.eligibleRefundAmount ?? 0).toLocaleString()}원 처리 필요`}
                </span>
                {/* 효성 CMS 환불은 wallet 에 환불 행이 없어 결제관리에서 닫을 수 없다 — 여기서 확정한다.
                    결제관리가 닫아야 하는 건(확정 대기)은 여기서 누르면 이중 송금이라 버튼을 열지 않는다. */}
                {allowForceCancel &&
                  !detail?.refundCompleted &&
                  !pgConfirmPending &&
                  !refundImpossible && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    data-testid="complete-manual-refund"
                    disabled={completeManualRefundMutation.isPending}
                    onClick={handleCompleteManualRefund}
                  >
                    {completeManualRefundMutation.isPending
                      ? '처리 중...'
                      : pgAlreadyRefunded
                        ? '완료로 정리'
                        : '송금 완료 처리'}
                  </Button>
                )}
              </span>
            </div>
          )}
          {/* 결제 이력이 없는 계약에 환불 요청이 걸린 건 — 보낼 돈도 보낼 곳도 없다는 사실을 말해준다. */}
          {refundImpossible && (
            <p
              className="rounded-md border p-2 text-xs text-muted-foreground"
              data-testid="refund-impossible-notice"
            >
              결제 내역이 없는 계약(관리자 지급·이관)에 환불 요청이 기록된 건입니다. 받은 돈이 없어
              송금할 대상이 없습니다 — 보상이 필요하면 결제관리에서 처리하세요.
            </p>
          )}
          {/* 송금하기 전에 결제관리 쪽 사실을 먼저 알려준다 — 이 안내가 없으면 이미 나간 돈을 또 보낸다. */}
          {!detail?.refundCompleted && (pgAlreadyRefunded || pgConfirmPending) && (
            <p
              className="rounded-md border border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-900"
              data-testid="refund-settlement-notice"
            >
              {pgConfirmPending
                ? `결제관리에 확정 대기 중인 환불 ${settlement!.pendingRefundAmount.toLocaleString()}원이 있습니다. 이 건은 결제관리에서 완료 처리하세요 — 여기서 송금하면 두 번 나갑니다.`
                : `결제관리에서 이미 ${settlement!.alreadyRefundedAmount.toLocaleString()}원이 환불되었습니다. 추가 송금은 필요하지 않습니다.`}
            </p>
          )}
          {/* 계좌 송금이 남은 건은 '어디로 보낼지'가 같은 화면에 있어야 실제로 끝낼 수 있다.
              (효성 CMS 는 wallet 에 환불 행 자체가 없어 결제관리 화면에도 나타나지 않는다) */}
          {manualRefundAccount && !pgAlreadyRefunded && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50/60 p-2 text-xs"
              data-testid="manual-refund-account"
            >
              <p className="font-medium text-amber-900">환불 송금 계좌</p>
              <p className="mt-0.5 text-amber-900">
                {bankName(manualRefundAccount.bank)}{' '}
                {manualRefundAccount.accountNumber} ·{' '}
                {manualRefundAccount.holderName}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 해지 예약 상태 + 철회 */}
      {isCancellationScheduled && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="text-sm text-amber-900">해지 예약됨</CardTitle>
            <CardDescription className="text-amber-900">
              {formatDateTime(detail?.recurringCancelledAt)} 해지 신청 ·{' '}
              {formatDate(detail?.endsAt)}까지 멤버십 혜택 유지 · 이후 자동
              결제는 청구되지 않습니다.
              {detail?.recurringCancellationReasonCode
                ? ` (사유: ${detail.recurringCancellationReasonCode})`
                : ''}
            </CardDescription>
          </CardHeader>
          {allowForceCancel && (
            <CardContent>
              {canUndoCancellation ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUndoCancel}
                  disabled={setAutoRenewalMutation.isPending}
                >
                  {setAutoRenewalMutation.isPending
                    ? '처리 중...'
                    : '해지 예약 철회 (자동 결제 재개)'}
                </Button>
              ) : (
                <p className="text-xs text-amber-900">
                  1회 결제 건이라 되살릴 자동결제가 없습니다. 계속 이용하려면
                  고객이 직접 재가입해야 합니다.
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* 해지 예약 — 정기결제 계약에만 의미가 있다 */}
      {allowForceCancel &&
        isActive &&
        isRecurringContract &&
        !isCancellationScheduled && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">해지 예약 (권장)</CardTitle>
              <CardDescription>
                {formatDate(detail?.endsAt)}까지는 그대로 이용하고 다음 결제부터
                청구하지 않습니다. 환불은 발생하지 않습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {scheduleOpen ? (
                <>
                  <Label className="text-xs">
                    해지 사유 <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    rows={2}
                    placeholder="고객 요청 내용 등"
                    value={scheduleReason}
                    onChange={(e) => setScheduleReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleScheduleCancel}
                      disabled={scheduleCancelMutation.isPending}
                    >
                      {scheduleCancelMutation.isPending
                        ? '처리 중...'
                        : '해지 예약 확정'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setScheduleOpen(false)}
                    >
                      취소
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => setScheduleOpen(true)}
                >
                  해지 예약하기
                </Button>
              )}
            </CardContent>
          </Card>
        )}

      {/* 1회 결제 계약 안내 — 해지할 정기결제가 없다 (이미 해지 예약된 건은 위 배너가 설명한다) */}
      {isActive && !isRecurringContract && !isCancellationScheduled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">자동 결제 없음</CardTitle>
            <CardDescription>
              1회 결제 건이라 예약 해지가 필요하지 않습니다.{' '}
              {formatDate(detail?.endsAt)}에 자동 종료됩니다. 즉시 종료·환불이
              필요하면 아래 즉시 해지를 사용하세요.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {allowForceCancel && isActive && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-sm text-destructive">
              즉시 해지 + 환불
            </CardTitle>
            <CardDescription>
              현재 구독 기간까지 즉시 종료하고 정책 기준 환불액을 지급합니다.
              (청약철회 7일 내 전액 / 연간 중도해지 정산 / 예외 보상)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => setForceCancelOpen(true)}
            >
              즉시 해지 + 환불 처리
            </Button>
          </CardContent>
        </Card>
      )}

      {allowForceCancel && (
        <ForceCancelDialog
          open={forceCancelOpen}
          onClose={() => setForceCancelOpen(false)}
          contractId={contractId}
          customerEmail={customerEmail}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  );
}

// 세번째 탭: 결제 기록
function BillingTab({
  userId,
  contractId,
  allowRetry,
}: {
  userId: string;
  contractId: string;
  allowRetry: boolean;
}) {
  const { data: events, isLoading } = useMemberBillingEvents(userId);
  const retryBillingMutation = useRetryBilling();
  const reconcileMutation = useReconcileInvoice();
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

  const handleReconcile = async () => {
    setReconcileResult(null);
    try {
      const res = await reconcileMutation.mutateAsync(contractId);
      setReconcileResult(res.invoiceStatus ?? '미발행(대기)');
      toast.success(`정합화 완료 — 권위 결제 상태: ${res.invoiceStatus ?? '인보이스 미발행(대기)'}`);
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
      const serverMsg = anyErr?.response?.data?.message ?? anyErr?.message;
      toast.error(serverMsg && typeof serverMsg === 'string' ? serverMsg : '정합화에 실패했습니다.');
    }
  };

  const handleRetry = async () => {
    try {
      const result = await retryBillingMutation.mutateAsync(contractId);
      if (result.success) {
        toast.success('결제 재시도 요청이 전송되었습니다.');
      } else {
        toast.error(result.errorMessage ?? result.errorCode ?? '결제 재시도가 처리되지 않았습니다.');
      }
    } catch (err: unknown) {
      // 서버 안내 메시지를 노출한다 — 인보이스 경로 계약은 백엔드가 409(INVOICE_PATH_CONTRACT,
      // "인보이스 탭에서 즉시 집행")로 막으므로, 일반 문구로 덮으면 운영자가 조치 방법을 알 수 없다.
      const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
      const serverMsg = anyErr?.response?.data?.message ?? anyErr?.message;
      toast.error(serverMsg && typeof serverMsg === 'string' ? serverMsg : '결제 재시도에 실패했습니다.');
    } finally {
      setRetryConfirmOpen(false);
    }
  };

  if (isLoading) return <Skeleton className="w-full h-48 bg-gray-200" />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        {allowRetry && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRetryConfirmOpen(true)}
            disabled={retryBillingMutation.isPending}
            className="text-xs h-7"
          >
            {retryBillingMutation.isPending ? '처리 중...' : '결제 수동 재시도'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReconcile}
          disabled={reconcileMutation.isPending}
          title="wallet 인보이스 권위 상태를 되물어 구독(자격)↔인보이스(결제) 발산을 해소 (INVOICE 계약 전용)"
          className="text-xs h-7"
        >
          {reconcileMutation.isPending ? '정합화 중...' : '강제 정합화'}
        </Button>
      </div>
      {reconcileResult && (
        <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          권위 결제 상태(인보이스): <span className="font-medium text-foreground">{reconcileResult}</span> — 자격은 이
          상태에 맞춰 정합화되었습니다.
        </div>
      )}
      <Dialog
        open={retryConfirmOpen}
        onOpenChange={(o) => {
          if (!o && !retryBillingMutation.isPending) setRetryConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>결제 수동 재시도</DialogTitle>
            <DialogDescription>
              회원의 등록된 결제수단으로 즉시 실제 청구가 발행됩니다. 대상을
              확인한 후 진행해주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-xs space-y-1">
            <p>
              회원 ID: <span className="font-mono">{userId}</span>
            </p>
            <p>
              계약 ID: <span className="font-mono">{contractId}</span>
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={retryBillingMutation.isPending}
              onClick={() => setRetryConfirmOpen(false)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={retryBillingMutation.isPending}
              onClick={handleRetry}
            >
              {retryBillingMutation.isPending ? '청구 중...' : '즉시 청구'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Card className="py-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>일시</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">결제액</TableHead>
              <TableHead>오류</TableHead>
              <TableHead>결제 상세</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!events?.length ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  결제 기록이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              events.map((ev) => {
                const { label, variant } = getBillingEventLabel(ev.eventType);
                return (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs">
                      {formatDateTime(ev.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={variant}>{label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {ev.amount != null
                        ? `${ev.amount.toLocaleString()}원`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {ev.errorCode ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {ev.paymentIntentId ? (
                        <Link
                          href={`/payments/${ev.paymentIntentId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          wallet 상세
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// 네번째 탭: 로그
function LogTab({ userId }: { userId: string }) {
  const { data: events, isLoading } = useMemberContractEvents(userId);

  const operatorIds = useMemo(
    () => [
      ...new Set(
        (events ?? [])
          .map((e) => e.causedByUserId)
          .filter((id): id is string => !!id)
      ),
    ],
    [events]
  );
  const operatorNames = useUserNames(operatorIds);

  if (isLoading) return <Skeleton className="w-full h-48 bg-gray-200" />;

  return (
    <Card className="py-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>작업일시</TableHead>
            <TableHead>작업내용</TableHead>
            <TableHead>작업자</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!events?.length ? (
            <TableRow>
              <TableCell
                colSpan={3}
                className="py-8 text-center text-muted-foreground"
              >
                로그가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            events.map((ev) => (
              <TableRow key={ev.id}>
                <TableCell className="text-xs">
                  {formatDateTime(ev.createdAt)}
                </TableCell>
                <TableCell className="text-sm">{ev.eventType}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ev.causedByUserId ? (
                    operatorNames[ev.causedByUserId] ? (
                      <span className="flex items-center gap-1">
                        <span>{operatorNames[ev.causedByUserId].loginId}</span>
                        {operatorNames[ev.causedByUserId].roles[0] && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 py-0 text-xs"
                          >
                            {operatorNames[ev.causedByUserId].roles[0]}
                          </Badge>
                        )}
                      </span>
                    ) : (
                      ev.causedByUserId
                    )
                  ) : (
                    ev.causedBy
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

// 멤버십 상세 본문 — userId 만으로 동작한다. 다이얼로그와 회원조회창 탭이 공유한다.
// allowAdminActions=false 면 강제 즉시 취소·결제 수동 재시도 같은 위험 액션을 숨긴다(회원조회창용).
export function MembershipDetailPanel({
  userId,
  allowAdminActions = true,
}: {
  userId: string;
  allowAdminActions?: boolean;
}) {
  const { data: detail, isLoading } = useMemberDetail(userId);
  const userNames = useUserNames(userId ? [userId] : []);

  if (isLoading) return <Skeleton className="w-full h-64 bg-gray-200" />;

  if (!detail) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Crown className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              멤버십 가입 이력이 없습니다. 아래에서 구독을 지급해 등록할 수
              있습니다.
            </p>
          </CardContent>
        </Card>
        <GrantForm userId={userId} />
      </div>
    );
  }

  const contractId = detail.contractId;
  const status = getMembershipStatus(detail.status);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Crown className="text-indigo-500 size-4" />
            멤버십 정보
          </CardTitle>
          <CardAction>
            <Badge variant={status.variant}>{status.label}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <Field
            label="로그인 아이디"
            value={userNames[userId]?.loginId || userId || '-'}
          />
          <Field label="성함" value={userNames[userId]?.username || '-'} />
          <Field
            label="최초 등록일"
            value={formatDate(detail.firstContractCreatedAt)}
          />
          <Field
            label="멤버십 이용일"
            value={
              detail.firstContractCreatedAt
                ? getMembershipUsageDays(detail.firstContractCreatedAt)
                : '-'
            }
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="period">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="period">멤버십 기간 관리</TabsTrigger>
          <TabsTrigger value="plan">해지 · 환불</TabsTrigger>
          <TabsTrigger value="billing">결제 기록</TabsTrigger>
          <TabsTrigger value="log">로그</TabsTrigger>
        </TabsList>

        <TabsContent value="period" className="mt-4">
          <PeriodTab userId={userId} />
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <PlanTab
            userId={userId}
            contractId={contractId}
            allowForceCancel={allowAdminActions}
            customerEmail={userNames[userId]?.email || undefined}
          />
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          <BillingTab
            userId={userId}
            contractId={contractId}
            allowRetry={allowAdminActions}
          />
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <LogTab userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// 멤버십 회원 상세 정보 모달
export function MembershipMemberDetailDialog({
  member,
  open,
  onClose,
}: MembershipMemberDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="rounded-t-lg bg-[#1a2744] px-6 py-4">
          <DialogTitle className="text-base font-semibold text-white">
            멤버십 고객 상세정보
          </DialogTitle>
        </DialogHeader>

        <div className="p-6">
          {member && <MembershipDetailPanel userId={member.userId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
