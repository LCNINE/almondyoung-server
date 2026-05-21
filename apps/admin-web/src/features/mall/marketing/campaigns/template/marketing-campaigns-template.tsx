'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCampaignList, useDeleteCampaign } from '@/lib/services/campaigns';
import { CampaignCreateDialog } from '../components/campaign-create-dialog';
import { CampaignDetailDialog } from '../components/campaign-detail-dialog';
import type { MedusaCampaign } from '@/lib/api/domains/medusa/campaigns';
import { toast } from 'sonner';
import { CalendarRange, Eye, Trash2, Plus } from 'lucide-react';
import { formatCouponDate } from '../../coupons/coupon-helpers';

function BudgetBar({ budget }: { budget: MedusaCampaign['budget'] }) {
  if (!budget) return <span className="text-xs text-muted-foreground">예산 없음</span>;
  const used = budget.used ?? 0;
  const limit = budget.limit;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null;

  return (
    <div className="space-y-1 min-w-[120px]">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{budget.type === 'usage' ? '횟수' : '금액'}</span>
        <span>
          {used.toLocaleString('ko-KR')}
          {limit !== null ? ` / ${limit.toLocaleString('ko-KR')}` : ''}
          {budget.type === 'usage' ? '회' : '원'}
        </span>
      </div>
      {pct !== null && (
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${pct >= 90 ? 'bg-red-500' : 'bg-orange-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function CampaignStatusBadge({ campaign }: { campaign: MedusaCampaign }) {
  const now = new Date();
  const starts = campaign.starts_at ? new Date(campaign.starts_at) : null;
  const ends = campaign.ends_at ? new Date(campaign.ends_at) : null;

  if (ends && now > ends)
    return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">종료</span>;
  if (starts && now < starts)
    return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">예정</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600">진행 중</span>;
}

export default function MarketingCampaignsTemplate() {
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<MedusaCampaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MedusaCampaign | null>(null);

  const { data, isLoading } = useCampaignList({ limit: 100 });
  const deleteCampaign = useDeleteCampaign();

  const campaigns = data?.campaigns ?? [];

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCampaign.mutateAsync(deleteTarget.id);
      toast.success('캠페인이 삭제되었습니다.');
    } catch {
      toast.error('캠페인 삭제에 실패했습니다.');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <Container className="divide-y-0">
        <Header
          title="캠페인 관리"
          subtitle="여러 쿠폰을 묶는 행사 캠페인을 관리합니다."
          right={
            <Button onClick={() => setCreateOpen(true)} className="bg-orange-500 text-white hover:bg-orange-600">
              <Plus className="h-4 w-4 mr-1.5" />
              캠페인 생성
            </Button>
          }
        />
      </Container>

      <Container className="divide-y-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <CalendarRange className="h-10 w-10 opacity-30" />
            <p className="text-sm">생성된 캠페인이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">캠페인</th>
                  <th className="px-4 py-2.5 text-left font-medium">상태</th>
                  <th className="px-4 py-2.5 text-left font-medium">기간</th>
                  <th className="px-4 py-2.5 text-left font-medium">예산 사용</th>
                  <th className="px-4 py-2.5 text-left font-medium">쿠폰 수</th>
                  <th className="px-4 py-2.5 text-left font-medium">액션</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="text-left hover:underline focus:outline-none"
                        onClick={() => setDetailTarget(campaign)}
                      >
                        <div className="font-medium">{campaign.name}</div>
                        <div className="text-xs font-mono text-muted-foreground">{campaign.campaign_identifier}</div>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <CampaignStatusBadge campaign={campaign} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {formatCouponDate(campaign.starts_at) ?? '∞'} ~ {formatCouponDate(campaign.ends_at) ?? '∞'}
                    </td>
                    <td className="px-4 py-3">
                      <BudgetBar budget={campaign.budget} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {(campaign.promotions ?? []).length}개
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDetailTarget(campaign)}
                          title="상세/쿠폰 관리"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          상세
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(campaign)}
                          disabled={deleteCampaign.isPending}
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Container>

      <CampaignCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CampaignDetailDialog
        open={!!detailTarget}
        onOpenChange={(open) => { if (!open) setDetailTarget(null); }}
        campaign={detailTarget}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>캠페인 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">&apos;{deleteTarget?.name}&apos;</span> 캠페인을 삭제하시겠습니까?
              삭제된 캠페인은 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
