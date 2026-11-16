'use client';

import { useEffect, useState } from 'react';
import { useSyncedState } from '../../lib/use-synced-state';
import { useQuery } from '@tanstack/react-query';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { skusClient } from '@/lib/api/domains/inventory/skus.client';
import { useEditInboundShipmentLine } from '@/lib/services/inventory/inbound-shipment-mutations';
import type {
  EditInboundShipmentLineBody,
  InboundShipmentDetail,
  InboundShipmentLine,
} from '@/lib/types/dto/inbound-shipment';
import {
  cellDisplayText,
  isValidLineQty,
  issueLabel,
  lineEditability,
  prefillSearchText,
  skuSearchQueries,
} from '../../lib/line-rules';
import { mergeSkuCandidates } from '../../lib/sku-candidates';
import { writeErrorMessage } from './mutation-error';

const RAW_LABELS: Array<[keyof InboundShipmentLine['raw'], string]> = [
  ['boxLabel', '상자'],
  ['no', '번호'],
  ['productName', '제품명'],
  ['option', '옵션'],
  ['barcode', '바코드'],
  ['quantity', '수량'],
  ['total', '합계'],
  ['remark', '비고'],
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function LineDrawer({
  shipment,
  line,
  onClose,
}: {
  shipment: InboundShipmentDetail;
  line: InboundShipmentLine | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={line !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{line ? `행 ${line.rowNumber}` : ''}</SheetTitle>
        </SheetHeader>
        {/* line 이 바뀌면 입력 상태를 새로 시작한다 */}
        {line && <DrawerBody key={line.id} shipment={shipment} line={line} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  shipment,
  line,
}: {
  shipment: InboundShipmentDetail;
  line: InboundShipmentLine;
}) {
  const edit = useEditInboundShipmentLine();
  const editability = lineEditability(shipment, line);
  const canEdit = editability.editable;
  const isDraft = shipment.status === 'draft';
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState(prefillSearchText(line));
  const debounced = useDebounced(text, 300);
  const [qty, setQty] = useSyncedState(line.expectedQty?.toString() ?? '');
  const [boxLabels, setBoxLabels] = useSyncedState<string[]>(
    line.coversBoxLabels
  );

  const queries = skuSearchQueries(debounced);
  const search = useQuery({
    queryKey: ['inbound-shipment-sku-search', queries],
    queryFn: async () => {
      const results = await Promise.all(
        queries.map((q) => skusClient.getSkus({ ...q, limit: 20 }))
      );
      return results.flatMap((r) => r.items);
    },
    enabled: queries.length > 0,
  });
  const candidates = mergeSkuCandidates(line, search.data ?? []);

  const run = (body: EditInboundShipmentLineBody) => {
    setMessage(null);
    edit.mutate(
      { id: shipment.id, lineId: line.id, ...body },
      { onError: (e) => setMessage(writeErrorMessage(e)) }
    );
  };

  const qtyNumber = Number(qty);
  const qtyValid = isValidLineQty(qty);

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div className="flex flex-col gap-1">
        {RAW_LABELS.map(([key, label]) => {
          const cell = line.raw[key];
          if (!cell) return null;
          return (
            <div key={key} className="flex gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">
                {label}
              </span>
              <span className="break-all">
                {key === 'barcode' ? cellDisplayText(cell) : cell.text}
              </span>
              {cell.formula && (
                <span className="text-muted-foreground">={cell.formula}</span>
              )}
            </div>
          );
        })}
      </div>

      {!isDraft && (
        <div className="flex flex-col gap-1">
          <div>
            센 수량 합계 {line.countedQty}
            {line.expectedQty !== null ? ` / 예정 ${line.expectedQty}` : ''}
          </div>
          {shipment.boxes
            .filter((b) => line.coversBoxLabels.includes(b.label))
            .map((b) => (
              <div key={b.id} className="flex gap-2">
                <span className="w-24 shrink-0">{b.label}</span>
                <span className="text-muted-foreground">
                  {b.status === 'received' ? '받음' : '열림'}
                </span>
              </div>
            ))}
        </div>
      )}

      {line.issues.length > 0 && (
        <ul className="list-disc pl-4">
          {line.issues.map((c) => (
            <li key={c}>{issueLabel(c)}</li>
          ))}
        </ul>
      )}
      {!editability.editable && (
        <div className="text-muted-foreground">{editability.reason}</div>
      )}
      {message && <div className="text-destructive">{message}</div>}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="SKU 검색 (이름·코드·바코드)"
            aria-label="SKU 검색"
          />
          <Can run={useEditInboundShipmentLine}>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || edit.isPending}
              onClick={() => run({ kind: 'free' })}
            >
              자유 줄로
            </Button>
          </Can>
        </div>
        {search.isFetching && (
          <div className="text-muted-foreground">검색 중…</div>
        )}
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {candidates.map((c) => (
            <li
              key={c.skuId}
              className="flex items-center gap-2 rounded border px-2 py-1"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">{c.name}</div>
                <div className="truncate text-muted-foreground">
                  {c.code}
                  {c.hint ? ` · ${c.hint}` : ''}
                </div>
              </div>
              <Can run={useEditInboundShipmentLine}>
                <Button
                  size="sm"
                  disabled={
                    !canEdit || edit.isPending || line.skuId === c.skuId
                  }
                  onClick={() => run({ kind: 'sku', skuId: c.skuId })}
                >
                  이 SKU 로
                </Button>
              </Can>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">수량</span>
        <Input
          className="w-28"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label="수량"
        />
        <Can run={useEditInboundShipmentLine}>
          <Button
            size="sm"
            variant="outline"
            disabled={
              !canEdit ||
              !qtyValid ||
              qtyNumber === line.expectedQty ||
              edit.isPending
            }
            onClick={() => run({ expectedQty: qtyNumber })}
          >
            수량 저장
          </Button>
        </Can>
      </div>

      {isDraft && (
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground">덮는 상자</span>
          <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
            {shipment.boxes.map((b) => (
              <label key={b.id} className="flex items-center gap-1">
                <Checkbox
                  checked={boxLabels.includes(b.label)}
                  onCheckedChange={(v) =>
                    setBoxLabels(
                      v === true
                        ? [...boxLabels, b.label]
                        : boxLabels.filter((x) => x !== b.label)
                    )
                  }
                />
                {b.label}
              </label>
            ))}
          </div>
          <Can run={useEditInboundShipmentLine}>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={
                !canEdit ||
                edit.isPending ||
                sameSet(boxLabels, line.coversBoxLabels)
              }
              onClick={() => run({ boxLabels })}
            >
              상자 저장
            </Button>
          </Can>
        </div>
      )}
    </div>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
