'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAvailableFulfillmentOrders, useAddFOsToBatch } from '@/lib/services/orders';
import type { AvailableFulfillmentOrder } from '@/lib/types/dto/fulfillment';

const PRIORITY_LABELS: Record<string, string> = {
  urgent: '긴급',
  high: '높음',
  normal: '일반',
};

interface Props {
  batchId: string;
  warehouseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AvailableFOsDrawer({ batchId, warehouseId, open, onOpenChange }: Props) {
  const { data: fos = [], isLoading } = useAvailableFulfillmentOrders(warehouseId);
  const addFOs = useAddFOsToBatch(batchId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === fos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(fos.map((fo: AvailableFulfillmentOrder) => fo.id)));
    }
  };

  const handleAdd = async () => {
    await addFOs.mutateAsync({ fulfillmentOrderIds: Array.from(selected) });
    setSelected(new Set());
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[640px] sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>배치에 FO 추가</SheetTitle>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          ) : fos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              추가 가능한 풀필먼트 오더가 없습니다.
            </p>
          ) : (
            <>
              <div className="overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selected.size === fos.length && fos.length > 0}
                          onCheckedChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead>FO ID</TableHead>
                      <TableHead>우선순위</TableHead>
                      <TableHead>배송 모드</TableHead>
                      <TableHead className="text-right">라인 수</TableHead>
                      <TableHead className="text-right">수량</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fos.map((fo: AvailableFulfillmentOrder) => (
                      <TableRow
                        key={fo.id}
                        className="cursor-pointer"
                        onClick={() => toggle(fo.id)}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected.has(fo.id)}
                            onCheckedChange={() => toggle(fo.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{fo.id}</TableCell>
                        <TableCell>{PRIORITY_LABELS[fo.priority] ?? fo.priority}</TableCell>
                        <TableCell>{fo.fulfillmentMode}</TableCell>
                        <TableCell className="text-right">{fo.totalItems}</TableCell>
                        <TableCell className="text-right">{fo.totalQty}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {selected.size}개 선택됨
                </span>
                <Button
                  onClick={handleAdd}
                  disabled={selected.size === 0 || addFOs.isPending}
                >
                  선택 FO 추가
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
