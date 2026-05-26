'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useGetCoupon } from '@/lib/services/coupons';
import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';
import {
  formatCouponDate,
  formatCouponDateTime,
  formatPeriod,
  getCouponMeta,
  StatusBadge,
  TARGET_ATTR_LABEL,
  AUTO_ISSUE_TRIGGER_LABELS,
} from '../coupon-helpers';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
      <span className="w-32 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm flex-1">{children}</span>
    </div>
  );
}

export function CouponDetailDialog({
  open,
  onOpenChange,
  coupon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coupon: MedusaPromotion | null;
}) {
  const { data: fresh } = useGetCoupon(coupon?.id ?? null);
  const c = fresh ?? coupon;

  if (!c) return null;

  const { name, maxClaims, createdBy, visibility, autoIssueTrigger } = getCouponMeta(c);
  const m = c.application_method;
  const discountStr = m
    ? m.type === 'percentage'
      ? `${m.value}%`
      : `${m.value.toLocaleString('ko-KR')}원`
    : '-';

  const targetRules = m?.target_rules ?? [];
  const minOrder = c.rules?.find((r) => r.attribute === 'subtotal' && r.operator === 'gte');
  const budget = c.campaign?.budget;
  const perCustomerLimit = (budget as any)?.type === 'use_by_attribute' ? Number((budget as any).limit) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">{c.code}</DialogTitle>
          {name && <DialogDescription>{name}</DialogDescription>}
        </DialogHeader>

        <div className="divide-y">
          {name && <Row label="쿠폰 이름">{name}</Row>}
          <Row label="상태"><StatusBadge status={c.status} /></Row>
          <Row label="할인">
            <span>{discountStr}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              ({m?.type === 'percentage' ? '정률' : '정액'})
            </span>
          </Row>
          <Row label="적용 대상">
            <div className="flex flex-col gap-1">
              <span>
                {m?.target_type === 'order'
                  ? '전체 주문'
                  : m?.target_type === 'shipping_methods'
                  ? '배송비'
                  : '특정 상품/카테고리'}
              </span>
              {targetRules.map((rule, i) => (
                <span key={i} className="text-xs text-muted-foreground">
                  {TARGET_ATTR_LABEL[rule.attribute] ?? rule.attribute}: {rule.values.length}개 선택
                </span>
              ))}
            </div>
          </Row>
          {minOrder && (
            <Row label="최소 주문 금액">
              {Number((minOrder.values[0] as any)?.value ?? minOrder.values[0]).toLocaleString('ko-KR')}원 이상
            </Row>
          )}
          {budget?.limit && (budget as any)?.type !== 'use_by_attribute' && (
            <Row label="총 사용 한도">
              {budget.type === 'spend'
                ? `${budget.limit.toLocaleString('ko-KR')}원 (사용: ${budget.used.toLocaleString('ko-KR')}원)`
                : `${budget.limit.toLocaleString('ko-KR')}회 (사용: ${budget.used}회)`}
            </Row>
          )}
          {perCustomerLimit && (
            <Row label="1인당 사용 한도">{perCustomerLimit}회</Row>
          )}
          <Row label="발급 방식">
            {visibility === 'assigned_only' ? '발급 고객 전용' : visibility === 'claimable' ? '발급받기' : '공개'}
          </Row>
          {visibility === 'claimable' && (
            <Row label="총 발급 수량">
              {maxClaims ? `${maxClaims.toLocaleString('ko-KR')}명 한정` : '무제한'}
            </Row>
          )}
          {autoIssueTrigger && (
            <Row label="자동 발급">
              {AUTO_ISSUE_TRIGGER_LABELS[autoIssueTrigger]}
            </Row>
          )}
          <Row label="유효 기간">{formatPeriod(c)}</Row>
          <Row label="생성일">{formatCouponDateTime(c.created_at) ?? '-'}</Row>
          {createdBy && <Row label="생성자">{createdBy}</Row>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
