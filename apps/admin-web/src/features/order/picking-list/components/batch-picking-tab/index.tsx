'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { BarcodeScanInput } from '@/components/common/barcode-scan-input';
import {
  useBatchPickingOperations,
  useBatchPickingProgress,
} from '@/lib/services/orders/queries';
import {
  useBatchPick,
  useGenerateBarcode,
} from '@/lib/services/orders/mutations';
import type { PickingOperation } from '@/lib/types/dto/fulfillment';

// 백엔드는 SKU 단위 집계만 주므로 진행 상태는 pickedQty/totalQty 로 프론트에서 도출
function operationStatus(
  op: PickingOperation
): 'pending' | 'partial' | 'completed' {
  if (op.pickedQty >= op.totalQty) return 'completed';
  if (op.pickedQty > 0) return 'partial';
  return 'pending';
}

function normalizeScannedSku(scanned: string) {
  const trimmed = scanned.trim();
  return trimmed.toUpperCase().startsWith('SKU-') ? trimmed.slice(4) : trimmed;
}

export function BatchPickingTab() {
  const [batchId, setBatchId] = useState('');
  const [searchedBatchId, setSearchedBatchId] = useState('');
  const [barcode, setBarcode] = useState('');

  const { data: operations, isLoading: opsLoading } =
    useBatchPickingOperations(searchedBatchId);
  const { data: progress } = useBatchPickingProgress(searchedBatchId);
  const batchPickMutation = useBatchPick();
  const generateBarcodeMutation = useGenerateBarcode();

  const handleSearch = () => {
    const trimmed = batchId.trim();
    if (!trimmed) return;
    setSearchedBatchId(trimmed);
  };

  const handleBarcodeScan = async (scanned: string) => {
    if (!searchedBatchId) return;
    const scannedSku = normalizeScannedSku(scanned).toLowerCase();
    const op = operations?.find(
      (operation) =>
        operation.skuId.toLowerCase() === scannedSku ||
        operation.skuCode.toLowerCase() === scannedSku
    );
    if (!op || op.remainingQty <= 0) {
      toast.error('매칭되는 SKU를 찾을 수 없습니다.');
      return;
    }
    try {
      await batchPickMutation.mutateAsync({
        batchId: searchedBatchId,
        skuId: op.skuId,
        pickedQty: 1,
        locationCode: op.locationCode,
      });
      toast.success('피킹 완료');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '피킹에 실패했습니다.');
    }
  };

  const handleGenerateBarcode = async (skuId: string) => {
    try {
      const result = await generateBarcodeMutation.mutateAsync({
        type: 'sku',
        id: skuId,
      });
      if (result.uri) {
        window.open(result.uri, '_blank');
      } else {
        toast.success(`바코드: ${result.barcode}`);
      }
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : '바코드 생성에 실패했습니다.'
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="batch-id-input">배치 ID</Label>
          <Input
            id="batch-id-input"
            placeholder="Outbound Batch ID 입력"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            className="w-80"
          />
        </div>
        <Button onClick={handleSearch} disabled={!batchId.trim()}>
          <Search className="mr-2 h-4 w-4" />
          조회
        </Button>
      </div>

      {searchedBatchId && (
        <>
          {progress && (
            <div className="flex items-center gap-2 rounded-md border p-3">
              <span className="text-sm text-muted-foreground">진행률</span>
              <Badge variant="secondary">
                {progress.pickedItems}/{progress.totalItems}
              </Badge>
              <span className="text-sm font-medium">
                {progress.completionPercentage}%
              </span>
            </div>
          )}

          <BarcodeScanInput
            value={barcode}
            onChange={setBarcode}
            onScan={handleBarcodeScan}
            disabled={batchPickMutation.isPending}
          />

          {opsLoading ? (
            <p className="text-sm text-muted-foreground">로딩 중…</p>
          ) : operations && operations.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-md border p-2">
              {operations.map((op) => {
                const status = operationStatus(op);
                return (
                  <div key={op.skuId} className="flex items-center gap-2 py-1">
                    <div className="flex flex-1 flex-col">
                      <span className="text-sm font-medium">{op.skuName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {op.skuCode} {op.locationCode && `— ${op.locationCode}`}
                      </span>
                    </div>
                    <Badge
                      variant={
                        status === 'completed'
                          ? 'default'
                          : status === 'partial'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {op.pickedQty}/{op.totalQty}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleGenerateBarcode(op.skuId)}
                      disabled={generateBarcodeMutation.isPending}
                    >
                      라벨
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              조회된 피킹 작업이 없습니다.
            </p>
          )}
        </>
      )}
    </div>
  );
}
