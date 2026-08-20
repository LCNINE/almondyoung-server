'use client';

import { SectionCard } from '@/checkout-ui/domains/checkout/components/shared/section-card';
import { ChevronRight, CreditCard } from 'lucide-react';
import type { AvailablePaymentMethod, PaymentMethod } from '@/lib/wallet-api';
import { getMethodIcon, getRegionLabel } from './utils';

interface Props {
  methods: PaymentMethod[];
  /** 리전 필터 결과. null 이면 리전 제한을 적용하지 않은 상태다. */
  availableMethodMap: Map<string, AvailablePaymentMethod> | null;
  /** 리전 조회 자체를 시도했는지 — 빈 목록 안내 문구를 가르는 값. */
  regionFilterApplied: boolean;
  region?: string | null;
  selectedMethodId: string;
  onSelect: (id: string) => void;
}

export function PaymentMethodCard({
  methods,
  availableMethodMap,
  regionFilterApplied,
  region,
  selectedMethodId,
  onSelect,
}: Props) {
  const regionLabel = getRegionLabel(region);

  return (
    <SectionCard title="결제 수단">
      <>
        {methods.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CreditCard className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {regionFilterApplied
                ? regionLabel
                  ? `${regionLabel} 지역에서 사용 가능한 결제수단이 없습니다. 관리자에게 문의해주세요.`
                  : '이 지역에서 사용 가능한 결제수단이 없습니다. 관리자에게 문의해주세요.'
                : '사용 가능한 결제 수단이 없습니다.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {methods.map((m) => {
              const isSelected = selectedMethodId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onSelect(m.id)}
                  className={[
                    'w-full flex items-center gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors',
                    isSelected ? 'border-primary bg-background' : 'border-border bg-background hover:bg-accent/50',
                  ].join(' ')}
                >
                  {/* 커스텀 라디오 점 */}
                  <div
                    className={[
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      isSelected ? 'border-primary' : 'border-muted-foreground/40',
                    ].join(' ')}
                  >
                    {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </div>
                  {/* 아이콘 박스 */}
                  <div className="flex items-center justify-center rounded-md h-9 w-9 shrink-0 bg-muted text-muted-foreground">
                    {getMethodIcon(m.type)}
                  </div>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">
                      {availableMethodMap?.get(m.type)?.displayName || m.displayName || m.type}
                    </span>
                    {availableMethodMap?.get(m.type)?.description && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {availableMethodMap.get(m.type)?.description}
                      </span>
                    )}
                  </span>
                  {/* 선택 시 chevron */}
                  {isSelected && <ChevronRight className="w-4 h-4 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </>
    </SectionCard>
  );
}
