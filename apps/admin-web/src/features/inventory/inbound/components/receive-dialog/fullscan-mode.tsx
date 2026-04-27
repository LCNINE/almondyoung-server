'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useVerifyBarcode, useSimpleFullscanInbound } from '@/lib/services/inventory';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

// 바코드 스캔 누적 후 simple-fullscan 방식으로 입고 처리
// stocktaking session-detail-drawer의 Input + 로컬 state 패턴을 기반으로 구성
// TODO: 추후 components/common/barcode-scan-input/ 공용 컴포넌트로 추출 예정

type ScannedItem = {
  barcode: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
};

type Props = {
  warehouseId: string;
  onSuccess: () => void;
};

export function FullscanMode({ warehouseId, onSuccess }: Props) {
  const [barcode, setBarcode] = useState('');
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const verifyMutation = useVerifyBarcode();
  const inboundMutation = useSimpleFullscanInbound();

  const handleScan = async () => {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    try {
      const result = await verifyMutation.mutateAsync({ barcode: trimmed });
      setBarcode('');
      barcodeInputRef.current?.focus();

      const existing = scannedItems.find((i) => i.skuId === result.skuId);
      if (existing) {
        setScannedItems((prev) =>
          prev.map((i) => (i.skuId === result.skuId ? { ...i, quantity: i.quantity + 1 } : i))
        );
        toast.success(`${result.skuName} — 수량 +1 (합계: ${existing.quantity + 1})`);
      } else {
        setScannedItems((prev) => [
          ...prev,
          { barcode: trimmed, skuId: result.skuId, skuCode: result.skuCode, skuName: result.skuName, quantity: 1 },
        ]);
        toast.success(`${result.skuName} 스캔 완료`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '바코드 검증에 실패했습니다.');
    }
  };

  const removeItem = (skuId: string) => {
    setScannedItems((prev) => prev.filter((i) => i.skuId !== skuId));
  };

  const updateQty = (skuId: string, qty: number) => {
    if (qty < 1) return;
    setScannedItems((prev) => prev.map((i) => (i.skuId === skuId ? { ...i, quantity: qty } : i)));
  };

  const handleSubmit = async () => {
    if (scannedItems.length === 0) {
      toast.error('스캔된 항목이 없습니다.');
      return;
    }
    try {
      await inboundMutation.mutateAsync({
        warehouseId,
        items: scannedItems.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      });
      toast.success('전수조사 입고가 처리되었습니다.');
      onSuccess();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '입고 처리에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label>바코드 스캔</Label>
          <Input
            ref={barcodeInputRef}
            placeholder="바코드를 스캔하거나 입력 후 Enter"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleScan();
            }}
            autoFocus
          />
        </div>
        <Button
          variant="outline"
          className="mt-6"
          onClick={handleScan}
          disabled={verifyMutation.isPending || !barcode.trim()}
        >
          확인
        </Button>
      </div>

      {scannedItems.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">스캔 목록 ({scannedItems.length}종)</span>
            <Badge variant="secondary">
              총 {scannedItems.reduce((s, i) => s + i.quantity, 0)}개
            </Badge>
          </div>
          <div className="flex flex-col gap-1 rounded-md border p-2">
            {scannedItems.map((item) => (
              <div key={item.skuId} className="flex items-center gap-2 py-1">
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{item.skuName}</span>
                  <span className="font-mono text-xs text-muted-foreground">{item.skuCode}</span>
                </div>
                <Input
                  type="number"
                  min={1}
                  className="w-20"
                  value={item.quantity}
                  onChange={(e) => updateQty(item.skuId, Number(e.target.value))}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(item.skuId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button onClick={handleSubmit} disabled={inboundMutation.isPending || scannedItems.length === 0}>
        {inboundMutation.isPending ? '처리 중…' : `입고 처리 (${scannedItems.length}종)`}
      </Button>
    </div>
  );
}
