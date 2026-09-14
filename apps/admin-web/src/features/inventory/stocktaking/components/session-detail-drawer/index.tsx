'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { stocktakingClient } from '@/lib/api/domains/inventory/stocktaking.client';
import {
  retryPendingStocktakingOperation,
  stocktakingFailure,
} from '@/lib/api/domains/inventory/stocktaking-operation';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import type {
  StocktakingSessionDto,
  ScanLocationExpectedItem,
  GenerateAdjustmentsResponse,
} from '@/lib/types/dto/inventory';
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
  const queryClient = useQueryClient();
  const actionLock = useRef(false);
  const [working, setWorking] = useState(false);
  const [reviewed, setReviewed] = useState<GenerateAdjustmentsResponse>();

  const [locationBarcode, setLocationBarcode] = useState('');
  const [scannedLocationId, setScannedLocationId] = useState('');
  const [scannedLocationCode, setScannedLocationCode] = useState('');
  const [expectedItems, setExpectedItems] = useState<
    ScanLocationExpectedItem[]
  >([]);
  const [productBarcode, setProductBarcode] = useState('');
  const [manualLineId, setManualLineId] = useState('');
  const [manualCount, setManualCount] = useState('');

  const {
    data: variances,
    isLoading: isVariancesLoading,
    isFetching: variancesFetching,
    dataUpdatedAt: variancesUpdatedAt,
  } = useStocktakingVariances(row?.status !== 'draft' ? sessionId : '');

  const startMutation = useStartStocktakingSession();
  const scanLocationMutation = useScanLocation();
  const scanProductMutation = useScanProduct();
  const updateCountMutation = useUpdateLineCount();
  const generateMutation = useGenerateAdjustments();
  const completeMutation = useCompleteStocktakingSession();

  useEffect(() => {
    setReviewed(undefined);
  }, [sessionId, open, variancesUpdatedAt, variancesFetching]);

  const runAction = async (
    action: () => Promise<void>,
    changesCount = true
  ) => {
    if (actionLock.current) {
      toast.error('앞선 작업을 확인하고 있어요. 잠시 후 입력해 주세요.');
      return;
    }
    actionLock.current = true;
    setWorking(true);
    if (changesCount) setReviewed(undefined);
    try {
      await action();
    } catch (error) {
      setReviewed(undefined);
      const failure = stocktakingFailure(error);
      const message = failure.code?.startsWith('STOCKTAKING_')
        ? failure.message
        : undefined;
      toast.error(
        message ??
          '처리 여부를 확인해 주세요. 다시 찍기 전에 작업 확인을 눌러 주세요.'
      );
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  };

  const updateItem = (
    lineId: string,
    result: {
      countedQuantity: number | null;
      expectedQuantity: number;
      lineRevision: number;
      countBaselineVersion: number;
    }
  ) => {
    setExpectedItems((items) =>
      items.map((item) =>
        item.lineId === lineId ? { ...item, ...result } : item
      )
    );
  };

  const handleStart = () =>
    runAction(async () => {
      if (!sessionId) return;
      await startMutation.mutateAsync(sessionId);
      toast.success('재고 실사를 시작했습니다.');
    });

  const handleScanLocation = () =>
    runAction(async () => {
      if (!locationBarcode) return;
      const result = await scanLocationMutation.mutateAsync({
        sessionId,
        locationBarcode,
        idempotencyKey: crypto.randomUUID(),
      });
      setScannedLocationId(result.locationId);
      setScannedLocationCode(result.locationCode);
      setExpectedItems(result.expectedItems);
      setManualLineId('');
      setLocationBarcode('');
      toast.success(`위치 ${result.locationCode}의 수량을 확인해 주세요.`);
    });

  const handleScanProduct = () =>
    runAction(async () => {
      if (!productBarcode || !scannedLocationId) {
        toast.error('위치를 먼저 선택해 주세요.');
        return;
      }
      const barcode = productBarcode;
      const result = await scanProductMutation.mutateAsync({
        sessionId,
        locationId: scannedLocationId,
        productBarcode: barcode,
        quantity: 1,
        idempotencyKey: crypto.randomUUID(),
      });
      setExpectedItems((items) =>
        items.some((item) => item.lineId === result.lineId)
          ? items.map((item) =>
              item.lineId === result.lineId ? { ...item, ...result } : item
            )
          : [
              ...items,
              { ...result, barcode, skuName: barcode, skuCode: barcode },
            ]
      );
      setProductBarcode('');
    });

  const handleUpdateCount = () =>
    runAction(async () => {
      const selected = expectedItems.find(
        (item) => item.lineId === manualLineId
      );
      const quantity = Number(manualCount);
      if (
        !selected ||
        manualCount === '' ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0
      ) {
        toast.error('상품을 선택하고 올바른 수량을 입력해 주세요.');
        return;
      }
      const result = await updateCountMutation.mutateAsync({
        lineId: selected.lineId,
        data: {
          countedQuantity: quantity,
          expectedRevision: selected.lineRevision,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      updateItem(selected.lineId, result);
      setManualCount('');
      await queryClient.invalidateQueries({
        queryKey: ['inventory', 'stocktaking'],
      });
    });

  const handleResetCount = () =>
    runAction(async () => {
      const selected = expectedItems.find(
        (item) => item.lineId === manualLineId
      );
      if (!selected) {
        toast.error('다시 셀 상품을 선택해 주세요.');
        return;
      }
      const result = await stocktakingClient.resetCount(selected.lineId, {
        expectedRevision: selected.lineRevision,
        idempotencyKey: crypto.randomUUID(),
      });
      updateItem(selected.lineId, result);
      setManualCount('');
      await queryClient.invalidateQueries({
        queryKey: ['inventory', 'stocktaking'],
      });
      toast.success('선택한 상품을 처음부터 다시 세어 주세요.');
    });

  const handleGenerateAdjustments = () =>
    runAction(async () => {
      setReviewed(undefined);
      const result = await generateMutation.mutateAsync({ sessionId });
      setReviewed(result);
    }, false);

  const handleComplete = () =>
    runAction(async () => {
      const review =
        reviewed ?? (await generateMutation.mutateAsync({ sessionId }));
      if (!reviewed && review.preview.length > 0) {
        setReviewed(review);
        toast.info('반영할 수량을 확인한 뒤 완료해 주세요.');
        return;
      }
      const result = await completeMutation.mutateAsync({
        sessionId,
        data: {
          previewToken: review.previewToken,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      toast.success(
        `실사가 완료됐어요. ${result.summary.adjustmentsApplied}개 상품의 수량을 반영했어요.`
      );
      onOpenChange(false);
    }, false);

  const handleRecover = () =>
    runAction(async () => {
      const recovered = await retryPendingStocktakingOperation();
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setExpectedItems([]);
      setScannedLocationId('');
      setScannedLocationCode('');
      setManualLineId('');
      toast.success(
        recovered
          ? '앞선 작업을 확인했어요. 위치를 다시 열어 현재 수량을 확인해 주세요.'
          : '미확인 작업이 없어요.'
      );
    });

  const handleClose = () => {
    if (actionLock.current) {
      toast.error('현재 작업을 확인하고 있어요.');
      return;
    }
    setReviewed(undefined);
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecover}
              disabled={working}
            >
              작업 확인
            </Button>
            {/* 세션 기본 정보 */}
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p className="font-medium">세션 정보</p>
              <p className="text-muted-foreground">
                세션명:{' '}
                <span className="text-foreground">{row.sessionName}</span>
              </p>
              <p className="text-muted-foreground">
                상태:{' '}
                <span className="font-medium text-foreground">
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </p>
              <p className="text-muted-foreground">
                창고 ID:{' '}
                <span className="font-mono text-xs">
                  {row.warehouseId.slice(0, 8)}…
                </span>
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
                <Button
                  onClick={handleStart}
                  disabled={startMutation.isPending}
                >
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
                      onKeyDown={(e) =>
                        e.key === 'Enter' && handleScanLocation()
                      }
                      placeholder="위치 바코드 입력 후 Enter"
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleScanLocation}
                      disabled={working || !locationBarcode}
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
                        <span className="ml-2">
                          예상 품목 {expectedItems.length}개
                        </span>
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
                            확정 {item.countedQuantity ?? '미확인'} / 예상{' '}
                            {item.expectedQuantity}개
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
                      onKeyDown={(e) =>
                        e.key === 'Enter' && handleScanProduct()
                      }
                      placeholder="상품 바코드 입력 후 Enter"
                      className="text-sm"
                      disabled={working || !scannedLocationId}
                    />
                    <Button
                      size="sm"
                      onClick={handleScanProduct}
                      disabled={
                        working || !productBarcode || !scannedLocationId
                      }
                    >
                      스캔
                    </Button>
                  </div>
                  {!scannedLocationId && (
                    <p className="text-xs text-muted-foreground">
                      위치를 먼저 스캔해 주세요.
                    </p>
                  )}
                </div>

                {/* 수동 카운트 입력 */}
                <div className="rounded-md border p-3 space-y-3">
                  <p className="text-sm font-medium">수동 카운트 입력</p>
                  <div className="grid grid-cols-[1fr_100px_auto] gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">상품</Label>
                      <select
                        value={manualLineId}
                        onChange={(event) =>
                          setManualLineId(event.target.value)
                        }
                        disabled={working}
                        className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="">상품 선택</option>
                        {expectedItems.map((item) => (
                          <option key={item.lineId} value={item.lineId}>
                            {item.skuName}
                          </option>
                        ))}
                      </select>
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
                      disabled={working || !manualLineId || manualCount === ''}
                    >
                      입력
                    </Button>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={handleResetCount}
                  disabled={working || !manualLineId}
                >
                  선택한 상품 다시 세기
                </Button>

                {/* 차이 목록 */}
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">차이 목록</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateAdjustments}
                      disabled={working || variancesFetching}
                    >
                      {generateMutation.isPending
                        ? '확인 중...'
                        : '반영 수량 확인'}
                    </Button>
                  </div>
                  {isVariancesLoading && (
                    <p className="text-xs text-muted-foreground">
                      불러오는 중...
                    </p>
                  )}
                  {!isVariancesLoading &&
                    (!variances || variances.length === 0) && (
                      <p className="text-xs text-muted-foreground">
                        차이 항목이 없습니다.
                      </p>
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
                                (v.variance ?? 0) > 0
                                  ? 'text-green-600'
                                  : 'text-destructive'
                              }`}
                            >
                              {(v.variance ?? 0) > 0 ? '+' : ''}
                              {v.variance}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            위치: {v.locationCode ?? '-'} · 예상{' '}
                            {v.expectedQuantity} → 실사{' '}
                            {v.countedQuantity ?? '-'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {reviewed && (
                  <div className="rounded-md border p-3 text-sm space-y-2">
                    <p className="font-medium">반영할 수량</p>
                    {reviewed.preview.length === 0 ? (
                      <p>바뀌는 수량이 없어요.</p>
                    ) : (
                      reviewed.preview.map((item) => (
                        <p key={item.lineId}>
                          {item.skuName ??
                            expectedItems.find(
                              (product) => product.lineId === item.lineId
                            )?.skuName ??
                            '실사 상품'}{' '}
                          · {item.locationCode ?? '위치 확인'}:{' '}
                          {item.currentOnHand} → {item.countedQuantity} (
                          {item.delta > 0 ? '+' : ''}
                          {item.delta})
                        </p>
                      ))
                    )}
                  </div>
                )}

                {/* 실사 완료 */}
                <div className="flex justify-end pt-2">
                  <Button
                    variant="default"
                    onClick={handleComplete}
                    disabled={
                      working ||
                      variancesFetching ||
                      (!reviewed && !!variances?.length)
                    }
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
                    <p className="text-xs text-muted-foreground">
                      불러오는 중...
                    </p>
                  )}
                  {!isVariancesLoading &&
                    (!variances || variances.length === 0) && (
                      <p className="text-xs text-muted-foreground">
                        차이 항목이 없습니다.
                      </p>
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
                                (v.variance ?? 0) > 0
                                  ? 'text-green-600'
                                  : 'text-destructive'
                              }`}
                            >
                              {(v.variance ?? 0) > 0 ? '+' : ''}
                              {v.variance}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            위치: {v.locationCode ?? '-'} · 예상{' '}
                            {v.expectedQuantity} → 실사{' '}
                            {v.countedQuantity ?? '-'} (
                            {v.discrepancyPercent.toFixed(1)}%)
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
