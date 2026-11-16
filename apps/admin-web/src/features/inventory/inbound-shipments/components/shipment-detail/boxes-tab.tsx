'use client';

import { useState } from 'react';
import { useSyncedState } from '../../lib/use-synced-state';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_BOX_LABEL_LENGTH } from '../../lib/shipment-rules';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useEditInboundShipmentBox } from '@/lib/services/inventory/inbound-shipment-mutations';
import type {
  InboundShipmentBox,
  InboundShipmentDetail,
} from '@/lib/types/dto/inbound-shipment';
import { boxDispositionEditable } from '../../lib/shipment-rules';
import { writeErrorMessage } from './mutation-error';

export function BoxesTab({
  shipment,
  onForgetAck,
}: {
  shipment: InboundShipmentDetail;
  onForgetAck: (boxId: string) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {message && <div className="text-sm text-destructive">{message}</div>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>처분</TableHead>
            {shipment.status !== 'draft' && (
              <>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">센 수량</TableHead>
                <TableHead>확정 시각</TableHead>
              </>
            )}
            <TableHead className="text-right">덮는 줄</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shipment.boxes.map((box) => (
            <BoxRow
              key={box.id}
              shipment={shipment}
              box={box}
              onError={setMessage}
              onForgetAck={onForgetAck}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BoxRow({
  shipment,
  box,
  onError,
  onForgetAck,
}: {
  shipment: InboundShipmentDetail;
  box: InboundShipmentBox;
  onError: (m: string | null) => void;
  onForgetAck: (boxId: string) => void;
}) {
  const editBox = useEditInboundShipmentBox();
  const [label, setLabel] = useSyncedState(box.label);
  const coverCount = shipment.lines.filter((l) =>
    l.coversBoxLabels.includes(box.label)
  ).length;
  const dispositionEditable = boxDispositionEditable(shipment, box);
  const nameEditable = shipment.status === 'draft';
  const next = box.disposition === 'stock' ? 'forward' : 'stock';

  const run = (body: { disposition?: 'stock' | 'forward'; label?: string }) => {
    onError(null);
    editBox.mutate(
      { id: shipment.id, boxId: box.id, ...body },
      { onError: (e) => onError(writeErrorMessage(e)) }
    );
  };

  return (
    <TableRow>
      <TableCell>
        {nameEditable ? (
          <div className="flex items-center gap-2">
            <Input
              className="w-40"
              value={label}
              maxLength={MAX_BOX_LABEL_LENGTH}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="상자 이름"
            />
            {label !== box.label && label.trim() !== '' && (
              <Can run={useEditInboundShipmentBox}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={editBox.isPending}
                  onClick={() => run({ label })}
                >
                  이름 저장
                </Button>
              </Can>
            )}
          </div>
        ) : (
          box.label
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{box.disposition === 'stock' ? '재고' : '전달용'}</span>
          {box.origin === 'added' && (
            <span className="text-muted-foreground">리스트에 없던 상자</span>
          )}
          {dispositionEditable && (
            <Can run={useEditInboundShipmentBox}>
              <Button
                size="sm"
                variant="outline"
                disabled={editBox.isPending}
                onClick={() => {
                  if (next === 'stock') onForgetAck(box.id);
                  run({ disposition: next });
                }}
              >
                {next === 'stock' ? '재고로 받기' : '전달용으로'}
              </Button>
            </Can>
          )}
        </div>
      </TableCell>
      {shipment.status !== 'draft' && (
        <>
          <TableCell>{box.status === 'received' ? '받음' : '열림'}</TableCell>
          <TableCell className="text-right">{box.countedQty}</TableCell>
          <TableCell>
            {box.receivedAt
              ? new Date(box.receivedAt).toLocaleString('ko-KR')
              : ''}
          </TableCell>
        </>
      )}
      <TableCell className="text-right">{coverCount}</TableCell>
    </TableRow>
  );
}
