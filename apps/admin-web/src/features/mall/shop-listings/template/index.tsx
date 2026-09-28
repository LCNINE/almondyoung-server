'use client';

import { useState } from 'react';
import Link from 'next/link';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimplePagination } from '@/components/simple-pagination';
import { useDeleteShopListing, useShopListings } from '@/lib/services/products';
import {
  SHOP_LISTING_REGION_LABELS,
  type AdminShopListingDto,
  type ShopListingAuthorType,
  type ShopListingStatus,
} from '@/lib/types/dto/products';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  SHOP_LISTING_AUTHOR_LABELS,
  SHOP_LISTING_STATUS_LABELS,
  SHOP_LISTING_STATUS_TABS,
  buildAdminListQuery,
} from '../lib/admin-listing-rules';

const PER_PAGE = 20;

export default function ShopListingsTemplate() {
  const [tab, setTab] = useState<ShopListingStatus | 'all'>('pending');
  const [author, setAuthor] = useState<ShopListingAuthorType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const { data, isLoading } = useShopListings(
    buildAdminListQuery(tab, author, q)
  );
  const deleteMutation = useDeleteShopListing();
  const [deleteTarget, setDeleteTarget] = useState<AdminShopListingDto | null>(
    null
  );
  const [page, setPage] = useState(1);

  const listings = data ?? [];
  // 수백 건을 넘어가면 서버에 page/limit 을 넣을 것.
  const totalPages = Math.max(1, Math.ceil(listings.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = listings.slice(
    (currentPage - 1) * PER_PAGE,
    currentPage * PER_PAGE
  );

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
            회원·관리자가 올린 가게 양도/양수 글을 검토하고 관리하는 곳이에요.
          </p>
        </div>
        <Button asChild>
          <Link href="/mall/shop-listings/new">새 글 쓰기</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as ShopListingStatus | 'all');
            setPage(1);
          }}
        >
          <TabsList>
            {SHOP_LISTING_STATUS_TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Select
            value={author}
            onValueChange={(value) => {
              setAuthor(value as ShopListingAuthorType | 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">작성자 전체</SelectItem>
              <SelectItem value="member">회원</SelectItem>
              <SelectItem value="admin">관리자</SelectItem>
            </SelectContent>
          </Select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQ(search);
              setPage(1);
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="제목 검색 후 Enter"
              className="w-[200px]"
            />
          </form>
        </div>
      </div>

      {isLoading && (
        <p className="text-muted-foreground py-10 text-center text-sm">
          불러오는 중…
        </p>
      )}

      {!isLoading && listings.length === 0 && (
        <div className="rounded-lg border py-16 text-center">
          <p className="text-muted-foreground text-sm">
            {tab === 'pending'
              ? '검토할 글이 없어요.'
              : '조건에 맞는 글이 없어요.'}
          </p>
          {tab === 'all' && (
            <Button asChild className="mt-4">
              <Link href="/mall/shop-listings/new">첫 글 쓰기</Link>
            </Button>
          )}
        </div>
      )}

      <ul className="grid gap-3">
        {pageItems.map((listing) => {
          const thumbnailUrl = resolvePublicFileUrl(listing.thumbnailFileId);

          return (
            <li
              key={listing.id}
              className="flex items-center gap-4 rounded-lg border p-3"
            >
              <div className="bg-muted relative h-20 w-28 shrink-0 overflow-hidden rounded">
                {thumbnailUrl ? (
                  // file-service 프록시 경유 이미지라 next/image 를 쓰면 엑박이 된다
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnailUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
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
                  <Badge
                    variant={
                      listing.status === 'pending' ? 'default' : 'secondary'
                    }
                  >
                    {SHOP_LISTING_STATUS_LABELS[listing.status]}
                  </Badge>
                  <Badge variant="outline">
                    {SHOP_LISTING_AUTHOR_LABELS[listing.authorType]}
                  </Badge>
                  {listing.region && (
                    <Badge variant="outline">
                      {SHOP_LISTING_REGION_LABELS[listing.region]}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {listing.status === 'pending' && listing.submittedAt
                    ? `제출 ${new Date(listing.submittedAt).toLocaleString('ko-KR')}`
                    : new Date(listing.createdAt).toLocaleDateString(
                        'ko-KR'
                      )}{' '}
                  · 조회 {listing.viewCount.toLocaleString()} · /kr/shop-trade/
                  {listing.slug}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/mall/shop-listings/${listing.id}`}>열기</Link>
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

      {totalPages > 1 && (
        <SimplePagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}

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
