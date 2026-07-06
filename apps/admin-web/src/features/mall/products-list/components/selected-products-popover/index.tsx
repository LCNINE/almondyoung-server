'use client';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { X, ImageOff } from 'lucide-react';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import type { SelectedProductSnapshot } from '../table/products-list-selection-model';

type Props = {
  items: SelectedProductSnapshot[];
  count: number;
  onRemove: (masterId: string) => void;
  onClearAll: () => void;
};

export function SelectedProductsPopover({
  items,
  count,
  onRemove,
  onClearAll,
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-sm text-muted-foreground whitespace-nowrap"
        >
          {count}개 선택됨
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-medium">
            선택한 상품 {items.length}개
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={onClearAll}
          >
            전체 해제
          </Button>
        </div>
        <ul className="p-2 space-y-1 overflow-y-auto max-h-72">
          {items.map((item) => {
            const src = resolvePublicFileUrl(item.thumbnail);
            return (
              <li
                key={item.masterId}
                className="flex items-center gap-2 p-1 rounded hover:bg-muted"
              >
                <div className="w-8 h-8 overflow-hidden rounded shrink-0 bg-muted">
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full text-muted-foreground">
                      <ImageOff className="w-3 h-3" />
                    </div>
                  )}
                </div>
                <span className="flex-1 text-xs truncate" title={item.name}>
                  {item.name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-6 h-6 p-0 shrink-0"
                  onClick={() => onRemove(item.masterId)}
                  aria-label="선택 해제"
                >
                  <X className="w-3 h-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
