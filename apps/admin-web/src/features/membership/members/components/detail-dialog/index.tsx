'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
} from '@/lib/services/membership';

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

// 첫번째 탭: 기간 관리
function PeriodTab({ userId, contractId }: { userId: string; contractId: string }) {
  const { data: detail, isLoading } = useMemberDetail(userId);
  const adjustMutation = useAdjustEntitlement();
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');

  const handleAdjust = async () => {
    const d = Number(days);
    if (!d || !reason.trim()) {
      toast.error('일수와 사유를 입력해주세요.');
      return;
    }
    try {
      await adjustMutation.mutateAsync({ userId, days: d, reason: reason.trim() });
      toast.success('구독 기간이 조정되었습니다.');
      setDays('');
      setReason('');
    } catch {
      toast.error('구독 기간 조정에 실패했습니다.');
    }
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;

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
        <Button
          size="sm"
          onClick={handleAdjust}
          disabled={adjustMutation.isPending}
          className="w-full"
        >
          {adjustMutation.isPending ? '처리 중...' : '변경하기'}
        </Button>
      </div>
    </div>
  );
}

// 두번째 탭: 플랜 변경
function PlanTab({ userId, contractId }: { userId: string; contractId: string }) {
  const { data: detail, isLoading } = useMemberDetail(userId);
  const setAutoRenewalMutation = useSetAutoRenewal();
  const [autoRenewal, setAutoRenewal] = useState<boolean | null>(null);

  const effectiveAutoRenewal = autoRenewal ?? detail?.autoRenewal ?? true;

  const handleSave = async () => {
    if (autoRenewal === null) return;
    try {
      await setAutoRenewalMutation.mutateAsync({ contractId, autoRenewal });
      toast.success('설정이 저장되었습니다.');
      setAutoRenewal(null);
    } catch {
      toast.error('설정 저장에 실패했습니다.');
    }
  };

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

        <div className="border-t pt-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">자동 연장</p>
              <p className="text-xs text-muted-foreground">구독 만료 시 자동으로 갱신됩니다.</p>
            </div>
            <Switch
              checked={effectiveAutoRenewal}
              onCheckedChange={(checked) => setAutoRenewal(checked)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">다음 결제일</span>
          <span>{formatDate(detail?.nextBillingDate)}</span>
        </div>
      </div>

      {autoRenewal !== null && (
        <Button
          size="sm"
          onClick={handleSave}
          disabled={setAutoRenewalMutation.isPending}
          className="w-full"
        >
          {setAutoRenewalMutation.isPending ? '저장 중...' : '변경하기'}
        </Button>
      )}
    </div>
  );
}

// 세번째 탭: 결제 기록
function BillingTab({ contractId }: { contractId: string }) {
  const { data: events, isLoading } = useMemberBillingEvents(contractId);

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
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
  );
}

// 네번째 탭: 로그
function LogTab({ contractId }: { contractId: string }) {
  const { data: events, isLoading } = useMemberContractEvents(contractId);

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
              <span className="text-muted-foreground w-24 shrink-0">자사몰 아이디</span>
              <span className="font-medium break-all">{member?.userId ?? '-'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0">성함</span>
              <span className="font-medium">-</span>
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

          {/* Tabs */}
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
                <PeriodTab userId={member.userId} contractId={member.contractId} />
              </TabsContent>

              <TabsContent value="plan" className="mt-4">
                <PlanTab userId={member.userId} contractId={member.contractId} />
              </TabsContent>

              <TabsContent value="billing" className="mt-4">
                <BillingTab contractId={member.contractId} />
              </TabsContent>

              <TabsContent value="log" className="mt-4">
                <LogTab contractId={member.contractId} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
