'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { InboundShipmentDetail, InboundShipmentLine } from '@/lib/types/dto/inbound-shipment';
import { differenceText, hasDifference, issueLabel, needsAttention } from '../../lib/line-rules';

export function boxRangeText(labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels[labels.length - 1]}`;
}

function kindText(line: InboundShipmentLine): string {
  if (line.kind === 'free') return '자유 줄';
  if (line.kind === 'unresolved') return '미확인';
  return line.sku ? `${line.sku.code} ${line.sku.name}` : 'SKU';
}

export function LinesTable({
  shipment,
  onSelect,
}: {
  shipment: InboundShipmentDetail;
  onSelect: (lineId: string) => void;
}) {
  const [onlyAttention, setOnlyAttention] = useState(true);
  // 확정 뒤에는 «확인 필요» 가 아니라 «차이 있는 줄» 을 거른다.
  const confirmed = shipment.status !== 'draft';
  const keep = confirmed ? hasDifference : needsAttention;
  const lines = onlyAttention ? shipment.lines.filter(keep) : shipment.lines;
  const coveredOf = (line: InboundShipmentLine) =>
    shipment.boxes.filter((b) => line.coversBoxLabels.includes(b.label));

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={onlyAttention} onCheckedChange={(v) => setOnlyAttention(v === true)} />
        {confirmed ? '차이 있는 줄만' : '확인 필요만'}
      </label>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>행</TableHead>
            <TableHead>상자</TableHead>
            <TableHead>제품명</TableHead>
            <TableHead>옵션</TableHead>
            <TableHead>바코드</TableHead>
            <TableHead className="text-right">수량</TableHead>
            <TableHead>종류</TableHead>
            {confirmed ? <TableHead className="text-right">센 수량</TableHead> : null}
            {confirmed ? <TableHead>차이</TableHead> : <TableHead>사유</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={confirmed ? 9 : 8} className="text-center text-muted-foreground">
                {onlyAttention ? (confirmed ? '차이 있는 줄이 없습니다.' : '확인 필요한 줄이 없습니다.') : '줄이 없습니다.'}
              </TableCell>
            </TableRow>
          ) : (
            lines.map((line) => (
              <TableRow key={line.id} className="cursor-pointer" onClick={() => onSelect(line.id)}>
                <TableCell>{line.rowNumber}</TableCell>
                <TableCell>{boxRangeText(line.coversBoxLabels)}</TableCell>
                <TableCell>{line.raw.productName?.text}</TableCell>
                <TableCell>{line.raw.option?.text}</TableCell>
                <TableCell>{line.raw.barcode?.text}</TableCell>
                <TableCell className="text-right">{line.expectedQty ?? line.raw.quantity?.text}</TableCell>
                <TableCell>{kindText(line)}</TableCell>
                {confirmed ? <TableCell className="text-right">{line.countedQty}</TableCell> : null}
                {confirmed ? (
                  <TableCell>{differenceText(line, coveredOf(line))}</TableCell>
                ) : (
                  <TableCell>{line.issues.map(issueLabel).join(', ')}</TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
