'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useReplenishmentSku } from '@/lib/services/inventory';
import type {
  CompanyAxisDto,
  SellableAxisDto,
} from '@/lib/types/dto/inventory';
import { FLAG_LABELS, summarizeActions } from '../../suggestion-model';

type Props = { skuId: string | null; onOpenChange: (open: boolean) => void };

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AxisBlock({
  title,
  axis,
}: {
  title: string;
  axis: CompanyAxisDto | SellableAxisDto;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <Row label="재고 위치" value={axis.position} />
      <Row label="보유" value={axis.onHand} />
      <Row label="확정 예약" value={axis.reserved} />
      {'inTransfer' in axis && (
        <Row label="운송중(전사)" value={axis.inTransfer} />
      )}
      {'onOrder' in axis && <Row label="발주잔량(전사)" value={axis.onOrder} />}
      {'inTransit' in axis && (
        <Row label="이동중(도착 예정)" value={axis.inTransit} />
      )}
      {'onOrderDirect' in axis && (
        <Row label="직행 발주잔량" value={axis.onOrderDirect} />
      )}
      <Row label="안전재고" value={axis.safetyStock} />
      <Row label="재주문점" value={axis.reorderPoint} />
      <Row label="목표 수준" value={axis.targetLevel} />
      <Row label="리드타임(일)" value={axis.leadTimeDays} />
      {'daysOfCover' in axis && (
        <Row label="예상 커버(일)" value={axis.daysOfCover ?? '—'} />
      )}
    </div>
  );
}

export function ReplenishmentSkuDrawer({ skuId, onOpenChange }: Props) {
  const { data, isLoading } = useReplenishmentSku(skuId);
  return (
    <Sheet open={!!skuId} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>
            {data ? `${data.skuName} (${data.skuCode})` : '보충 판정'}
          </SheetTitle>
        </SheetHeader>
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">로딩 중...</p>
        ) : (
          <div className="space-y-4">
            <div className="space-x-1">
              <Badge variant="secondary">{data.pattern}</Badge>
              <Badge variant="secondary">등급 {data.grade}</Badge>
              {data.flags.map((flag) => (
                <Badge key={flag} variant="outline">
                  {FLAG_LABELS[flag]}
                </Badge>
              ))}
            </div>
            <Row label="제안" value={summarizeActions(data)} />
            <Row label="공급사" value={data.supplier?.name ?? '미정'} />
            <Row label="레거시 재주문점" value={data.legacyReorderPoint} />
            <Row label="일평균 수요" value={data.demand.dailyMean} />
            <Separator />
            <AxisBlock title="전사 축 (발주 판정)" axis={data.company} />
            <Separator />
            <AxisBlock title="판매창고 축 (이동 판정)" axis={data.sellable} />
            <p className="text-xs text-muted-foreground">
              이 단계의 안전재고는 SKU 에 입력된 정적값입니다. 수요 통계 기반
              계산은 다음 단계에서 들어옵니다.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
