'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { BarcodeScanInput } from '@/components/common/barcode-scan-input';
import {
  useStartIndividualPicking,
  usePickIndividualItem,
  useCompleteIndividualPicking,
  useResetPickingItem,
  usePickByBarcode,
} from '@/lib/services/orders/mutations';
import { useFulfillmentOrder } from '@/lib/services/orders/queries';
import type { PickingSession } from '@/lib/types/dto/fulfillment';
import { CheckCircle2, RotateCcw } from 'lucide-react';

interface Props {
  foId: string;
  open: boolean;
  onClose: () => void;
}

export function PickingSessionDrawer({ foId, open, onClose }: Props) {
  const [session, setSession] = useState<PickingSession | null>(null);
  const [barcode, setBarcode] = useState('');
  const [started, setStarted] = useState(false);

  // 바코드 스캔 피킹 시 실제 창고 ID 전달용 (SKU 바코드 경로에서 재고 검증에 사용)
  const { data: fo } = useFulfillmentOrder(foId);

  const startMutation = useStartIndividualPicking();
  const pickMutation = usePickIndividualItem();
  const completeMutation = useCompleteIndividualPicking();
  const resetMutation = useResetPickingItem();
  const pickByBarcodeMutation = usePickByBarcode();

  const handleStart = async () => {
    try {
      const result = await startMutation.mutateAsync(foId);
      setSession(result);
      setStarted(true);
      toast.success('피킹 세션이 시작되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '피킹 시작에 실패했습니다.');
    }
  };

  const handleBarcodeScan = async (scanned: string) => {
    if (!session) return;
    try {
      await pickByBarcodeMutation.mutateAsync({
        barcode: scanned,
        pickedQty: 1,
        fulfillmentOrderId: foId,
        warehouseId: fo?.warehouseId ?? '', // FO 상세에서 실제 창고 ID 사용
      });
      toast.success(`바코드 스캔 완료: ${scanned}`);
      // 세션 재조회로 진행 상황 갱신
      const updated = await startMutation.mutateAsync(foId);
      setSession(updated);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '피킹에 실패했습니다.');
    }
  };

  const handlePickItem = async (foiId: string) => {
    try {
      await pickMutation.mutateAsync({ foiId, data: { pickedQty: 1 } });
      toast.success('피킹 완료');
      const updated = await startMutation.mutateAsync(foId);
      setSession(updated);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '피킹에 실패했습니다.');
    }
  };

  const handleReset = async (foiId: string) => {
    try {
      await resetMutation.mutateAsync(foiId);
      toast.success('피킹이 초기화되었습니다.');
      const updated = await startMutation.mutateAsync(foId);
      setSession(updated);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '초기화에 실패했습니다.');
    }
  };

  const handleComplete = async () => {
    try {
      await completeMutation.mutateAsync(foId);
      toast.success('피킹이 완료되었습니다.');
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '완료 처리에 실패했습니다.');
    }
  };

  const handleClose = () => {
    setSession(null);
    setStarted(false);
    setBarcode('');
    onClose();
  };

  const allPicked = session?.items.every((i) => i.pickedQty >= i.requiredQty);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>개별 피킹</SheetTitle>
          <SheetDescription className="font-mono text-xs">{foId}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          {!started ? (
            <Button onClick={handleStart} disabled={startMutation.isPending}>
              {startMutation.isPending ? '시작 중…' : '피킹 시작'}
            </Button>
          ) : (
            <>
              <BarcodeScanInput
                value={barcode}
                onChange={setBarcode}
                onScan={handleBarcodeScan}
                disabled={pickByBarcodeMutation.isPending}
                autoFocus
              />

              {session && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    피킹 항목 ({session.items.filter((i) => i.pickedQty >= i.requiredQty).length}/{session.items.length})
                  </p>
                  <div className="flex flex-col gap-1 rounded-md border p-2">
                    {session.items.map((item) => {
                      const done = item.pickedQty >= item.requiredQty;
                      return (
                        <div key={item.foiId} className="flex items-center gap-2 py-1">
                          <div className="flex flex-1 flex-col">
                            <span className="text-sm font-medium">{item.skuName}</span>
                            <span className="font-mono text-xs text-muted-foreground">{item.skuCode}</span>
                          </div>
                          <Badge variant={done ? 'default' : 'secondary'}>
                            {item.pickedQty}/{item.requiredQty}
                          </Badge>
                          {done ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleReset(item.foiId)}
                              disabled={resetMutation.isPending}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePickItem(item.foiId)}
                              disabled={pickMutation.isPending}
                            >
                              피킹
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button
                onClick={handleComplete}
                disabled={!allPicked || completeMutation.isPending}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {completeMutation.isPending ? '처리 중…' : '피킹 완료'}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
