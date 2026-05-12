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
import { useGrantSubscriptionByDays } from '@/lib/services/membership';

function AdminGrantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState('');
  const [memo, setMemo] = useState('');
  const grantMutation = useGrantSubscriptionByDays();

  const handleClose = () => {
    setUserId('');
    setDays('');
    setMemo('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!userId.trim()) {
      toast.error('사용자 ID를 입력해주세요.');
      return;
    }
    const d = Number(days);
    if (!d || d < 1) {
      toast.error('1일 이상의 일수를 입력해주세요.');
      return;
    }
    try {
      await grantMutation.mutateAsync({ userId: userId.trim(), days: d, memo: memo.trim() || undefined });
      toast.success('구독이 지급되었습니다.');
      handleClose();
    } catch (e: any) {
      const msg: string = e?.response?.data?.message ?? e?.message ?? '';
      if (msg.includes('이미 활성')) {
        toast.error('이미 활성 구독이 있는 사용자입니다. 멤버십 상세에서 기간 조정을 이용하세요.');
      } else {
        toast.error('구독 지급에 실패했습니다.');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>신규 구독 지급</DialogTitle>
          <DialogDescription>
            사용자 ID와 지급할 일수를 입력합니다. 결제 없이 즉시 적용되며 메모는 마이페이지에서 확인할 수 있습니다.
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
            <Label>지급 일수 <span className="text-destructive">*</span></Label>
            <Input
              type="number"
              placeholder="예: 30"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>메모 (선택)</Label>
            <Input
              placeholder="예: 계좌이체 확인, 서비스 제공"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            닫기
          </Button>
          <Button onClick={handleConfirm} disabled={grantMutation.isPending}>
            {grantMutation.isPending ? '처리 중...' : '구독 지급'}
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
      <AdminGrantDialog
        open={subscribeDialogOpen}
        onClose={() => setSubscribeDialogOpen(false)}
      />
    </Container>
  );
}
