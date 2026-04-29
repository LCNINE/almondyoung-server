'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { MembershipMemberTable } from '../components/table';
import { MembershipMemberFilterBox } from '../components/filter-box';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTiersWithPlans, useAdminSubscribeUser } from '@/lib/services/membership';

function getPlanLabel(durationDays: number): string {
  if (durationDays >= 365) return '연간';
  if (durationDays >= 28) return '월간';
  return `${durationDays}일`;
}

function AdminSubscribeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [userId, setUserId] = useState('');
  const [planId, setPlanId] = useState('');
  const [billingMode, setBillingMode] = useState<'one_time' | 'recurring'>('recurring');
  const { data: tiers } = useTiersWithPlans();
  const subscribeMutation = useAdminSubscribeUser();

  const allPlans = tiers?.flatMap((t) => t.plans.filter((p) => p.isActive).map((p) => ({ ...p, tierCode: t.tier.code }))) ?? [];

  const handleClose = () => {
    setUserId('');
    setPlanId('');
    setBillingMode('recurring');
    onClose();
  };

  const handleConfirm = async () => {
    if (!userId.trim()) {
      toast.error('사용자 ID를 입력해주세요.');
      return;
    }
    if (!planId) {
      toast.error('플랜을 선택해주세요.');
      return;
    }
    try {
      await subscribeMutation.mutateAsync({ userId: userId.trim(), planId, billingMode });
      toast.success('구독이 등록되었습니다.');
      handleClose();
    } catch (e: any) {
      const msg: string = e?.response?.data?.message ?? e?.message ?? '';
      if (msg.toLowerCase().includes('already')) {
        toast.error('이미 활성 구독이 존재하는 사용자입니다.');
      } else {
        toast.error('구독 등록에 실패했습니다.');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>신규 회원 구독 등록</DialogTitle>
          <DialogDescription>
            사용자 ID와 플랜을 선택해 직접 구독을 등록합니다. 무료체험 없이 즉시 적용됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>사용자 ID <span className="text-destructive">*</span></Label>
            <Input
              placeholder="자사몰 UUID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>플랜 <span className="text-destructive">*</span></Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="플랜 선택" />
              </SelectTrigger>
              <SelectContent>
                {allPlans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.tierCode} / {getPlanLabel(plan.durationDays)} — {plan.price.toLocaleString()}원
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>결제 방식 <span className="text-destructive">*</span></Label>
            <RadioGroup
              value={billingMode}
              onValueChange={(v) => setBillingMode(v as 'one_time' | 'recurring')}
              className="flex gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="recurring" id="mode-recurring" />
                <Label htmlFor="mode-recurring" className="cursor-pointer font-normal">
                  정기결제 (자동갱신)
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="one_time" id="mode-onetime" />
                <Label htmlFor="mode-onetime" className="cursor-pointer font-normal">
                  일회성 (자동갱신 없음)
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            닫기
          </Button>
          <Button onClick={handleConfirm} disabled={subscribeMutation.isPending}>
            {subscribeMutation.isPending ? '처리 중...' : '구독 등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MembershipMemberListTemplate() {
  const [subscribeDialogOpen, setSubscribeDialogOpen] = useState(false);

  return (
    <Container className="divide-y-0">
      <Header
        title="멤버십 회원 조회"
        subtitle="멤버십을 한 번이라도 구독했던 회원의 정보를 모두 조회할 수 있습니다."
        right={
          <Button
            size="sm"
            className="gap-1"
            onClick={() => setSubscribeDialogOpen(true)}
          >
            <UserPlus className="h-4 w-4" />
            신규 구독 등록
          </Button>
        }
      />
      <MembershipMemberFilterBox />
      <MembershipMemberTable />
      <AdminSubscribeDialog
        open={subscribeDialogOpen}
        onClose={() => setSubscribeDialogOpen(false)}
      />
    </Container>
  );
}
