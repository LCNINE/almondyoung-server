'use client';

import { useState } from 'react';
import { RestockPolicySection } from '@/features/mall/products-detail/components/variants/restock-policy-section';
import type { StockPolicyDto } from '@/lib/types/dto/matching';
import { Button } from '@/components/ui/button';

const initial: StockPolicyDto = {
  preStockSellable: false,
  alwaysSellableZeroStock: false,
  availabilityOverride: null,
  comingSoonDate: null,
  restockDate: null,
  restockApproximate: false,
};

export function RestockPreview() {
  const [policy, setPolicy] = useState(initial);
  const [saved, setSaved] = useState(false);

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 p-6">
      <header className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          상품 상세 → 품목 · 로컬 UI 미리보기
        </p>
        <h1 className="text-xl font-semibold">재입고 예정일 설정</h1>
        <p className="text-sm text-muted-foreground">
          아래 화면은 실제 편집 컴포넌트입니다. 미리보기에서는 서버 데이터가
          변경되지 않습니다.
        </p>
      </header>

      <RestockPolicySection
        value={policy}
        onChange={(next) => {
          setPolicy(next);
          setSaved(false);
        }}
      />
      <div className="flex items-center justify-end gap-3 border-t pt-4">
        {saved && (
          <p role="status" className="text-sm text-green-700">
            입력 상태 확인 완료
          </p>
        )}
        <Button onClick={() => setSaved(true)}>입력 상태 확인</Button>
      </div>
    </main>
  );
}
