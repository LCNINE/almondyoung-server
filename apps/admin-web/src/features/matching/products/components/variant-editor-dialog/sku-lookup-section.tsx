'use client';

import { useState } from 'react';
import { Search, Trash2, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { useSkuSearch } from '@/lib/services/inventory';
import type { SkuLinkState } from '@/lib/types/ui/matching';

interface SkuLookupSectionProps {
  links: SkuLinkState[];
  onChange: (links: SkuLinkState[]) => void;
}

export function SkuLookupSection({ links, onChange }: SkuLookupSectionProps) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 350);
  const { data: results, isFetching } = useSkuSearch(debounced, 1, 30);

  const addLink = (sku: { id: string; name: string; code: string }) => {
    if (links.some((l) => l.skuId === sku.id)) return;
    onChange([
      ...links,
      { skuId: sku.id, skuName: sku.name, skuCode: sku.code, quantity: 1 },
    ]);
    setSearch('');
  };

  const removeLink = (skuId: string) => {
    onChange(links.filter((l) => l.skuId !== skuId));
  };

  const updateQty = (skuId: string, qty: number) => {
    onChange(links.map((l) => (l.skuId === skuId ? { ...l, quantity: qty } : l)));
  };

  const items = results?.items ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-muted-foreground">SKU 매핑</p>
        {links.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            재고 {links.length}종 연결됨
          </span>
        )}
      </div>

      {links.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          연결된 재고가 없습니다. 아래에서 검색해 추가하세요.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <div key={link.skuId} className="rounded-md border">
              <div className="flex items-start gap-2 px-3 pt-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug break-words">
                    {link.skuName ?? (
                      <span className="font-mono text-xs">{link.skuId}</span>
                    )}
                  </p>
                  {link.skuCode && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {link.skuCode}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="재고 연결 해제"
                  className="-mr-1 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLink(link.skuId)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
                <span>이 옵션 1개 팔리면</span>
                <Input
                  type="number"
                  min={1}
                  value={link.quantity}
                  onChange={(e) => updateQty(link.skuId, Number(e.target.value) || 1)}
                  className="h-7 w-14 text-center text-xs"
                />
                <span>개 차감</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="재고 이름 또는 SKU 코드로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-8 text-xs"
        />
        {isFetching && (
          <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {debounced && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          {items.map((sku) => {
            const linked = links.some((l) => l.skuId === sku.id);
            return (
              <button
                key={sku.id}
                type="button"
                onClick={() => addLink(sku)}
                disabled={linked}
                className="flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-snug break-words">
                    {sku.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                    {sku.code}
                  </span>
                </span>
                {linked ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    연결됨
                  </span>
                ) : (
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            );
          })}
          {!isFetching && items.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              검색 결과가 없습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
