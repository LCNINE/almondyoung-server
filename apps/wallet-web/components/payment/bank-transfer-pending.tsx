'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Landmark, Lock } from 'lucide-react';
import { formatAmount, type BankTransferPendingAction } from './utils';

interface Props {
  pending: BankTransferPendingAction;
  /** pending.amount 가 없을 때 쓸 화면상 결제 예정액. */
  fallbackAmount: number;
  fallbackCurrency: string;
  orderListUrl: string | null;
  onRefresh: () => void;
}

export function BankTransferPending({
  pending,
  fallbackAmount,
  fallbackCurrency,
  orderListUrl,
  onRefresh,
}: Props) {
  return (
    <div className="min-h-screen bg-muted/40">
      <div className="border-b bg-card">
        <div className="flex items-center justify-center gap-1.5 py-2.5">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-41px)] max-w-md items-center px-4 py-8">
        <Card className="w-full border shadow-sm border-border/60">
          <CardContent className="p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center rounded-full h-11 w-11 shrink-0 bg-primary/10 text-primary">
                <Landmark className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-bold">주문이 접수되었습니다</h1>
                <p className="text-sm text-muted-foreground">
                  주문이 &lsquo;입금확인중&rsquo; 상태로 접수되었어요. 아래 계좌로 입금하시면 입금 확인 후 배송이
                  진행됩니다. 입금 확인 후 자동 확인까지 시간이 소요될 수 있어요.
                </p>
              </div>
            </div>

            <Separator />

            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">입금 금액</dt>
                <dd className="font-bold">
                  {formatAmount(pending.amount ?? fallbackAmount, pending.currency ?? fallbackCurrency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">은행</dt>
                <dd className="font-medium text-right">{pending.bankName || '-'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">계좌번호</dt>
                <dd className="font-mono font-medium text-right">{pending.accountNumber || '-'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">예금주</dt>
                <dd className="font-medium text-right">{pending.accountHolder || '-'}</dd>
              </div>
            </dl>

            <Alert className="break-keep">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="break-keep">
                주문이 이미 <span className="font-medium">‘입금확인중’</span> 상태로 접수되어, 지금 바로 아래{' '}
                <span className="font-medium">‘주문 내역에서 확인’</span> 버튼으로 확인하실 수 있어요. 입금이 확인되면
                자동으로 결제가 완료됩니다.
              </AlertDescription>
            </Alert>

            <div className="p-3 space-y-1 text-xs rounded-md bg-muted/50 text-muted-foreground break-keep">
              <p>· 입금 기한(7일) 내 미입금 시 주문은 자동 취소됩니다.</p>
              <p>· 입금 후 취소·환불은 주문 내역에서 직접 신청하실 수 있으며, 영업일 기준 약 2일 소요됩니다.</p>
            </div>

            <div className="space-y-2">
              {orderListUrl && (
                <Button
                  className="w-full"
                  onClick={() => {
                    window.location.href = orderListUrl;
                  }}
                >
                  주문 내역에서 확인
                </Button>
              )}
              <Button variant="outline" className="w-full" onClick={onRefresh}>
                결제 상태 새로고침
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
