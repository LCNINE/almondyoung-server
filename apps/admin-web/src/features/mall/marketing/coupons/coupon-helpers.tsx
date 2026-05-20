'use client';

import { Badge } from '@/components/ui/badge';
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';

// Short date format used throughout coupon UI: "24. 05. 20."
export function formatCouponDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

// Short date+time format for detail view: "24. 05. 20. 14:30"
export function formatCouponDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function formatPeriod(coupon: MedusaPromotion): string {
  if (!coupon.campaign) return '무기한';
  const start = formatCouponDate(coupon.campaign.starts_at);
  const end = formatCouponDate(coupon.campaign.ends_at);
  if (start && end) return `${start} ~ ${end}`;
  if (end) return `~ ${end}`;
  if (start) return `${start} ~`;
  return '무기한';
}

export interface CouponMeta {
  name: string | undefined;
  maxDiscountAmount: number | null;
  maxUsesPerCustomer: number | null;
  createdBy: string | undefined;
}

export function getCouponMeta(coupon: MedusaPromotion): CouponMeta {
  const meta = (coupon.metadata ?? {}) as Record<string, unknown>;
  return {
    name: meta.name as string | undefined,
    maxDiscountAmount: meta.max_discount_amount != null ? Number(meta.max_discount_amount) : null,
    maxUsesPerCustomer: meta.max_uses_per_customer != null ? Number(meta.max_uses_per_customer) : null,
    createdBy: meta.created_by as string | undefined,
  };
}

export function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge className="bg-green-100 text-green-700 border-0">활성</Badge>;
  if (status === 'inactive') return <Badge className="bg-gray-100 text-gray-500 border-0">비활성</Badge>;
  if (status === 'draft') return <Badge className="bg-yellow-100 text-yellow-700 border-0">초안</Badge>;
  if (status === 'expired') return <Badge className="bg-red-100 text-red-500 border-0">만료</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export const TARGET_ATTR_LABEL: Record<string, string> = {
  product_id: '특정 상품',
  product_category_id: '특정 카테고리',
  product_collection_id: '특정 컬렉션',
  product_type_id: '특정 상품 유형',
};
