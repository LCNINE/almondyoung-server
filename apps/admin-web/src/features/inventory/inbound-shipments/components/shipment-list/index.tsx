'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useInboundShipments } from '@/lib/services/inventory/inbound-shipment-queries';
import { useUploadInboundShipment } from '@/lib/services/inventory/inbound-shipment-mutations';
import { useWarehouses } from '@/lib/services/inventory/queries';
import type { InboundShipmentStatus } from '@/lib/types/dto/inbound-shipment';
import { SHIPMENT_STATUS_LABEL } from '../../lib/shipment-rules';
import { UploadDialog } from '../upload-dialog';

const TABS = {
  active: {
    label: '진행 중',
    status: ['draft', 'expected', 'receiving'] as InboundShipmentStatus[],
  },
  closed: { label: '끝남', status: ['closed'] as InboundShipmentStatus[] },
  canceled: { label: '취소', status: ['canceled'] as InboundShipmentStatus[] },
};
type TabKey = keyof typeof TABS;

const ALL = '__all__';

export function ShipmentList() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('active');
  const [warehouseId, setWarehouseId] = useState(ALL);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: warehouses = [] } = useWarehouses();
  const { data, isLoading } = useInboundShipments({
    status: TABS[tab].status,
    ...(warehouseId !== ALL ? { warehouseId } : {}),
  });
  const rows = data ?? [];

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            {(Object.keys(TABS) as TabKey[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {TABS[key].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {warehouses.length > 1 && (
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>전체 창고</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Can run={useUploadInboundShipment}>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              입고리스트 올리기
            </Button>
          </Can>
        </div>
      </div>

      <div className="px-4 py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">상자</TableHead>
              <TableHead className="text-right">줄</TableHead>
              <TableHead>도착 예정일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  {isLoading ? '불러오는 중…' : '선적이 없습니다.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(`/inventory/inbound-shipments/${row.id}`)
                  }
                >
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{SHIPMENT_STATUS_LABEL[row.status]}</TableCell>
                  <TableCell className="text-right">{row.boxCount}</TableCell>
                  <TableCell className="text-right">{row.lineCount}</TableCell>
                  <TableCell>{row.expectedArrival ?? ''}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </>
  );
}
