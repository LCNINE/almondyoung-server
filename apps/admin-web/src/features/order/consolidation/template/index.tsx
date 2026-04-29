'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWarehouses } from '@/lib/services/inventory/queries';
import {
  useConsolidationLive,
  useConsolidationSavings,
  useConsolidationRules,
  useAnalyzeConsolidation,
  useAutoConsolidate,
} from '@/lib/services/orders';
import { toast } from 'sonner';

export default function ConsolidationTemplate() {
  const { data: warehouses = [] } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');

  const { data: live, isLoading: liveLoading, refetch: refetchLive } =
    useConsolidationLive(warehouseId);
  const { data: savings } = useConsolidationSavings(warehouseId);
  const { data: rules = [] } = useConsolidationRules();

  const analyze = useAnalyzeConsolidation(warehouseId);
  const autoConsolidate = useAutoConsolidate();

  const handleAutoConsolidate = async (groupId: string) => {
    toast.warning('자동 합포장 기능은 현재 서버 미구현(stub) 상태입니다. 실제 FO 변경이 없습니다.');
    await autoConsolidate.mutateAsync(groupId);
  };

  return (
    <Container className="divide-y-0">
      <Header
        title="합포장 분석"
        subtitle="동일 고객/주소의 FO를 묶어 배송비를 절감할 수 있는 기회를 분석합니다."
      />
      <div className="flex flex-col gap-4 p-4">
        {/* ⚠️ Advisory 배너 */}
        <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-amber-800 dark:text-amber-300">
            <strong>어드바이저리 데이터:</strong> 합포장 후보·그룹·절감 수치는 서버에서 시뮬레이션
            데이터로 생성됩니다. 호출마다 결과가 달라질 수 있으며 실제 운영 결정에 직접 사용하지
            마세요. 자동 합포장 기능은 서버 미구현 상태입니다.
          </AlertDescription>
        </Alert>

        <div className="flex items-center gap-3">
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="창고 선택" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchLive()}
            disabled={!warehouseId || liveLoading}
          >
            실시간 조회
          </Button>
          <Button
            size="sm"
            onClick={() => analyze.mutate()}
            disabled={!warehouseId || analyze.isPending}
          >
            상세 분석
          </Button>
        </div>

        {warehouseId && (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* 실시간 기회 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">즉시 합포장 가능</CardTitle>
              </CardHeader>
              <CardContent>
                {liveLoading ? (
                  <p className="text-sm text-muted-foreground">로딩 중...</p>
                ) : live ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-2xl font-bold">
                        {live.opportunities.immediate.count}
                      </span>{' '}
                      그룹
                    </p>
                    <p className="text-muted-foreground">
                      예상 절감: ₩
                      {live.opportunities.immediate.potentialSavings.toLocaleString()}
                    </p>
                    {live.opportunities.immediate.groups.slice(0, 3).map((g) => (
                      <div
                        key={g.groupId}
                        className="flex items-center justify-between rounded border p-2"
                      >
                        <span className="text-xs text-muted-foreground">
                          {g.reason} · 신뢰도 {g.confidence}%
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => handleAutoConsolidate(g.groupId)}
                          disabled={autoConsolidate.isPending}
                          title="서버 미구현 — 실제 변경 없음"
                        >
                          합포장 (미구현)
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">창고를 선택하세요.</p>
                )}
              </CardContent>
            </Card>

            {/* 절감 예측 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">30일 절감 예측</CardTitle>
              </CardHeader>
              <CardContent>
                {savings ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-2xl font-bold">
                        ₩{savings.projection.totalSavings.toLocaleString()}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      배송비 절감 ₩{savings.projection.shippingCostSavings.toLocaleString()}
                    </p>
                    <p className="text-muted-foreground">
                      포장비 절감 ₩{savings.projection.packagingSavings.toLocaleString()}
                    </p>
                    <p className="text-xs text-amber-600">
                      * 시뮬레이션 데이터 — 참고용
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">창고를 선택하세요.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* 합포장 규칙 */}
        {rules.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">합포장 규칙</p>
            <div className="divide-y rounded border text-sm">
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between px-3 py-2">
                  <span className="font-medium">{rule.name}</span>
                  <span className="text-xs text-muted-foreground">
                    우선순위 {rule.priority} ·{' '}
                    {rule.autoConsolidate ? '자동 합포장' : '수동 검토'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Container>
  );
}
