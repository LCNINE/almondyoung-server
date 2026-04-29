'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Construction } from 'lucide-react';
import { useLocationOptimizationZones } from '@/lib/services/orders';
import type { LocationOptimizationZone } from '@/lib/types/dto/fulfillment';

export default function LocationOptimizationTemplate() {
  const { data, isLoading } = useLocationOptimizationZones();

  return (
    <Container className="divide-y-0">
      <Header
        title="위치 최적화"
        subtitle="피킹 경로 및 존 구성 정보를 확인합니다."
      />
      <div className="flex flex-col gap-4 p-4">
        {/* 개발 예정 안내 */}
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Construction className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-foreground">피킹 경로 최적화 — 개발 예정</p>
            <p className="mt-0.5">
              배치별 최적 피킹 경로 계산, 통계, 시뮬레이션 기능은 서버 구현 완료 후 제공됩니다.
              현재는 창고 존 구성 정보만 확인할 수 있습니다.
            </p>
          </div>
        </div>

        {/* 존 구성 */}
        <div>
          <p className="mb-2 text-sm font-medium">창고 존 구성</p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          ) : data?.zones && data.zones.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {data.zones.map((zone: LocationOptimizationZone) => (
                <Card key={zone.zoneCode}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{zone.name}</CardTitle>
                      <Badge variant="outline">{zone.zoneCode}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p>{zone.description}</p>
                    <p className="mt-1 text-xs">
                      유형: {zone.type} · 우선순위 {zone.priority}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">존 정보가 없습니다.</p>
          )}
        </div>

        {data?.note && (
          <p className="text-xs text-muted-foreground">{data.note}</p>
        )}
      </div>
    </Container>
  );
}
