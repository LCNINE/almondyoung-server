import { useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { SkuStockCard } from './SkuStockCard';
import { useSkuDetail } from './useSkuDetail';

const TITLE = '상품 재고 상세';

export function SkuDetailScreen({ skuId }: { skuId: string }) {
  const detail = useSkuDetail(skuId);
  const [labelOpen, setLabelOpen] = useState(true);

  if (detail.isError) {
    return (
      <div className="space-y-4">
        <ScreenHeader title={TITLE} backTo="/inventory" />
        <p role="alert" className="text-sm text-[#aa4037]">
          {errorMessage(detail.error)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title={TITLE} backTo="/inventory" />
      <div className="mx-auto max-w-xl">
        <SkuStockCard
          skuId={skuId}
          labelOpen={labelOpen}
          onToggleLabel={() => setLabelOpen((open) => !open)}
        />
      </div>
    </div>
  );
}
