'use client';

import { useState } from 'react';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useEditInboundShipmentBox } from '@/lib/services/inventory/inbound-shipment-mutations';
import type { InboundShipmentDetail } from '@/lib/types/dto/inbound-shipment';
import { forwardBoxes, skuLineCountInBox } from '../../lib/shipment-rules';
import { writeErrorMessage } from './mutation-error';

interface Props {
  shipment: InboundShipmentDetail;
  acknowledged: ReadonlySet<string>;
  onCheck: (boxId: string, checked: boolean) => void;
}

export function ForwardStrip({ shipment, acknowledged, onCheck }: Props) {
  const editBox = useEditInboundShipmentBox();
  const [message, setMessage] = useState<string | null>(null);
  const boxes = forwardBoxes(shipment);
  if (boxes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="text-sm font-medium">전달용 {boxes.length}</div>
      {boxes.map((box) => {
        const skuLines = skuLineCountInBox(shipment, box.label);
        return (
          <div
            key={box.id}
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <label className="flex items-center gap-2">
              <Checkbox
                checked={acknowledged.has(box.id)}
                onCheckedChange={(v) => onCheck(box.id, v === true)}
              />
              <span className="font-medium">{box.label}</span>
            </label>
            <span className="text-muted-foreground">{box.forwardNote}</span>
            {skuLines > 0 && (
              <span className="text-amber-600">
                이 상자 안의 SKU 줄 {skuLines}개는 재고로 안 들어옵니다
              </span>
            )}
            <Can run={useEditInboundShipmentBox}>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={editBox.isPending}
                onClick={() => {
                  setMessage(null);
                  onCheck(box.id, false);
                  editBox.mutate(
                    { id: shipment.id, boxId: box.id, disposition: 'stock' },
                    { onError: (e) => setMessage(writeErrorMessage(e)) }
                  );
                }}
              >
                재고로 받기
              </Button>
            </Can>
          </div>
        );
      })}
      {message && <div className="text-sm text-destructive">{message}</div>}
    </div>
  );
}
