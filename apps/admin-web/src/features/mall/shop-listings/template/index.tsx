'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDeleteShopListing, useShopListings } from '@/lib/services/products';
import {
  SHOP_LISTING_REGION_LABELS,
  type ShopListingDto,
} from '@/lib/types/dto/products';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

export default function ShopListingsTemplate() {
  const { data, isLoading } = useShopListings({ includeInactive: true });
  const deleteMutation = useDeleteShopListing();
  const [deleteTarget, setDeleteTarget] = useState<ShopListingDto | null>(null);

  const listings = data ?? [];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('삭제했습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">샵매매</h1>
          <p className="text-muted-foreground text-sm">
            가게 양도/양수 소개 글을 올리는 곳이에요.
          </p>
        </div>
        <Button asChild>
          <Link href="/mall/shop-listings/new">새 글 쓰기</Link>
        </Button>
      </div>

      {isLoading && (
        <p className="text-muted-foreground py-10 text-center text-sm">
          불러오는 중…
        </p>
      )}

      {!isLoading && listings.length === 0 && (
        <div className="rounded-lg border py-16 text-center">
          <p className="text-muted-foreground text-sm">
            아직 올린 글이 없어요.
          </p>
          <Button asChild className="mt-4">
            <Link href="/mall/shop-listings/new">첫 글 쓰기</Link>
          </Button>
        </div>
      )}

      <ul className="grid gap-3">
        {listings.map((listing) => {
          const thumbnailUrl = resolvePublicFileUrl(listing.thumbnailFileId);

          return (
            <li
              key={listing.id}
              className="flex items-center gap-4 rounded-lg border p-3"
            >
              <div className="bg-muted relative h-20 w-28 shrink-0 overflow-hidden rounded">
                {thumbnailUrl ? (
                  <Image
                    src={thumbnailUrl}
                    alt=""
                    fill
                    sizes="112px"
                    className="object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground flex h-full items-center justify-center">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{listing.title}</span>
                  {listing.region && (
                    <Badge variant="outline">
                      {SHOP_LISTING_REGION_LABELS[listing.region]}
                    </Badge>
                  )}
                  <Badge variant={listing.isActive ? 'default' : 'secondary'}>
                    {listing.isActive ? '보임' : '숨김'}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {new Date(listing.createdAt).toLocaleDateString('ko-KR')} ·
                  /kr/shop-trade/{listing.slug}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/mall/shop-listings/${listing.id}`}>수정</Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(listing)}
                >
                  삭제
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>글을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.title}</strong> 글을 삭제합니다. 되돌릴 수
              없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleteMutation.isPending}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
