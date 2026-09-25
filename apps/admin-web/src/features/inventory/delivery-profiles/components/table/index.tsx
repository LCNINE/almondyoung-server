'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDeliveryProfiles } from '@/lib/services/inventory';
import type { DeliveryProfileDto, DeliveryProfileSourceType, FulfillmentMode } from '@/lib/types/dto/inventory';
import { ProfileDialog } from '../profile-dialog';

export const SOURCE_TYPE_LABELS: Record<DeliveryProfileSourceType, string> = {
  in_house: '자사 창고',
  direct: '직배송',
  overseas: '해외',
};

export const FULFILLMENT_MODE_LABELS: Record<FulfillmentMode, string> = {
  in_house: '자사 출고',
  '3pl': '3PL',
  drop_ship: '위탁 직배송',
};

export function DeliveryProfilesTable() {
  const { data: profiles = [], isLoading } = useDeliveryProfiles();
  // null = 닫힘, 'new' = 생성, 객체 = 수정
  const [editing, setEditing] = useState<DeliveryProfileDto | 'new' | null>(null);

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          새 프로필
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>원천</TableHead>
            <TableHead>발송인</TableHead>
            <TableHead>출고지</TableHead>
            <TableHead>택배 계약번호</TableHead>
            <TableHead>이행 방식</TableHead>
            <TableHead className="text-right">사용 SKU</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={8}>불러오는 중...</TableCell>
            </TableRow>
          )}
          {!isLoading && profiles.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                등록된 배송 프로필이 없습니다 — 사입·위탁 SKU 생성과 매칭 「자동」 탭이 막혀 있습니다.
              </TableCell>
            </TableRow>
          )}
          {profiles.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell>{SOURCE_TYPE_LABELS[p.sourceType] ?? p.sourceType}</TableCell>
              <TableCell>
                {p.sender.name || '-'} <span className="text-muted-foreground text-xs">{p.sender.phone}</span>
              </TableCell>
              <TableCell>{p.originAddress.roadAddress || '-'}</TableCell>
              <TableCell>{p.carrierAccountRef || '-'}</TableCell>
              <TableCell>{p.supportedFulfillmentModes.map((m) => FULFILLMENT_MODE_LABELS[m] ?? m).join(', ')}</TableCell>
              <TableCell className="text-right">{p.skuCount ?? 0}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                  수정
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ProfileDialog
        open={editing !== null}
        profile={editing === 'new' ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}
