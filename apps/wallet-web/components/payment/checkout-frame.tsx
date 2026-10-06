'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  orderName: string;
  originalPrice: string;
  finalPrice: string;
  discounted: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export function CheckoutFrame({ orderName, originalPrice, finalPrice, discounted, onClose, children, footer }: Props) {
  return (
    <div className="min-h-dvh bg-white pb-[calc(11rem+env(safe-area-inset-bottom))] text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-white">
        <div className="mx-auto flex h-16 max-w-[560px] items-center justify-between px-5">
          <h1 className="text-xl font-bold tracking-tight">주문/결제</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="결제 화면 닫기"
            className="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <X className="size-6" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[560px] space-y-7 px-4 py-6 sm:px-6">
        <section className="flex items-end justify-between gap-6 px-1 pb-1" aria-label="주문 요약">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">아몬드영</p>
            <p className="mt-2 max-w-[220px] text-sm font-medium leading-relaxed">{orderName}</p>
          </div>
          <div aria-live="polite" className="shrink-0 text-right tabular-nums">
            {discounted && <del className="block text-sm text-muted-foreground">{originalPrice}</del>}
            <p className="text-[24px] font-bold tracking-tight">{finalPrice}</p>
          </div>
        </section>
        {children}
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border/40 bg-white pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-4px_20px_rgba(0,0,0,0.025)]">
        <div className="mx-auto max-w-[560px] space-y-3 px-5 sm:px-6">{footer}</div>
      </footer>
    </div>
  );
}
