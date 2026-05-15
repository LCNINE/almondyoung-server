'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCouponList, useUpdateCouponStatus, useDeleteCoupon } from '@/lib/services/coupons';
import { CouponCreateDialog } from '../components/coupon-create-dialog';
import { CouponAssignDialog } from '../components/coupon-assign-dialog';
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';
import { toast } from 'sonner';
import { Gift, Tag, Trash2, UserPlus } from 'lucide-react';

const PAGE_SIZE = 20;

function formatDiscount(coupon: MedusaPromotion) {
  const m = coupon.application_method;
  if (!m) return '-';
  if (m.type === 'percentage') return `${m.value}%`;
  return `${m.value.toLocaleString('ko-KR')}원`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge className="bg-green-100 text-green-700 border-0">활성</Badge>;
  if (status === 'inactive') return <Badge className="bg-gray-100 text-gray-500 border-0">비활성</Badge>;
  if (status === 'draft') return <Badge className="bg-yellow-100 text-yellow-700 border-0">초안</Badge>;
  if (status === 'expired') return <Badge className="bg-red-100 text-red-500 border-0">만료</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function CouponRow({
  coupon,
  onAssign,
}: {
  coupon: MedusaPromotion;
  onAssign: (coupon: MedusaPromotion) => void;
}) {
  const updateStatus = useUpdateCouponStatus();
  const deleteCoupon = useDeleteCoupon();

  const toggleStatus = async () => {
    const next = coupon.status === 'active' ? 'inactive' : 'active';
    try {
      await updateStatus.mutateAsync({ id: coupon.id, status: next });
      toast.success(next === 'active' ? '쿠폰을 활성화했습니다.' : '쿠폰을 비활성화했습니다.');
    } catch {
      toast.error('상태 변경에 실패했습니다.');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`쿠폰 [${coupon.code}]을 삭제하시겠습니까?`)) return;
    try {
      await deleteCoupon.mutateAsync(coupon.id);
      toast.success('쿠폰이 삭제되었습니다.');
    } catch {
      toast.error('쿠폰 삭제에 실패했습니다.');
    }
  };

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <span className="font-mono text-sm font-semibold">{coupon.code}</span>
      </td>
      <td className="px-4 py-3 text-sm">
        {coupon.application_method?.type === 'percentage' ? '정률' : '정액'}
      </td>
      <td className="px-4 py-3 text-sm font-medium">{formatDiscount(coupon)}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {coupon.campaign
          ? `${formatDate(coupon.campaign.starts_at)} ~ ${formatDate(coupon.campaign.ends_at)}`
          : '무기한'}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={coupon.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onAssign(coupon)}
          >
            <UserPlus className="h-3.5 w-3.5 mr-1" />
            발급
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={toggleStatus}
            disabled={updateStatus.isPending}
          >
            {coupon.status === 'active' ? '비활성화' : '활성화'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleteCoupon.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function MarketingCouponsTemplate() {
  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<MedusaPromotion | null>(null);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useCouponList({ limit: PAGE_SIZE, offset });

  const coupons = data?.promotions ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4">
      <Container className="divide-y-0">
        <Header
          title="쿠폰 관리"
          subtitle="쿠폰을 생성하고 고객에게 발급합니다."
          right={
            <Button onClick={() => setCreateOpen(true)} className="bg-orange-500 text-white hover:bg-orange-600">
              <Tag className="h-4 w-4 mr-1.5" />
              쿠폰 생성
            </Button>
          }
        />
      </Container>

      <Container className="divide-y-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
        ) : coupons.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Gift className="h-10 w-10 opacity-30" />
            <p className="text-sm">생성된 쿠폰이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">코드</th>
                  <th className="px-4 py-2.5 text-left font-medium">유형</th>
                  <th className="px-4 py-2.5 text-left font-medium">할인</th>
                  <th className="px-4 py-2.5 text-left font-medium">기간</th>
                  <th className="px-4 py-2.5 text-left font-medium">상태</th>
                  <th className="px-4 py-2.5 text-left font-medium">액션</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => (
                  <CouponRow
                    key={coupon.id}
                    coupon={coupon}
                    onAssign={setAssignTarget}
                  />
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <p className="text-xs text-muted-foreground">총 {total}개</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    disabled={currentPage === 1}
                  >
                    이전
                  </Button>
                  <span className="flex items-center text-xs text-muted-foreground px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    disabled={currentPage === totalPages}
                  >
                    다음
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Container>

      <CouponCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      {assignTarget && (
        <CouponAssignDialog
          promotionId={assignTarget.id}
          promotionCode={assignTarget.code}
          open={!!assignTarget}
          onOpenChange={(open) => { if (!open) setAssignTarget(null); }}
        />
      )}
    </div>
  );
}
