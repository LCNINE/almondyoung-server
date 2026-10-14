'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';
import { LineCompositionDialog } from '../../line-composition/components/line-composition-dialog';
import {
  compositionItemText,
  sourceBadge,
  type LineCompositionTarget,
} from '../../line-composition/line-composition-view';

/** 판매 라인마다 구성과 개별 지정 여부(#1063 스펙 §8-2). 옛 core 는 lines 를 안 줘서 구역이 숨는다 */
export function LineCompositions({ fo, canEdit }: { fo: FulfillmentOrderDetail; canEdit: boolean }) {
  const [target, setTarget] = useState<LineCompositionTarget | null>(null);
  const lines = fo.lines ?? [];
  const salesOrderId = fo.salesOrderId;
  if (lines.length === 0) return null;

  return (
    <Container>
      <Header title={`판매 라인 (${lines.length})`} />
      <div className="overflow-x-auto p-3">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((line) => {
              const badge = sourceBadge(line.compositionSource);
              return (
                <tr key={line.salesOrderLineId} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{line.productName}</div>
                    <div className="text-xs text-gray-500">수량 {line.quantity}개</div>
                  </td>
                  <td className="py-2 pr-3">
                    {line.composition.map((item) => (
                      <div key={item.skuId}>{compositionItemText(item)}</div>
                    ))}
                  </td>
                  <td className="py-2 pr-3">{badge && <Badge variant="secondary">{badge}</Badge>}</td>
                  <td className="py-2 text-right">
                    {canEdit && salesOrderId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setTarget({
                            salesOrderId,
                            salesOrderLineId: line.salesOrderLineId,
                            productName: line.productName,
                            quantity: line.quantity,
                            composition: line.composition,
                          })
                        }
                      >
                        이 주문만
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {target && (
        <LineCompositionDialog
          key={target.salesOrderLineId}
          target={target}
          onClose={() => setTarget(null)}
          currentFulfillmentOrderId={fo.id}
        />
      )}
    </Container>
  );
}
