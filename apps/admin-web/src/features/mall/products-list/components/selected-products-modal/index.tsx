'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X, ImageOff } from 'lucide-react';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { ShortId } from '@/components/admin-ui-experimental/common/copy/short-id';
import type { SelectedProductSnapshot } from '../table/products-list-selection-model';

type Props = {
  items: SelectedProductSnapshot[];
  count: number;
  onRemove: (masterId: string) => void;
  onClearAll: () => void;
};

export function SelectedProductsModal({
  items,
  count,
  onRemove,
  onClearAll,
}: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-sm text-muted-foreground whitespace-nowrap"
        >
          {count}개 선택됨
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>선택한 상품 {items.length}개</DialogTitle>
        </DialogHeader>
        <ul className="space-y-1 overflow-y-auto max-h-[60vh]">
          {items.map((item) => {
            const src = resolvePublicFileUrl(item.thumbnail);
            return (
              <li
                key={item.masterId}
                className="flex items-center gap-3 p-2 rounded hover:bg-muted"
              >
                <div className="w-10 h-10 overflow-hidden rounded shrink-0 bg-muted">
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full text-muted-foreground">
                      <ImageOff className="w-4 h-4" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                  <span className="text-sm truncate" title={item.name}>
                    {item.name}
                  </span>
                  <ShortId value={item.masterId} />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="p-0 w-7 h-7 shrink-0"
                  onClick={() => onRemove(item.masterId)}
                  aria-label="선택 해제"
                >
                  <X className="w-4 h-4" />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end pt-2 border-t">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground"
            onClick={onClearAll}
          >
            전체 해제
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
