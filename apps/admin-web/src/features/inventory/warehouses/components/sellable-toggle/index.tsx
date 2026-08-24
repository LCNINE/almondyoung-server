'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { parseServerError } from '@/lib/api/server-error';
import { useUpdateWarehouse } from '@/lib/services/inventory';
import type { WarehouseDto } from '@/lib/types/dto/inventory';

type Props = {
  warehouse: WarehouseDto;
};

/**
 * 창고의 판매 여부 스위치.
 *
 * 끄는 방향만 확인을 받는다 — 켜는 건 재고가 더 보이는 쪽이라 되돌리기 쉽지만, 끄는 건
 * 그 창고 재고가 즉시 판매가능수량에서 빠져 storefront 가 품절로 바뀐다.
 * 마지막 판매 창고를 끄는 요청은 서버가 409 로 막으므로, 그 메시지를 그대로 보여준다.
 */
export function SellableToggle({ warehouse }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useUpdateWarehouse();

  const apply = async (isSellable: boolean) => {
    try {
      await mutation.mutateAsync({ id: warehouse.id, data: { isSellable } });
      toast.success(
        isSellable
          ? `${warehouse.name} 을(를) 판매 창고로 지정했습니다.`
          : `${warehouse.name} 을(를) 비판매 창고로 바꿨습니다.`
      );
    } catch (error) {
      // getServerDenyMessage 를 쓰지 않는다 — 409 에 "다른 작업으로 상태가 변경되어"
      // 를 붙이는데, 이 가드의 409 는 경합이 아니라 검증 거부라 그 문구가 오해를 만든다.
      // 서버 메시지가 이미 무엇을 해야 하는지 말한다.
      toast.error(parseServerError(error, '판매 여부를 바꾸지 못했습니다.').message);
    }
  };

  const handleChange = (next: boolean) => {
    if (next) {
      void apply(true);
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <>
      <Switch
        checked={warehouse.isSellable}
        onCheckedChange={handleChange}
        disabled={mutation.isPending}
        aria-label={`${warehouse.name} 판매 창고 여부`}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{warehouse.name} 을(를) 비판매 창고로 바꿉니다</AlertDialogTitle>
            <AlertDialogDescription>
              이 창고의 재고가 storefront 판매가능수량에서 즉시 빠집니다. 이 창고에만 재고가 있는
              상품은 품절로 표시됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void apply(false)}>비판매로 바꾸기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
