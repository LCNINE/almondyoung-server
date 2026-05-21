'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCouponList,
  useUpdateCouponStatus,
  useDeleteCoupon,
} from '@/lib/services/coupons';
import { CouponCreateDialog } from '../components/coupon-create-dialog';
import { CouponAssignDialog } from '../components/coupon-assign-dialog';
import { CouponDeleteDialog } from '../components/coupon-delete-dialog';
import { CouponCustomersDialog } from '../components/coupon-customers-dialog';
import { CouponDetailDialog } from '../components/coupon-detail-dialog';
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';
import { toast } from 'sonner';
import { Gift, Tag, Users, Search, X, Eye } from 'lucide-react';
import { formatPeriod, getCouponMeta, StatusBadge } from '../coupon-helpers';
import MarketingCampaignsTemplate from '../../campaigns/template/marketing-campaigns-template';

const PAGE_SIZE = 20;

function formatDiscount(coupon: MedusaPromotion) {
  const m = coupon.application_method;
  if (!m) return '-';
  if (m.type === 'percentage') {
    const { maxDiscountAmount } = getCouponMeta(coupon);
    return maxDiscountAmount
      ? `${m.value}% (최대 ${maxDiscountAmount.toLocaleString('ko-KR')}원)`
      : `${m.value}%`;
  }
  return `${m.value.toLocaleString('ko-KR')}원`;
}

function formatConditions(coupon: MedusaPromotion) {
  const parts: string[] = [];
  const minOrder = coupon.rules?.find((r) => r.attribute === 'subtotal' && r.operator === 'gte');
  if (minOrder) {
    const rawVal = minOrder.values[0];
    const minOrderNum = Number((rawVal as any)?.value ?? rawVal);
    parts.push(`${minOrderNum.toLocaleString('ko-KR')}원 이상`);
  }
  const budget = coupon.campaign?.budget;
  if (budget?.limit) {
    parts.push(
      budget.type === 'spend'
        ? `최대 ${budget.limit.toLocaleString('ko-KR')}원 한도`
        : `최대 ${budget.limit.toLocaleString('ko-KR')}회`
    );
  }
  return parts.length > 0 ? parts.join(' · ') : '-';
}

interface CouponRowProps {
  coupon: MedusaPromotion;
  onDetail: (coupon: MedusaPromotion) => void;
  onAssign: (coupon: MedusaPromotion) => void;
  onViewCustomers: (coupon: MedusaPromotion) => void;
  onToggleStatus: (coupon: MedusaPromotion) => void;
  onDelete: (coupon: MedusaPromotion) => void;
  isToggling: boolean;
  isDeleting: boolean;
}

function CouponRow({ coupon, onDetail, onAssign, onViewCustomers, onToggleStatus, onDelete, isToggling, isDeleting }: CouponRowProps) {
  const canToggle = coupon.status === 'active' || coupon.status === 'inactive' || coupon.status === 'draft';
  const { name } = getCouponMeta(coupon);

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <button
          type="button"
          className="text-left hover:underline focus:outline-none"
          onClick={() => onDetail(coupon)}
        >
          {name && <div className="text-xs text-muted-foreground">{name}</div>}
          <span className="font-mono text-sm font-semibold">{coupon.code}</span>
        </button>
      </td>
      <td className="px-4 py-3 text-sm">
        <div className="flex flex-col">
          <span className="font-medium">{formatDiscount(coupon)}</span>
          <span className="text-xs text-muted-foreground">
            {coupon.application_method?.target_type === 'shipping'
              ? '배송비'
              : coupon.application_method?.type === 'percentage'
              ? '정률'
              : '정액'}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatConditions(coupon)}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatPeriod(coupon)}
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
            onClick={() => onDetail(coupon)}
            title="상세 보기"
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            상세
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onAssign(coupon)}
            title="고객에게 발급"
          >
            <Tag className="h-3.5 w-3.5 mr-1" />
            발급
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onViewCustomers(coupon)}
            title="발급 현황"
          >
            <Users className="h-3.5 w-3.5 mr-1" />
            현황
          </Button>
          {canToggle && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onToggleStatus(coupon)}
              disabled={isToggling}
            >
              {coupon.status === 'active' ? '비활성화' : '활성화'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={() => onDelete(coupon)}
            disabled={isDeleting}
            title="삭제"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function MarketingCouponsTemplate() {
  const [tab, setTab] = useState<'coupons' | 'campaigns'>('coupons');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<MedusaPromotion | null>(null);
  const [assignTarget, setAssignTarget] = useState<MedusaPromotion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MedusaPromotion | null>(null);
  const [customersTarget, setCustomersTarget] = useState<MedusaPromotion | null>(null);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const updateStatus = useUpdateCouponStatus();
  const deleteCoupon = useDeleteCoupon();

  // Medusa V2 promotions list doesn't accept status as a filter param — fetch a wider batch and filter client-side
  const { data, isLoading } = useCouponList({
    limit: statusFilter ? 500 : PAGE_SIZE,
    offset: statusFilter ? 0 : offset,
    q: search || undefined,
  });

  const allCoupons = data?.promotions ?? [];
  const filtered = statusFilter ? allCoupons.filter((c) => c.status === statusFilter) : allCoupons;
  const total = statusFilter ? filtered.length : (data?.count ?? 0);
  const pageIndex = Math.floor(offset / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const coupons = statusFilter ? filtered.slice(offset, offset + PAGE_SIZE) : filtered;

  const handleSearch = (v: string) => {
    setSearch(v);
    setOffset(0);
  };

  const handleStatusFilter = (v: string) => {
    setStatusFilter(v === 'all' ? '' : v);
    setOffset(0);
  };

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setOffset(0);
  };

  const hasFilters = !!(search || statusFilter);

  const handleToggleStatus = async (coupon: MedusaPromotion) => {
    const next = coupon.status === 'active' ? 'inactive' : 'active';
    try {
      await updateStatus.mutateAsync({ id: coupon.id, status: next });
      toast.success(next === 'active' ? '쿠폰이 활성화되었습니다.' : '쿠폰이 비활성화되었습니다.');
    } catch {
      toast.error('상태 변경에 실패했습니다.');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCoupon.mutateAsync(deleteTarget.id);
      toast.success('쿠폰이 삭제되었습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('쿠폰 삭제에 실패했습니다.');
    }
  };

  return (
    <div className="space-y-4">
      <Container className="divide-y-0">
        <Header
          title="쿠폰 / 캠페인"
          subtitle="쿠폰을 생성·발급하고, 캠페인으로 묶어 관리합니다."
          right={
            tab === 'coupons' ? (
              <Button onClick={() => setCreateOpen(true)} className="bg-orange-500 text-white hover:bg-orange-600">
                <Tag className="h-4 w-4 mr-1.5" />
                쿠폰 생성
              </Button>
            ) : undefined
          }
        />
        <div className="flex gap-0 border-b px-4">
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'coupons'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('coupons')}
          >
            쿠폰
          </button>
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'campaigns'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('campaigns')}
          >
            캠페인
          </button>
        </div>
      </Container>

      {tab === 'campaigns' && <MarketingCampaignsTemplate />}

      {tab === 'coupons' && <Container className="divide-y-0">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="코드 검색..."
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Select value={statusFilter || 'all'} onValueChange={handleStatusFilter}>
            <SelectTrigger className="w-32 h-9 text-sm">
              <SelectValue placeholder="상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="active">활성</SelectItem>
              <SelectItem value="inactive">비활성</SelectItem>
              <SelectItem value="draft">초안</SelectItem>
              <SelectItem value="expired">만료</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-9 text-sm text-muted-foreground">
              <X className="h-3.5 w-3.5 mr-1" />
              초기화
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
        ) : coupons.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Gift className="h-10 w-10 opacity-30" />
            <p className="text-sm">{hasFilters ? '검색 결과가 없습니다.' : '생성된 쿠폰이 없습니다.'}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">코드</th>
                    <th className="px-4 py-2.5 text-left font-medium">할인</th>
                    <th className="px-4 py-2.5 text-left font-medium">사용 조건</th>
                    <th className="px-4 py-2.5 text-left font-medium">유효 기간</th>
                    <th className="px-4 py-2.5 text-left font-medium">상태</th>
                    <th className="px-4 py-2.5 text-left font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => (
                    <CouponRow
                      key={coupon.id}
                      coupon={coupon}
                      onDetail={setDetailTarget}
                      onAssign={setAssignTarget}
                      onViewCustomers={setCustomersTarget}
                      onToggleStatus={handleToggleStatus}
                      onDelete={setDeleteTarget}
                      isToggling={updateStatus.isPending}
                      isDeleting={deleteCoupon.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Table.Pagination
              count={total}
              pageSize={PAGE_SIZE}
              pageIndex={pageIndex}
              pageCount={pageCount}
              canPreviousPage={offset > 0}
              canNextPage={offset + PAGE_SIZE < total}
              previousPage={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              nextPage={() => setOffset(offset + PAGE_SIZE)}
              goPage={(page) => setOffset(page * PAGE_SIZE)}
            />
          </>
        )}
      </Container>}

      <CouponDetailDialog
        open={!!detailTarget}
        onOpenChange={(open: boolean) => { if (!open) setDetailTarget(null); }}
        coupon={detailTarget}
      />

      <CouponCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <CouponAssignDialog
        promotionId={assignTarget?.id ?? ''}
        promotionCode={assignTarget?.code ?? ''}
        open={!!assignTarget}
        onOpenChange={(open) => { if (!open) setAssignTarget(null); }}
      />

      <CouponCustomersDialog
        open={!!customersTarget}
        onOpenChange={(open) => { if (!open) setCustomersTarget(null); }}
        promotionId={customersTarget?.id ?? ''}
        promotionCode={customersTarget?.code ?? ''}
      />

      <CouponDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        couponCode={deleteTarget?.code ?? ''}
        onConfirm={handleDeleteConfirm}
        isPending={deleteCoupon.isPending}
      />
    </div>
  );
}
