'use client';

import { useState, useMemo } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  useRetryBilling,
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

// 라벨-값 한 줄 (shadcn Card 안에서 사용).
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all">{value ?? '-'}</span>
    </div>
  );
}

// 강제 즉시 취소 다이얼로그
interface ForceCancelDialogProps {
  open: boolean;
  onClose: () => void;
  contractId: string;
  onSuccess: () => void;
}

function ForceCancelDialog({
  open,
  onClose,
  contractId,
  onSuccess,
}: ForceCancelDialogProps) {
  const [reason, setReason] = useState('');
  const [refundType, setRefundType] = useState<'FULL' | 'PARTIAL' | 'NONE'>(
    'NONE'
  );
  const [refundAmount, setRefundAmount] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const forceCancelMutation = useForceCancelSubscription();

  const handleClose = () => {
    setReason('');
    setRefundType('NONE');
    setRefundAmount('');
    setAdminNote('');
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
    try {
      const result = await forceCancelMutation.mutateAsync({
        contractId,
        reason: reason.trim(),
        refundType,
        refundAmount:
          refundType === 'PARTIAL' ? Number(refundAmount) : undefined,
        adminNote: adminNote.trim() || undefined,
      });
      if (result.refundStatus === 'FAILED') {
        toast.warning(
          '구독은 취소되었으나 환불 처리에 실패했습니다. 수동으로 환불해주세요.'
        );
      } else {
        toast.success('구독이 즉시 취소되었습니다.');
      }
      onSuccess();
      handleClose();
    } catch {
      toast.error('강제 취소에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            구독 강제 즉시 취소
          </DialogTitle>
          <DialogDescription>
            구독이 즉시 종료됩니다. 이 작업은 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              onValueChange={(v) =>
                setRefundType(v as 'FULL' | 'PARTIAL' | 'NONE')
              }
              className="flex gap-4"
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
                <RadioGroupItem value="FULL" id="refund-full" />
                <Label
                  htmlFor="refund-full"
                  className="font-normal cursor-pointer"
                >
                  전액 환불
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="PARTIAL" id="refund-partial" />
                <Label
                  htmlFor="refund-partial"
                  className="font-normal cursor-pointer"
                >
                  부분 환불
                </Label>
              </div>
            </RadioGroup>
          </div>

          {refundType === 'PARTIAL' && (
            <div className="space-y-1.5">
              <Label>
                환불 금액 (원) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                placeholder="환불 금액 입력"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                min={0}
              />
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
            {forceCancelMutation.isPending ? '처리 중...' : '즉시 취소 확인'}
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

  if (isLoading) return <Skeleton className="w-full h-48" />;

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

// 두번째 탭: 플랜 / 결제 방식 / 해지 관리
function PlanTab({
  userId,
  contractId,
  allowForceCancel,
}: {
  userId: string;
  contractId: string;
  allowForceCancel: boolean;
}) {
  const { data: detail, isLoading, refetch } = useMemberDetail(userId);
  const setAutoRenewalMutation = useSetAutoRenewal();
  const [pendingAutoRenewal, setPendingAutoRenewal] = useState<boolean | null>(
    null
  );
  const [forceCancelOpen, setForceCancelOpen] = useState(false);

  const effectiveAutoRenewal =
    pendingAutoRenewal ?? detail?.autoRenewal ?? true;
  const isActive = detail?.status === 'ACTIVE' || detail?.status === 'PAUSED';

  const handleAutoRenewalSave = async () => {
    if (pendingAutoRenewal === null) return;
    try {
      await setAutoRenewalMutation.mutateAsync({
        contractId,
        autoRenewal: pendingAutoRenewal,
      });
      toast.success(
        pendingAutoRenewal
          ? '자동갱신이 재개되었습니다.'
          : '해지가 예약되었습니다. 현재 구독 기간 만료 후 자동갱신이 중단됩니다.'
      );
      setPendingAutoRenewal(null);
    } catch {
      toast.error('설정 저장에 실패했습니다.');
    }
  };

  function getBillingTypeLabel() {
    if (!detail) return '-';
    if (detail.autoRenewal) return '정기결제 (자동갱신)';
    if (!detail.nextBillingDate) return '일시결제';
    return '정기결제 (해지 예약됨)';
  }

  if (isLoading) return <Skeleton className="w-full h-48" />;

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
              {detail?.autoRenewal ? '다음 결제일' : '구독 종료일'}
            </span>
            <span>
              {detail?.autoRenewal
                ? formatDate(detail.nextBillingDate)
                : formatDate(detail?.endsAt)}
            </span>
          </div>
        </CardContent>
      </Card>

      {allowForceCancel && isActive && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">자동갱신 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">자동 연장</p>
                <p className="text-xs text-muted-foreground">
                  {effectiveAutoRenewal
                    ? '구독 만료 시 자동으로 갱신됩니다.'
                    : '현재 구독 기간 만료 후 자동갱신이 중단됩니다.'}
                </p>
              </div>
              <Switch
                checked={effectiveAutoRenewal}
                onCheckedChange={(checked) => setPendingAutoRenewal(checked)}
              />
            </div>

            {pendingAutoRenewal !== null && (
              <Button
                size="sm"
                onClick={handleAutoRenewalSave}
                disabled={setAutoRenewalMutation.isPending}
                className="w-full"
              >
                {setAutoRenewalMutation.isPending ? '저장 중...' : '변경 저장'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {allowForceCancel && isActive && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-sm text-destructive">
              강제 즉시 취소
            </CardTitle>
            <CardDescription>
              구독을 즉시 종료합니다. 정기결제 해지 예약과 달리 현재 구독 기간도
              즉시 종료됩니다. 환불 여부를 선택할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => setForceCancelOpen(true)}
            >
              강제 즉시 취소
            </Button>
          </CardContent>
        </Card>
      )}

      {allowForceCancel && (
        <ForceCancelDialog
          open={forceCancelOpen}
          onClose={() => setForceCancelOpen(false)}
          contractId={contractId}
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

  const handleRetry = async () => {
    try {
      await retryBillingMutation.mutateAsync(contractId);
      toast.success('결제 재시도 요청이 전송되었습니다.');
    } catch {
      toast.error('결제 재시도에 실패했습니다.');
    }
  };

  if (isLoading) return <Skeleton className="w-full h-48" />;

  return (
    <div className="space-y-3">
      {allowRetry && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={retryBillingMutation.isPending}
            className="text-xs h-7"
          >
            {retryBillingMutation.isPending ? '처리 중...' : '결제 수동 재시도'}
          </Button>
        </div>
      )}
      <Card className="py-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>일시</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">결제액</TableHead>
              <TableHead>오류</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!events?.length ? (
              <TableRow>
                <TableCell
                  colSpan={4}
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

  if (isLoading) return <Skeleton className="w-full h-48" />;

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

  if (isLoading) return <Skeleton className="w-full h-64" />;

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
          <TabsTrigger value="plan">플랜 구독 변경</TabsTrigger>
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
