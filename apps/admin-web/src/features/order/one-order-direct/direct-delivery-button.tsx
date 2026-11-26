'use client';

import { useState } from 'react';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { useDirectDeliveryTakeover } from '@/lib/services/orders/direct-delivery';
import { DirectDeliveryDialog } from './direct-delivery-dialog';

type TriggerProps = {
  shipmentId: string;
  orderText: string;
  disabled?: boolean;
  label?: string;
};

/** 행 기능 칸의 «공급처 직배송» — 누르면 창이 상자를 새로 읽고 맡기기·송장·되돌리기를 고른다. */
export function DirectDeliveryButton(props: TriggerProps) {
  return (
    <Can run={useDirectDeliveryTakeover}>
      <DirectDeliveryTrigger {...props} />
    </Can>
  );
}

/** 권한 판정을 부르는 쪽이 이미 한 곳(상자 상세 작업 버튼 줄)에서 쓴다. */
export function DirectDeliveryTrigger({
  shipmentId,
  orderText,
  disabled,
  label = '공급처 직배송',
}: TriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open && (
        <DirectDeliveryDialog
          shipmentId={shipmentId}
          orderText={orderText}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
