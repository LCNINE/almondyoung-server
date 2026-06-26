'use client';

import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { usePaymentIntentDetail } from '@/lib/services/wallet';
import { UserDetailGeneralContent } from '@/app/(admin)/users/[id]/user-detail-general';
import type { PaymentIntentItemDto } from '@/lib/types/dto/wallet';

/**
 * 무통장입금 건 상세 보기.
 * 입금 확인 전에 관리자가 (1) 고객 정보(로그인 ID/이름/이메일)와 (2) 그 건의 주문 항목을
 * 리스트를 벗어나지 않고 바로 확인할 수 있게 한다. 행 클릭(상세 페이지 이동)과 충돌하지 않도록
 * 클릭 이벤트 전파를 막는다.
 */
function OrderItems({ intentId }: { intentId: string }) {
  const { data } = usePaymentIntentDetail(intentId);

  if (!data.items.length) {
    return <p className="text-sm text-muted-foreground">주문 항목 없음</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 font-medium">상품명</th>
          <th className="py-1 text-right font-medium">수량</th>
          <th className="py-1 text-right font-medium">금액</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((item: PaymentIntentItemDto) => (
          <tr key={item.id} className="border-t">
            <td className="py-1.5">{item.name}</td>
            <td className="py-1.5 text-right tabular-nums">{item.quantity}</td>
            <td className="py-1.5 text-right tabular-nums">
              {item.payableAmount.toLocaleString('ko-KR')}원
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Props = {
  id: string;
  userId: string | null;
};

export function BankTransferDetailCell({ id, userId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        상세
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>무통장입금 상세</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="max-h-[70vh] space-y-4 overflow-y-auto">
              {userId && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">고객 정보</h3>
                  <Suspense
                    fallback={
                      <div className="flex justify-center p-2">
                        <Spinner />
                      </div>
                    }
                  >
                    <UserDetailGeneralContent userId={userId} />
                  </Suspense>
                </section>
              )}
              <section>
                <h3 className="mb-1 text-sm font-semibold">주문 항목</h3>
                <Suspense
                  fallback={
                    <div className="flex justify-center p-2">
                      <Spinner />
                    </div>
                  }
                >
                  <OrderItems intentId={id} />
                </Suspense>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
