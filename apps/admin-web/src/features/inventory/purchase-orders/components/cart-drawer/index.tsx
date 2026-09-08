'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  usePurchaseOrderCart,
  useRemoveCartItem,
  useUpdateCartItem,
  useClearCart,
} from '@/lib/services/inventory';
import type { CartItemDto } from '@/lib/types/dto/inventory';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FinalizeFromCartDialog } from '../finalize-from-cart-dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CartDrawer({ open, onOpenChange }: Props) {
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: cart, isLoading: cartLoading } = usePurchaseOrderCart();

  const removeMutation = useRemoveCartItem();
  const updateMutation = useUpdateCartItem();
  const clearMutation = useClearCart();

  const cartItems = cart ?? [];

  const handleRemove = async (id: string) => {
    try {
      await removeMutation.mutateAsync(id);
    } catch {
      toast.error('항목 삭제에 실패했습니다.');
    }
  };

  const handleQuantityChange = async (item: CartItemDto, quantity: number) => {
    if (quantity < 1) return;
    try {
      await updateMutation.mutateAsync({ itemId: item.id, data: { quantity } });
    } catch {
      toast.error('수량 수정에 실패했습니다.');
    }
  };

  const handleClear = async () => {
    if (cartItems.length === 0) return;
    try {
      await clearMutation.mutateAsync(undefined);
      setSelectedIds([]);
    } catch {
      toast.error('카트 비우기에 실패했습니다.');
    }
  };

  const openFinalize = () => {
    const ids = selectedIds.length > 0 ? selectedIds : cartItems.map((i) => i.id);
    if (ids.length === 0) { toast.error('카트가 비어있습니다.'); return; }
    setSelectedIds(ids);
    setFinalizeOpen(true);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[480px] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>
              발주 카트 {cartItems.length > 0 && <Badge className="ml-1.5">{cartItems.length}</Badge>}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-3">
            {cartLoading ? (
              <p className="text-sm text-muted-foreground">로딩 중...</p>
            ) : cartItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">카트가 비어있습니다.</p>
            ) : (
              <>
                {cartItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{item.sku.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.type === 'domestic' ? '국내' : '해외'}
                        {item.supplier && ` · ${item.supplier.name}`}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => handleQuantityChange(item, Number(e.target.value))}
                      className="w-16 text-center"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemove(item.id)}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}

                <div className="flex items-center justify-between pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleClear}
                    disabled={clearMutation.isPending}
                  >
                    전체 비우기
                  </Button>
                  <Button size="sm" onClick={openFinalize}>
                    발주 생성
                  </Button>
                </div>
              </>
            )}

            <p className="text-xs text-muted-foreground">
              재발주 추천은 <Link href="/inventory/replenishment" className="underline">보충 제안</Link> 페이지로 옮겼습니다.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <FinalizeFromCartDialog
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        cartItemIds={selectedIds}
      />
    </>
  );
}
