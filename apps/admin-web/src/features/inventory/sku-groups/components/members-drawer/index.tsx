'use client';

import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useSkuGroupMembers, useRemoveSkuFromGroup } from '@/lib/services/inventory';
import type { SkuGroupResponseDto } from '@/lib/types/dto/inventory';

type Props = {
  group: SkuGroupResponseDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MembersDrawer({ group, open, onOpenChange }: Props) {
  const { data: membersData, isLoading } = useSkuGroupMembers(group?.id ?? '');
  const removeMutation = useRemoveSkuFromGroup();

  if (!group) return null;

  const members = membersData?.members ?? [];

  const handleRemove = async (skuId: string, skuName: string) => {
    try {
      await removeMutation.mutateAsync({ skuId, groupId: group.id });
      toast.success(`${skuName} 이(가) 그룹에서 제거되었습니다.`);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '제거에 실패했습니다.';
      toast.error(msg);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {group.name}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({membersData?.totalMembers ?? 0}개 SKU)
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-1">
          {isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
          )}
          {!isLoading && members.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              소속 SKU가 없습니다.
            </p>
          )}
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{m.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{m.code}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(m.id, m.name)}
                disabled={removeMutation.isPending}
                aria-label="그룹에서 제거"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
