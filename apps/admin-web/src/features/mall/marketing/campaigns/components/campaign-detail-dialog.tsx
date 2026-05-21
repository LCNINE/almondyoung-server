'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useGetCampaign, useUnlinkPromotion, useLinkPromotion } from '@/lib/services/campaigns';
import { useCouponList } from '@/lib/services/coupons';
import { type MedusaCampaign } from '@/lib/api/domains/medusa/campaigns';
import { toast } from 'sonner';
import { Link2, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCouponDate, StatusBadge } from '../../coupons/coupon-helpers';

export function CampaignDetailDialog({
  open,
  onOpenChange,
  campaign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: MedusaCampaign | null;
}) {
  const [linkingPromotionId, setLinkingPromotionId] = useState('');

  const { data: fresh } = useGetCampaign(campaign?.id ?? null);
  const c = fresh ?? campaign;

  const unlinkMutation = useUnlinkPromotion();
  const linkMutation = useLinkPromotion();

  const { data: allCoupons } = useCouponList({ limit: 200 }, { enabled: !!campaign?.id });
  const linkedIds = new Set((c?.promotions ?? []).map((p) => p.id));
  // 이 캠페인에 이미 연결된 쿠폰만 제외 (다른 캠페인 소속 쿠폰도 이동 가능)
  const unlinkedCoupons = (allCoupons?.promotions ?? []).filter(
    (p) => !linkedIds.has(p.id)
  );

  if (!c) return null;

  const budget = c.budget;
  const usagePercent =
    budget?.limit && budget.used !== undefined
      ? Math.min(100, Math.round((budget.used / budget.limit) * 100))
      : null;

  const handleLink = async () => {
    if (!linkingPromotionId) return;
    try {
      await linkMutation.mutateAsync({ promotionId: linkingPromotionId, campaignId: c.id });
      setLinkingPromotionId('');
      toast.success('쿠폰이 캠페인에 연결되었습니다.');
    } catch {
      toast.error('쿠폰 연결에 실패했습니다.');
    }
  };

  const handleUnlink = async (promotionId: string) => {
    try {
      await unlinkMutation.mutateAsync({ promotionId, campaignId: c.id });
      toast.success('쿠폰 연결이 해제되었습니다.');
    } catch {
      toast.error('연결 해제에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{c.name}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{c.campaign_identifier}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">기간</span>
              <span>
                {formatCouponDate(c.starts_at) ?? '시작 없음'} ~ {formatCouponDate(c.ends_at) ?? '종료 없음'}
              </span>
            </div>
            {budget && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {budget.type === 'usage' ? '사용 횟수' : '할인 금액'}
                  </span>
                  <span>
                    {budget.used.toLocaleString('ko-KR')}
                    {budget.limit !== null ? ` / ${budget.limit.toLocaleString('ko-KR')}` : ' (무제한)'}
                    {budget.type === 'usage' ? '회' : '원'}
                  </span>
                </div>
                {usagePercent !== null && (
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-orange-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">연결된 쿠폰</span>
              <span className="text-xs text-muted-foreground">{(c.promotions ?? []).length}개</span>
            </div>

            {(c.promotions ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center border rounded-md">
                연결된 쿠폰이 없습니다.
              </p>
            ) : (
              <div className="space-y-1.5">
                {(c.promotions ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{p.code}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleUnlink(p.id)}
                      disabled={unlinkMutation.isPending}
                      title="연결 해제"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {unlinkedCoupons.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium flex items-center gap-1">
                <Link2 className="h-3.5 w-3.5" />
                쿠폰 연결
              </span>
              <div className="flex gap-2">
                <Select value={linkingPromotionId} onValueChange={setLinkingPromotionId}>
                  <SelectTrigger className="flex-1 h-9 text-sm">
                    <SelectValue placeholder="연결할 쿠폰 선택..." />
                  </SelectTrigger>
                  <SelectContent>
                    {unlinkedCoupons.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-9"
                  onClick={handleLink}
                  disabled={!linkingPromotionId || linkMutation.isPending}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  연결
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                캠페인에 연결되지 않은 쿠폰만 표시됩니다.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
