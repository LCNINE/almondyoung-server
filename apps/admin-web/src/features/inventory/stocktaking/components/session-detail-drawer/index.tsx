'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useStocktakingVariances,
  useStartStocktakingSession,
  useScanLocation,
  useScanProduct,
  useUpdateLineCount,
  useGenerateAdjustments,
  useCompleteStocktakingSession,
} from '@/lib/services/inventory';
import type { StocktakingSessionDto, ScanLocationExpectedItem } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  row: StocktakingSessionDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_LABELS: Record<string, string> = {
  draft: '초안',
  in_progress: '진행 중',
  completed: '완료',
};

export function SessionDetailDrawer({ row, open, onOpenChange }: Props) {
  const sessionId = row?.id ?? '';

  const [locationBarcode, setLocationBarcode] = useState('');
  const [scannedLocationId, setScannedLocationId] = useState('');
  const [scannedLocationCode, setScannedLocationCode] = useState('');
  const [expectedItems, setExpectedItems] = useState<ScanLocationExpectedItem[]>([]);
  const [productBarcode, setProductBarcode] = useState('');
  const [manualLineId, setManualLineId] = useState('');
  const [manualCount, setManualCount] = useState('');

  const { data: variances, isLoading: isVariancesLoading } = useStocktakingVariances(
    row?.status !== 'draft' ? sessionId : ''
  );

  const startMutation = useStartStocktakingSession();
  const scanLocationMutation = useScanLocation();
  const scanProductMutation = useScanProduct();
  const updateCountMutation = useUpdateLineCount();
  const generateMutation = useGenerateAdjustments();
  const completeMutation = useCompleteStocktakingSession();

  const handleStart = async () => {
    if (!sessionId) return;
    try {
      await startMutation.mutateAsync(sessionId);
      toast.success('재고 실사를 시작했습니다.');
    } catch {
      toast.error('세션 시작에 실패했습니다.');
    }
  };

  const handleScanLocation = async () => {
    if (!locationBarcode) return;
    try {
      const result = await scanLocationMutation.mutateAsync({
        sessionId,
        locationBarcode,
      });
      setScannedLocationId(result.locationId);
      setScannedLocationCode(result.locationCode);
      setExpectedItems(result.expectedItems);
      setLocationBarcode('');
      toast.success(`위치 ${result.locationCode} 스캔 완료 — 예상 품목 ${result.expectedItems.length}개`);
    } catch {
      toast.error('위치 스캔에 실패했습니다.');
    }
  };

  const handleScanProduct = async () => {
    if (!productBarcode || !scannedLocationId) {
      toast.error('위치를 먼저 스캔해 주세요.');
      return;
    }
    try {
      const result = await scanProductMutation.mutateAsync({
        sessionId,
        locationId: scannedLocationId,
        productBarcode,
        quantity: 1,
      });
      setProductBarcode('');
      toast.success(
        `스캔 완료 — 카운트: ${result.countedQuantity}, 예상: ${result.expectedQuantity}, 차이: ${result.variance}`
      );
    } catch {
      toast.error('상품 스캔에 실패했습니다.');
    }
  };

  const handleUpdateCount = async () => {
    if (!manualLineId || manualCount === '') return;
    try {
      await updateCountMutation.mutateAsync({
        lineId: manualLineId,
        data: { countedQuantity: Number(manualCount) },
      });
      setManualLineId('');
      setManualCount('');
      toast.success('수량이 수동 입력되었습니다.');
    } catch {
      toast.error('수량 입력에 실패했습니다.');
    }
  };

  const handleGenerateAdjustments = async () => {
    try {
      const result = await generateMutation.mutateAsync({ sessionId });
      toast.success(result.message);
    } catch {
      toast.error('조정 생성에 실패했습니다.');
    }
  };

  const handleComplete = async () => {
    try {
      const result = await completeMutation.mutateAsync(sessionId);
      toast.success(
        `실사 완료 — 총 ${result.summary.totalLines}개 라인, 차이 ${result.summary.discrepanciesFound}건, 조정 ${result.summary.adjustmentsApplied}건`
      );
      onOpenChange(false);
    } catch {
      toast.error('실사 완료 처리에 실패했습니다.');
    }
  };

  const handleClose = () => {
    setLocationBarcode('');
    setScannedLocationId('');
    setScannedLocationCode('');
    setExpectedItems([]);
    setProductBarcode('');
    setManualLineId('');
    setManualCount('');
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-[520px] sm:w-[640px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            재고 실사 세션
            {row && (
              <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                {row.id.slice(0, 8)}…
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        {row && (
          <div className="mt-4 space-y-4">
            {/* 세션 기본 정보 */}
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p className="font-medium">세션 정보</p>
              <p className="text-muted-foreground">
                세션명: <span className="text-foreground">{row.sessionName}</span>
              </p>
              <p className="text-muted-foreground">
                상태:{' '}
                <span className="font-medium text-foreground">
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </p>
              <p className="text-muted-foreground">
                창고 ID:{' '}
                <span className="font-mono text-xs">{row.warehouseId.slice(0, 8)}…</span>
              </p>
              {row.notes && (
                <p className="text-muted-foreground">메모: {row.notes}</p>
              )}
            </div>

            {/* 초안 상태: 시작 버튼 */}
            {row.status === 'draft' && (
              <div className="rounded-md border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  세션을 시작하면 스캔 및 카운트 작업이 가능합니다.
                </p>
                <Button onClick={handleStart} disabled={startMutation.isPending}>
                  {startMutation.isPending ? '시작 중...' : '실사 시작'}
                </Button>
              </div>
            )}

            {/* 진행 중 상태: 스캔 도구 */}
            {row.status === 'in_progress' && (
              <>
                {/* 위치 스캔 */}
                <div className="rounded-md border p-3 space-y-3">
                  <p className="text-sm font-medium">위치 스캔</p>
                  <div className="flex gap-2">
                    <Input
                      value={locationBarcode}
                      onChange={(e) => setLocationBarcode(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleScanLocation()}
                      placeholder="위치 바코드 입력 후 Enter"
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleScanLocation}
                      disabled={scanLocationMutation.isPending || !locationBarcode}
                    >
                      스캔
                    </Button>
                  </div>
                  {scannedLocationCode && (
                    <div className="text-xs text-muted-foreground">
                      현재 위치:{' '}
                      <span className="font-mono font-medium text-foreground">
                        {scannedLocationCode}
                      </span>
                      {expectedItems.length > 0 && (
                        <span className="ml-2">예상 품목 {expectedItems.length}개</span>
                      )}
                    </div>
                  )}
                  {expectedItems.length > 0 && (
                    <ul className="max-h-32 overflow-y-auto space-y-1">
                      {expectedItems.map((item) => (
                        <li
                          key={item.skuId}
                          className="text-xs rounded bg-muted px-2 py-1 flex justify-between"
                        >
                          <span>{item.skuName}</span>
                          <span className="tabular-nums text-muted-foreground">
                            예상 {item.expectedQuantity}개
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 상품 스캔 */}
                <div className="rounded-md border p-3 space-y-3">
                  <p className="text-sm font-medium">상품 스캔</p>
                  <div className="flex gap-2">
                    <Input
                      value={productBarcode}
                      onChange={(e) => setProductBarcode(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleScanProduct()}
                      placeholder="상품 바코드 입력 후 Enter"
                      className="text-sm"
                      disabled={!scannedLocationId}
                    />
                    <Button
                      size="sm"
                      onClick={handleScanProduct}
                      disabled={
                        scanProductMutation.isPending || !productBarcode || !scannedLocationId
                      }
                    >
                      스캔
                    </Button>
                  </div>
                  {!scannedLocationId && (
                    <p className="text-xs text-muted-foreground">위치를 먼저 스캔해 주세요.</p>
                  )}
                </div>

                {/* 수동 카운트 입력 */}
                <div className="rounded-md border p-3 space-y-3">
                  <p className="text-sm font-medium">수동 카운트 입력</p>
                  <div className="grid grid-cols-[1fr_100px_auto] gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">라인 ID</Label>
                      <Input
                        value={manualLineId}
                        onChange={(e) => setManualLineId(e.target.value)}
                        placeholder="라인 ID (UUID)"
                        className="text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">카운트 수량</Label>
                      <Input
                        type="number"
                        min={0}
                        value={manualCount}
                        onChange={(e) => setManualCount(e.target.value)}
                        placeholder="수량"
                        className="text-xs"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleUpdateCount}
                      disabled={
                        updateCountMutation.isPending || !manualLineId || manualCount === ''
                      }
                    >
                      입력
                    </Button>
                  </div>
                </div>

                {/* 차이 목록 */}
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">차이 목록</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateAdjustments}
                      disabled={generateMutation.isPending}
                    >
                      {generateMutation.isPending ? '생성 중...' : '조정 일괄 생성'}
                    </Button>
                  </div>
                  {isVariancesLoading && (
                    <p className="text-xs text-muted-foreground">불러오는 중...</p>
                  )}
                  {!isVariancesLoading && (!variances || variances.length === 0) && (
                    <p className="text-xs text-muted-foreground">차이 항목이 없습니다.</p>
                  )}
                  {variances && variances.length > 0 && (
                    <ul className="max-h-48 overflow-y-auto space-y-1">
                      {variances.map((v) => (
                        <li
                          key={v.lineId}
                          className="rounded bg-muted px-2 py-1.5 text-xs space-y-0.5"
                        >
                          <div className="flex justify-between">
                            <span className="font-medium">{v.skuName}</span>
                            <span
                              className={`tabular-nums font-medium ${
                                (v.variance ?? 0) > 0 ? 'text-green-600' : 'text-destructive'
                              }`}
                            >
                              {(v.variance ?? 0) > 0 ? '+' : ''}
                              {v.variance}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            위치: {v.locationCode ?? '-'} · 예상 {v.expectedQuantity} → 실사{' '}
                            {v.countedQuantity ?? '-'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 실사 완료 */}
                <div className="flex justify-end pt-2">
                  <Button
                    variant="default"
                    onClick={handleComplete}
                    disabled={completeMutation.isPending}
                  >
                    {completeMutation.isPending ? '처리 중...' : '실사 완료'}
                  </Button>
                </div>
              </>
            )}

            {/* 완료 상태: 차이 요약 */}
            {row.status === 'completed' && (
              <div className="space-y-4">
                <div className="rounded-md border p-3 text-sm space-y-1">
                  <p className="font-medium">완료 정보</p>
                  {row.completedAt && (
                    <p className="text-muted-foreground">
                      완료일시:{' '}
                      <span className="text-foreground">
                        {new Date(row.completedAt).toLocaleString('ko-KR')}
                      </span>
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">최종 차이 목록</p>
                  {isVariancesLoading && (
                    <p className="text-xs text-muted-foreground">불러오는 중...</p>
                  )}
                  {!isVariancesLoading && (!variances || variances.length === 0) && (
                    <p className="text-xs text-muted-foreground">차이 항목이 없습니다.</p>
                  )}
                  {variances && variances.length > 0 && (
                    <ul className="space-y-1">
                      {variances.map((v) => (
                        <li
                          key={v.lineId}
                          className="rounded bg-muted px-2 py-1.5 text-xs space-y-0.5"
                        >
                          <div className="flex justify-between">
                            <span className="font-medium">{v.skuName}</span>
                            <span
                              className={`tabular-nums font-medium ${
                                (v.variance ?? 0) > 0 ? 'text-green-600' : 'text-destructive'
                              }`}
                            >
                              {(v.variance ?? 0) > 0 ? '+' : ''}
                              {v.variance}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            위치: {v.locationCode ?? '-'} · 예상 {v.expectedQuantity} → 실사{' '}
                            {v.countedQuantity ?? '-'} ({v.discrepancyPercent.toFixed(1)}%)
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
