'use client';

import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function SellPolicyInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="선판매·항상 판매 차이 보기"
          className="inline-flex text-muted-foreground hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-2 text-xs leading-relaxed"
        onClick={(event) => event.stopPropagation()}
      >
        <p>
          <b>선판매</b> — 재고가 있으면 재고에서 빼며 팔고, 재고가 없어도
          주문을 받아요.
        </p>
        <p>
          <b>항상 판매</b> — 재고를 세지 않고 늘 판매해요. (직배·신상품용)
        </p>
        <p className="text-muted-foreground">
          고객 화면에서는 둘 다 품절로 보이지 않아요. 출시 예정을 같이 걸면,
          항상 판매는 입고돼도 출시 예정이 자동으로 풀리지 않을 수 있어요.
        </p>
      </PopoverContent>
    </Popover>
  );
}
