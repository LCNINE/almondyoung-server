'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
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

interface MembershipMemberDetailDialogProps {
  member: AdminMemberListItem | null;
  open: boolean;
  onClose: () => void;
}

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

function formatDate(d: string | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMembershipUsageDays(firstContractCreatedAt: string): string {
  const start = new Date(firstContractCreatedAt);
  const today = new Date();
  const diff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return `${diff}일`;
}

function getBillingEventLabel(eventType: string): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  switch (eventType) {
    case 'CHARGE_SUCCESS':
      return { label: '결제 성공', variant: 'default' };
    case 'CHARGE_FAIL':
      return { label: '결제 실패', variant: 'destructive' };
    case 'CHARGE_ATTEMPT':
      return { label: '결제 시도', variant: 'secondary' };
    default:
      return { label: eventType, variant: 'outline' };
  }
}

// 강제 즉시 취소 다이얼로그
interface ForceCancelDialogProps {
  open: boolean;
  onClose: () => void;
  contractId: string;
  onSuccess: () => void;
}

function ForceCancelDialog({ open, onClose, contractId, onSuccess }: ForceCancelDialogProps) {
  const [reason, setReason] = useState('');
  const [refundType, setRefundType] = useState<'FULL' | 'PARTIAL' | 'NONE'>('NONE');
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
        refundAmount: refundType === 'PARTIAL' ? Number(refundAmount) : undefined,
        adminNote: adminNote.trim() || undefined,
      });
      if (result.refundStatus === 'FAILED') {
        toast.warning('구독은 취소되었으나 환불 처리에 실패했습니다. 수동으로 환불해주세요.');
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
          <DialogTitle className="text-destructive">구독 강제 즉시 취소</DialogTitle>
          <DialogDescription>
            구독이 즉시 종료됩니다. 이 작업은 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>취소 사유 <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="취소 사유를 입력해주세요"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>환불 유형 <span className="text-destructive">*</span></Label>
            <RadioGroup
              value={refundType}
              onValueChange={(v) => setRefundType(v as 'FULL' | 'PARTIAL' | 'NONE')}
              className="flex gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="NONE" id="refund-none" />
                <Label htmlFor="refund-none" className="cursor-pointer font-normal">환불 없음</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="FULL" id="refund-full" />
                <Label htmlFor="refund-full" className="cursor-pointer font-normal">전액 환불</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="PARTIAL" id="refund-partial" />
                <Label htmlFor="refund-partial" className="cursor-pointer font-normal">부분 환불</Label>
              </div>
            </RadioGroup>
          </div>

          {refundType === 'PARTIAL' && (
            <div className="space-y-1.5">
              <Label>환불 금액 (원) <span className="text-destructive">*</span></Label>
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
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-sm font-medium">구독 기간 조정</p>
      <p className="text-xs text-muted-foreground">양수: 연장 / 음수: 단축 (예: 7, -3)</p>
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
      <Button size="sm" onClick={handleSubmit} disabled={mutation.isPending} className="w-full">
        {mutation.isPending ? '처리 중...' : '변경하기'}
      </Button>
    </div>
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
      await mutation.mutateAsync({ userId, days: d, memo: memo.trim() || undefined });
      toast.success('구독이 지급되었습니다.');
      setDays('');
      setMemo('');
    } catch (e: any) {
      const msg: string = e?.response?.data?.message ?? e?.message ?? '';
      if (msg.includes('이미 활성')) {
        toast.error('이미 활성 구독이 있는 회원입니다. 기간 조정 기능을 이용하세요.');
      } else {
        toast.error('구독 지급에 실패했습니다.');
      }
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">구독 지급</p>
      <p className="text-xs text-muted-foreground">
        지급할 일수와 사유(메모)를 입력하세요. 마이페이지에서 확인할 수 있습니다.
      </p>
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
      <Button size="sm" onClick={handleSubmit} disabled={mutation.isPending || !days} className="w-full">
        {mutation.isPending ? '처리 중...' : '구독 지급'}
      </Button>
    </div>
  );
}

// 첫번째 탭: 기간 관리
function PeriodTab({ userId }: { userId: string }) {
  const { data: detail, isLoading } = useMemberDetail(userId);

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const isActive = detail?.status === 'ACTIVE' || detail?.status === 'PAUSED';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg border p-4">
        <div>
          <p className="text-xs text-muted-foreground">남은 구독 기간</p>
          <p className="font-medium">{getRemainingDays(detail?.endsAt ?? null)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">만료일</p>
          <p className="font-medium">{formatDate(detail?.endsAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">일시정지 횟수</p>
          <p className="font-medium">{detail?.pauseCount ?? 0}회</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">일시정지 중</p>
          <p className="font-medium">{detail?.isPaused ? '예' : '아니오'}</p>
        </div>
      </div>

      {isActive ? <AdjustForm userId={userId} /> : <GrantForm userId={userId} />}
    </div>
  );
}

// 두번째 탭: 플랜 / 결제 방식 / 해지 관리
function PlanTab({ userId, contractId }: { userId: string; contractId: string }) {
  const { data: detail, isLoading, refetch } = useMemberDetail(userId);
  const setAutoRenewalMutation = useSetAutoRenewal();
  const [pendingAutoRenewal, setPendingAutoRenewal] = useState<boolean | null>(null);
  const [forceCancelOpen, setForceCancelOpen] = useState(false);

  const effectiveAutoRenewal = pendingAutoRenewal ?? detail?.autoRenewal ?? true;
  const isActive = detail?.status === 'ACTIVE' || detail?.status === 'PAUSED';

  const handleAutoRenewalSave = async () => {
    if (pendingAutoRenewal === null) return;
    try {
      await setAutoRenewalMutation.mutateAsync({ contractId, autoRenewal: pendingAutoRenewal });
      toast.success(
        pendingAutoRenewal
          ? '자동갱신이 재개되었습니다.'
          : '해지가 예약되었습니다. 현재 구독 기간 만료 후 자동갱신이 중단됩니다.',
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

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">현재 플랜</p>
            <p className="text-xs text-muted-foreground">
              {detail?.tierCode ?? '-'} /{' '}
              {detail?.planDurationDays && detail.planDurationDays >= 365
                ? '연간'
                : detail?.planDurationDays && detail.planDurationDays >= 28
                  ? '월간'
                  : `${detail?.planDurationDays ?? '-'}일`}
            </p>
          </div>
          <Badge variant={detail?.status === 'ACTIVE' ? 'default' : 'outline'}>
            {detail?.status ?? '-'}
          </Badge>
        </div>

        <Separator />

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
      </div>

      {isActive && (
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">자동갱신 설정</p>
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
        </div>
      )}

      {isActive && (
        <div className="rounded-lg border border-destructive/30 p-4 space-y-2">
          <p className="text-sm font-medium text-destructive">강제 즉시 취소</p>
          <p className="text-xs text-muted-foreground">
            구독을 즉시 종료합니다. 정기결제 해지 예약과 달리 현재 구독 기간도 즉시 종료됩니다.
            환불 여부를 선택할 수 있습니다.
          </p>
          <Button
            size="sm"
            variant="destructive"
            className="w-full"
            onClick={() => setForceCancelOpen(true)}
          >
            강제 즉시 취소
          </Button>
        </div>
      )}

      <ForceCancelDialog
        open={forceCancelOpen}
        onClose={() => setForceCancelOpen(false)}
        contractId={contractId}
        onSuccess={() => refetch()}
      />
    </div>
  );
}

// 세번째 탭: 결제 기록
function BillingTab({ userId, contractId }: { userId: string; contractId: string }) {
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

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={handleRetry}
          disabled={retryBillingMutation.isPending}
          className="h-7 text-xs"
        >
          {retryBillingMutation.isPending ? '처리 중...' : '결제 수동 재시도'}
        </Button>
      </div>
      <div className="rounded-lg border">
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
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  결제 기록이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              events.map((ev) => {
                const { label, variant } = getBillingEventLabel(ev.eventType);
                return (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs">{formatDateTime(ev.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={variant}>{label}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {ev.amount != null ? `${ev.amount.toLocaleString()}원` : '-'}
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
      </div>
    </div>
  );
}

// 네번째 탭: 로그
function LogTab({ userId }: { userId: string }) {
  const { data: events, isLoading } = useMemberContractEvents(userId);

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="rounded-lg border">
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
              <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                로그가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            events.map((ev) => (
              <TableRow key={ev.id}>
                <TableCell className="text-xs">{formatDateTime(ev.createdAt)}</TableCell>
                <TableCell className="text-sm">{ev.eventType}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ev.causedByUserId ?? ev.causedBy}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// 멤버십 회원 상세 정보 모달
export function MembershipMemberDetailDialog({
  member,
  open,
  onClose,
}: MembershipMemberDetailDialogProps) {
  const { data: detail } = useMemberDetail(member?.userId ?? null);
  const userNames = useUserNames(member?.userId ? [member.userId] : []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="rounded-t-lg bg-[#1a2744] px-6 py-4">
          <DialogTitle className="text-base font-semibold text-white">
            멤버십 고객 상세정보
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-4">

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-gray-50 px-4 py-3 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0">로그인 아이디</span>
              <span className="font-medium break-all">
                {(member?.userId && userNames[member.userId]?.loginId) || member?.userId || '-'}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0">성함</span>
              <span className="font-medium">{(member?.userId && userNames[member.userId]?.username) || '-'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0">최초 등록일</span>
              <span className="font-medium">
                {formatDate(detail?.firstContractCreatedAt ?? member?.createdAt)}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0">멤버십 이용일</span>
              <span className="font-medium">
                {detail?.firstContractCreatedAt
                  ? getMembershipUsageDays(detail.firstContractCreatedAt)
                  : '-'}
              </span>
            </div>
          </div>

          {member && (
            <Tabs defaultValue="period">
              <TabsList className="w-full">
                <TabsTrigger value="period" className="flex-1">
                  멤버십 기간 관리
                </TabsTrigger>
                <TabsTrigger value="plan" className="flex-1">
                  플랜 구독 변경
                </TabsTrigger>
                <TabsTrigger value="billing" className="flex-1">
                  결제 기록
                </TabsTrigger>
                <TabsTrigger value="log" className="flex-1">
                  로그
                </TabsTrigger>
              </TabsList>

              <TabsContent value="period" className="mt-4">
                <PeriodTab userId={member.userId} />
              </TabsContent>

              <TabsContent value="plan" className="mt-4">
                <PlanTab userId={member.userId} contractId={member.contractId} />
              </TabsContent>

              <TabsContent value="billing" className="mt-4">
                <BillingTab userId={member.userId} contractId={member.contractId} />
              </TabsContent>

              <TabsContent value="log" className="mt-4">
                <LogTab userId={member.userId} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
