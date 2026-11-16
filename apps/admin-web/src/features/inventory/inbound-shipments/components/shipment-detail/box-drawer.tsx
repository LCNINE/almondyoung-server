'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useInboundShipmentBox } from '@/lib/services/inventory/inbound-shipment-queries';
import { boxDrawerRows } from '../../lib/box-drawer';

const STATE_LABEL = { open: '열림', received: '받음', forward: '전달용' };

export function BoxDrawer({
  shipmentId,
  boxId,
  onClose,
}: {
  shipmentId: string;
  boxId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useInboundShipmentBox(
    shipmentId,
    boxId ?? undefined
  );
  const rows = data ? boxDrawerRows(data) : null;
  return (
    <Sheet open={boxId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[560px] overflow-y-auto sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{rows ? rows.header.title : ''}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-4 text-sm">
          {!rows && (
            <div className="text-muted-foreground">
              {isLoading ? '불러오는 중…' : '상자를 불러오지 못했습니다.'}
            </div>
          )}
          {rows && (
            <>
              <div className="flex gap-2">
                <span>{STATE_LABEL[rows.header.state]}</span>
                {rows.header.receivedAt && (
                  <span className="text-muted-foreground">
                    {new Date(rows.header.receivedAt).toLocaleString('ko-KR')}
                  </span>
                )}
              </div>
              {rows.forwardNote !== null && <div>{rows.forwardNote}</div>}
              {rows.lines.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {rows.lines.map((l) => (
                    <li
                      key={l.lineId}
                      className="flex items-center gap-2 rounded border px-2 py-1"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{l.product}</div>
                        {l.sku && (
                          <div className="truncate text-muted-foreground">
                            {l.sku}
                          </div>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        예정 {l.expected}
                      </span>
                      {l.counted !== null && (
                        <span className="flex items-center gap-1">
                          <b>{l.counted}</b>
                          {l.method === 'list' && (
                            <span className="text-xs text-muted-foreground">
                              리스트대로
                            </span>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {rows.unplanned.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">
                    리스트에 없던 물건
                  </span>
                  {rows.unplanned.map((u) => (
                    <div key={u.skuCode} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {u.skuName}
                      </span>
                      <span className="text-muted-foreground">
                        {u.skuCode}
                      </span>
                      <b>{u.counted}</b>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
