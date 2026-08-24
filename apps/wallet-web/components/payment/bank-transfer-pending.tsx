'use client';

import { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Copy, Landmark, Lock } from 'lucide-react';
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
  const amount = formatAmount(pending.amount ?? fallbackAmount, pending.currency ?? fallbackCurrency);
  const accountNumber = pending.accountNumber ?? '';

  return (
    <div className="bg-muted/40 min-h-screen">
      <div className="bg-card border-b">
        <div className="flex items-center justify-center gap-1.5 py-2.5">
          <Lock className="text-muted-foreground h-3.5 w-3.5" />
        </div>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-41px)] max-w-md items-center px-4 py-8">
        <Card className="border-border/60 w-full border shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                <Landmark className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-bold">입금 계좌가 발급되었습니다</h1>
                <p className="text-muted-foreground text-sm break-keep">
                  아래 계좌로 입금하시면 확인 후 배송이 시작됩니다.
                </p>
              </div>
            </div>

            {/* 이 화면에서 할 일은 금액과 계좌번호를 은행 앱으로 옮기는 것 하나다. 둘만 키우고 복사를 붙인다. */}
            <div className="border-border/60 divide-border/60 divide-y rounded-lg border">
              <CopyRow label="입금 금액" value={amount} copyText={String(pending.amount ?? fallbackAmount)} />
              <CopyRow
                label={pending.bankName || '입금 계좌'}
                value={accountNumber || '-'}
                copyText={accountNumber}
                mono
              />
              <div className="text-muted-foreground flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span>예금주</span>
                <span className="text-foreground font-medium">{pending.accountHolder || '-'}</span>
              </div>
            </div>

            <ul className="bg-muted/50 text-muted-foreground space-y-1.5 rounded-md p-3 text-xs break-keep">
              <li>· 입금이 확인되면 자동으로 결제가 완료됩니다. 확인까지 시간이 걸릴 수 있어요.</li>
              <li>· 입금 기한(7일) 내 미입금 시 주문은 자동 취소됩니다.</li>
              <li>· 입금 후 취소·환불은 주문 내역에서 신청하실 수 있으며, 영업일 기준 약 2일 소요됩니다.</li>
            </ul>

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

function CopyRow({
  label,
  value,
  copyText,
  mono = false,
}: {
  label: string;
  value: string;
  copyText: string;
  mono?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const valueRef = useRef<HTMLParagraphElement>(null);

  const copy = async () => {
    if (!copyText) return;
    try {
      // 문서에 포커스가 없으면 writeText 가 resolve/reject 없이 매달린다(버튼이 죽은 것처럼 보인다).
      await Promise.race([
        navigator.clipboard.writeText(copyText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 700)),
      ]);
      setState('copied');
    } catch {
      // 클립보드 API 를 막아둔 브라우저·인앱웹뷰. 조용히 실패하면 버튼이 먹통으로 보이므로
      // 값을 선택 상태로 만들어 두고 직접 복사하도록 알린다.
      const el = valueRef.current;
      if (el) window.getSelection()?.selectAllChildren(el);
      setState('selected');
    }
    setTimeout(() => setState('idle'), 2500);
  };

  const copyLabel = state === 'copied' ? '복사됨' : state === 'selected' ? '직접 복사' : '복사';

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p
          ref={valueRef}
          className={`text-foreground text-lg font-bold break-all ${mono ? 'font-mono tracking-tight' : ''}`}
        >
          {value}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={copy}
        disabled={!copyText}
        aria-label={`${label} 복사`}
        className="text-muted-foreground hover:text-foreground shrink-0 gap-1.5"
      >
        {state === 'copied' ? <Check className="text-primary h-4 w-4" /> : <Copy className="h-4 w-4" />}
        <span className="text-xs">{copyLabel}</span>
      </Button>
    </div>
  );
}
