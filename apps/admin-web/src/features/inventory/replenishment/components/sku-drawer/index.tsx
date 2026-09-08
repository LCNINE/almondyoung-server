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
  EffectiveParametersDto,
  SellableAxisDto,
  SkuDemandProfileDto,
} from '@/lib/types/dto/inventory';
import {
  FLAG_LABELS,
  PATTERN_LABELS,
  daysOfCoverLabel,
  formatComputedAt,
  formatOptionalNumber,
  formatSegment,
  formatSourced,
  summarizeActions,
} from '../../suggestion-model';

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
    </div>
  );
}

// 「패턴 / 등급」은 본문 상단 배지가 이미 보여준다 — 여기서 또 그리면 같은 정보를
// 두 번 그리는 것이다(#743 B Task 11 R33-②). 「예상 커버」도 마찬가지로 본문 상단
// Row(daysOfCoverLabel) 가 이미 그리므로 AxisBlock 은 통계 항목만 다룬다.
function ProfileBlock({ profile }: { profile: SkuDemandProfileDto | null }) {
  if (!profile) {
    return (
      <p className="text-xs text-muted-foreground">
        수요 프로필이 아직 없습니다 — 야간 재계산(03:40) 뒤 또는 보충 규칙
        페이지의 「지금 재계산」 뒤에 채워집니다.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">수요 프로필</p>
      <Row
        label="ADI · CV²"
        value={`${formatOptionalNumber(profile.adi)} · ${formatOptionalNumber(profile.cv2)}`}
      />
      <Row
        label="일평균 · 표준편차"
        value={`${formatOptionalNumber(profile.dailyMean)} · ${formatOptionalNumber(profile.dailyStd)} (${profile.paramFrom}~${profile.paramTo})`}
      />
      <Row
        label="발생일 수량 평균 · σ"
        value={`${formatOptionalNumber(profile.sizeMean)} · ${formatOptionalNumber(profile.sizeStd)}`}
      />
      <Row
        label="발생 간격 평균 (일)"
        value={formatOptionalNumber(profile.intervalMean, 1)}
      />
      <Row
        label="이력 · 발생일"
        value={`${profile.historyDays}일 · ${profile.demandEvents}회 (${profile.classificationFrom}~${profile.classificationTo})`}
      />
      <Row label="계산 시각" value={formatComputedAt(profile.computedAt)} />
    </div>
  );
}

function ParametersBlock({ p }: { p: EffectiveParametersDto }) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">적용 파라미터</p>
      {p.excluded && <Badge variant="destructive">제안 제외 (SKU 예외)</Badge>}
      <Row label="α" value={formatSourced(p.alpha)} />
      <Row label="L1 공급사→출발" value={formatSegment(p.l1)} />
      <Row label="L2 출발→판매" value={formatSegment(p.l2)} />
      <Row label="발주 커버" value={formatSourced(p.coverDays, '일')} />
      <Row label="이동 커버" value={formatSourced(p.transferCoverDays, '일')} />
      {p.overrideSafetyStock !== null && (
        <Row label="안전재고 오버라이드" value={p.overrideSafetyStock} />
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
              <Badge variant="secondary">{PATTERN_LABELS[data.pattern]}</Badge>
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
            <Row label="예상 커버" value={daysOfCoverLabel(data)} />
            <Separator />
            <AxisBlock title="전사 축 (발주 판정)" axis={data.company} />
            <Separator />
            <AxisBlock title="판매창고 축 (이동 판정)" axis={data.sellable} />
            <Separator />
            <ProfileBlock profile={data.profile} />
            <Separator />
            <ParametersBlock p={data.parameters} />
            <p className="text-xs text-muted-foreground">
              레거시 재주문점 = 90일 일평균 × 전사 리드타임 — 옛 방식과의
              비교용입니다.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
