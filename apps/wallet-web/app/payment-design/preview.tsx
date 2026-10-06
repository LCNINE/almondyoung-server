'use client';

import { useState } from 'react';
import { CardCheckout, type CheckoutCard } from '@/components/payment/card-checkout';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const SAMPLE_CARDS: CheckoutCard[] = [
  {
    id: 'preview-debit',
    name: '카카오뱅크 체크카드',
    number: '1234',
    type: '체크',
    color: '#a1bbca',
  },
];

export function PaymentDesignPreview() {
  const [cards, setCards] = useState(SAMPLE_CARDS);
  const [dialog, setDialog] = useState<'register' | 'settings' | 'pay' | null>(null);

  return (
    <>
      <div className="fixed right-16 top-[22px] z-40 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
        UI 미리보기
      </div>
      <CardCheckout
        orderName="[캔바] SMP 시술동의서"
        amount={12300}
        availablePoints={5000}
        cards={cards}
        onRegister={() => setDialog('register')}
        onSettings={() => setDialog('settings')}
        onClose={() => window.history.back()}
        onPay={() => setDialog('pay')}
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          className={
            dialog === 'register'
              ? 'top-auto bottom-0 w-full max-w-[560px] translate-y-0 gap-6 rounded-b-none rounded-t-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]'
              : 'gap-5 rounded-xl p-6'
          }
        >
          <DialogTitle className="text-lg font-bold">
            {dialog === 'register' ? '카드 등록' : dialog === 'settings' ? '카드 관리' : '결제 화면 미리보기'}
          </DialogTitle>
          <DialogDescription className={dialog === 'register' ? 'sr-only' : undefined}>
            {dialog === 'register'
              ? '카드 등록 화면 UI 미리보기'
              : dialog === 'settings'
                ? '미리보기 카드로 등록된 상태와 빈 상태를 확인해보세요.'
                : '현재는 UI 미리보기입니다. 결제 요청이나 주문 생성은 하지 않습니다.'}
          </DialogDescription>
          {dialog === 'register' && (
            <>
              <div className="space-y-5">
                <label className="block text-sm">
                  카드번호
                  <input
                    readOnly
                    placeholder="0000 0000 0000 0000"
                    className="mt-2 h-12 w-full border-b border-border bg-transparent text-lg outline-none"
                  />
                </label>
                <div className="grid grid-cols-2 gap-5">
                  <label className="block text-sm">
                    유효기간
                    <input
                      readOnly
                      placeholder="MM / YY"
                      className="mt-2 h-12 w-full border-b border-border bg-transparent text-lg outline-none"
                    />
                  </label>
                  <label className="block text-sm">
                    CVC
                    <input
                      readOnly
                      placeholder="3자리"
                      className="mt-2 h-12 w-full border-b border-border bg-transparent text-lg outline-none"
                    />
                  </label>
                </div>
              </div>
              <Button
                className="mt-3 h-14 rounded-xl text-base font-bold"
                onClick={() => {
                  setCards(SAMPLE_CARDS);
                  setDialog(null);
                }}
              >
                등록
              </Button>
            </>
          )}
          {dialog === 'settings' && (
            <div className="grid gap-2">
              <Button
                className="h-12"
                onClick={() => {
                  setCards([]);
                  setDialog(null);
                }}
              >
                카드 없는 상태 보기
              </Button>
              <Button
                variant="outline"
                className="h-12"
                onClick={() => {
                  setCards(SAMPLE_CARDS);
                  setDialog(null);
                }}
              >
                등록된 카드 상태 보기
              </Button>
            </div>
          )}
          {dialog === 'pay' && (
            <Button className="h-12" onClick={() => setDialog(null)}>
              확인
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
