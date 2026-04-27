'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  usePurchaseOrderCart,
  useReorderSuggestions,
  useRemoveCartItem,
  useUpdateCartItem,
  useClearCart,
  useAddToCart,
  useWarehouses,
} from '@/lib/services/inventory';
import type { CartItemDto } from '@/lib/types/dto/inventory';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { FinalizeFromCartDialog } from '../finalize-from-cart-dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CartDrawer({ open, onOpenChange }: Props) {
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reorderWarehouseId, setReorderWarehouseId] = useState('');

  const { data: cart, isLoading: cartLoading } = usePurchaseOrderCart();
  const { data: warehouses } = useWarehouses();
  const { data: suggestions, isLoading: suggestionsLoading } = useReorderSuggestions(reorderWarehouseId || undefined);

  const removeMutation = useRemoveCartItem();
  const updateMutation = useUpdateCartItem();
  const clearMutation = useClearCart();
  const addToCartMutation = useAddToCart();

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

  const handleAddSuggestionToCart = async (skuId: string, skuName: string, quantity: number) => {
    try {
      await addToCartMutation.mutateAsync({
        skuId,
        quantity,
        type: 'domestic',
      });
      toast.success(`${skuName}이(가) 카트에 추가되었습니다.`);
    } catch {
      toast.error('카트 추가에 실패했습니다.');
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
            <SheetTitle>발주 카트</SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="cart">
            <TabsList className="w-full">
              <TabsTrigger value="cart" className="flex-1">
                카트 {cartItems.length > 0 && <Badge className="ml-1.5">{cartItems.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="reorder" className="flex-1">
                재발주 추천
              </TabsTrigger>
            </TabsList>

            {/* 카트 탭 */}
            <TabsContent value="cart" className="mt-4 space-y-3">
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
            </TabsContent>

            {/* 재발주 추천 탭 */}
            <TabsContent value="reorder" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Select value={reorderWarehouseId} onValueChange={setReorderWarehouseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="창고 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {(warehouses ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!reorderWarehouseId ? (
                <p className="text-sm text-muted-foreground">창고를 선택하면 재발주 추천 목록이 표시됩니다.</p>
              ) : suggestionsLoading ? (
                <p className="text-sm text-muted-foreground">로딩 중...</p>
              ) : !suggestions || suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground">재발주 추천 항목이 없습니다.</p>
              ) : (
                suggestions.map((item) => (
                  <div key={item.skuId} className="flex items-center gap-3 rounded-md border p-3">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{item.skuName}</p>
                      <p className="text-xs text-muted-foreground">
                        현재 {item.currentStock} / 안전재고 {item.safetyStock} · 부족 {item.shortfall}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleAddSuggestionToCart(item.skuId, item.skuName, item.suggestedOrder)
                      }
                      disabled={addToCartMutation.isPending}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      카트
                    </Button>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
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
