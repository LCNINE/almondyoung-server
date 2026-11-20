'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils/ui';
import { productQueryKeys } from '@/lib/services/products/query-keys';
import { VariantMatchingPanel } from '@/features/matching/products/components/variant-editor-dialog';
import type { MasterSummaryDto } from '@/lib/types/dto/products';

export function ProductsListMatchingDrawer({
  master,
  onOpenChange,
}: {
  master: MasterSummaryDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const variants = master?.variantPreviews ?? [];
  const [variantId, setVariantId] = useState<string | null>(null);

  useEffect(() => {
    const first = variants.find((v) => v.skuLinkState === 'unlinked') ?? variants[0];

    setVariantId(first?.variantId ?? null);
    // 창을 열 때만 고른다 — 저장 뒤 목록이 갱신돼도 보던 옵션을 바꾸지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master?.masterId]);

  const selected = variants.find((v) => v.variantId === variantId);
  const beyondPreview = (master?.variantCount ?? 0) - variants.length;

  return (
    <Drawer open={master !== null} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="sm:max-w-xl">
        <DrawerHeader>
          <DrawerTitle>매칭 편집</DrawerTitle>
          <DrawerDescription>{master?.name}</DrawerDescription>
        </DrawerHeader>

        {variants.length > 1 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
            {variants.map((v) => (
              <button
                key={v.variantId}
                type="button"
                onClick={() => setVariantId(v.variantId)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  v.variantId === variantId
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                  v.skuLinkState === 'unlinked' &&
                    v.variantId !== variantId &&
                    'border-[#fecaca] text-[#b91c1c]'
                )}
              >
                {v.name || '이름 없음'}
              </button>
            ))}
            {beyondPreview > 0 && (
              <span className="self-center text-xs text-muted-foreground">
                외 {beyondPreview}개는 상품 상세에서 매칭해요
              </span>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0 px-4 pb-4 [&>[data-slot=scroll-area-viewport]>div]:!block">
          {master && selected && (
            <VariantMatchingPanel
              key={selected.variantId}
              variantId={selected.variantId}
              variantName={selected.name || master.name}
              masterId={master.masterId}
              onSaved={() =>
                queryClient.invalidateQueries({
                  queryKey: productQueryKeys.mastersSummaryLists(),
                })
              }
            />
          )}
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
