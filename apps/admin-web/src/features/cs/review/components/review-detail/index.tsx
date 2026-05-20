'use client';

import React, { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useReview } from '@/lib/services/review';
import { useMastersByIdsSuspense } from '@/lib/services/products/queries';
import { useOptionalAdminUser } from '@/lib/services/users/queries';
import { STATUS_LABELS, ReviewStatus } from '@/lib/types/dto/review';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from '@/components/ui/carousel';
import { StarIcon } from 'lucide-react';
import { FILE_SERVICE_BASE_URL } from '@/const/api-const';
import Image from 'next/image';
import { ReviewDeleteButton } from '../review-delete-button';

function buildProductThumbnailSrc(thumbnail: string | null | undefined) {
  if (!thumbnail) return '/placeholder.svg';
  if (thumbnail.startsWith('http://') || thumbnail.startsWith('https://')) {
    return thumbnail;
  }

  return `${FILE_SERVICE_BASE_URL}/files/public/${thumbnail}`;
}

function ratingStars(rating: number) {
  const safe = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <div className="flex items-center gap-1" aria-label={`별점 ${safe}점`}>
      {Array.from({ length: 5 }).map((_, index) => (
        <StarIcon
          key={index}
          className={
            index < safe
              ? 'h-4 w-4 fill-yellow-400 text-yellow-400'
              : 'h-4 w-4 text-muted-foreground/40'
          }
        />
      ))}
      <span className="ml-1 text-sm text-muted-foreground">{safe}</span>
    </div>
  );
}

function statusVariant(
  status: ReviewStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'hidden') return 'secondary';
  return 'outline';
}

function ProductCardSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="w-16 h-16 rounded shrink-0" />
      <div className="min-w-0 space-y-1.5">
        <Skeleton className="w-40 h-4" />
        <Skeleton className="w-56 h-3" />
      </div>
    </div>
  );
}

function ReviewProductCard({ productId }: { productId: string }) {
  const { data: products } = useMastersByIdsSuspense([productId]);
  const product = products.data[0];

  return (
    <div className="flex items-center gap-3">
      <div className="w-16 h-16 overflow-hidden border rounded shrink-0 bg-muted">
        <Image
          src={buildProductThumbnailSrc(product?.thumbnail)}
          alt={product?.name ?? '상품 이미지'}
          width={64}
          height={64}
          className="object-cover w-full h-full"
        />
      </div>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">
          {product?.name ?? (
            <span className="text-muted-foreground">상품 정보 없음</span>
          )}
        </p>
        <p className="font-mono text-xs text-muted-foreground">{productId}</p>
      </div>
    </div>
  );
}

function ReviewAuthorName({ userId }: { userId: string }) {
  const { data: author, isLoading, error } = useOptionalAdminUser(userId);

  if (error) {
    return <span className="text-muted-foreground">{userId}</span>;
  }

  return <span>{author?.nickname ?? author?.username ?? userId}</span>;
}

function ReviewDetailContent({ reviewId }: { reviewId: string }) {
  const { data } = useReview(reviewId);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();

  const imageUrls = data.mediaFileIds.map(
    (fileId) => `${FILE_SERVICE_BASE_URL}/files/public/${fileId}`
  );

  React.useEffect(() => {
    if (carouselApi && selectedIndex !== null) {
      carouselApi.scrollTo(selectedIndex);
    }
  }, [carouselApi, selectedIndex]);

  const authorNode: React.ReactNode = data.legacy_author_name ? (
    <span>{data.legacy_author_name}</span>
  ) : data.userId ? (
    <Suspense fallback={<Skeleton className="w-24 h-4" />}>
      <ReviewAuthorName userId={data.userId} />
    </Suspense>
  ) : (
    <span>-</span>
  );

  const productNode: React.ReactNode = data.productId ? (
    <Suspense fallback={<ProductCardSkeleton />}>
      <ReviewProductCard productId={data.productId} />
    </Suspense>
  ) : (
    <span className="text-muted-foreground">-</span>
  );

  const rows: { key: string; value: React.ReactNode }[] = [
    { key: '작성자', value: authorNode },
    { key: '상품', value: productNode },
    { key: '별점', value: ratingStars(data.rating) },
    {
      key: '상태',
      value: data.deletedAt ? (
        <Badge variant="destructive">{STATUS_LABELS.deleted}</Badge>
      ) : (
        <Badge variant={statusVariant(data.status)}>
          {STATUS_LABELS[data.status]}
        </Badge>
      ),
    },
    {
      key: '도움이됐어요',
      value: `${data.helpfulCount}개`,
    },
    {
      key: '작성일',
      value: new Date(data.createdAt).toLocaleString('ko-KR'),
    },
  ];

  return (
    <article className="divide-y">
      <header className="p-4">
        <h2 className="text-lg font-semibold">리뷰 #{data.id.slice(0, 8)}</h2>
      </header>
      <dl>
        {rows.map(({ key, value }) => (
          <div key={key} className="grid grid-cols-3 p-3">
            <dt className="text-sm font-medium text-gray-500">{key}</dt>
            <dd className="col-span-2 text-sm">{value ?? '-'}</dd>
          </div>
        ))}
      </dl>
      <section className="p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-500">리뷰 내용</h3>
        <p className="p-4 text-sm whitespace-pre-wrap rounded-md bg-gray-50">
          {data.content}
        </p>
      </section>
      {imageUrls.length > 0 && (
        <section className="p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-500">
            첨부파일 ({imageUrls.length}개)
          </h3>
          <ul className="flex flex-wrap gap-3">
            {imageUrls.map((url, index) => (
              <li key={url}>
                <button
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className="cursor-pointer"
                >
                  <Image
                    width={96}
                    height={96}
                    src={url}
                    alt={`첨부 이미지 ${index + 1}`}
                    className="object-cover transition-opacity border rounded-md aspect-square hover:opacity-80"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={selectedIndex !== null}
        onOpenChange={() => setSelectedIndex(null)}
      >
        <DialogContent className="max-w-2xl p-4">
          <Carousel setApi={setCarouselApi} className="w-full">
            <CarouselContent>
              {imageUrls.map((url, index) => (
                <CarouselItem key={url}>
                  <div className="relative flex h-[70vh] w-full items-center justify-center">
                    <Image
                      fill
                      src={url}
                      alt={`첨부 이미지 ${index + 1}`}
                      className="object-contain"
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-2" />
            <CarouselNext className="right-2" />
          </Carousel>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function ReviewDetail({ reviewId }: { reviewId: string }) {
  return (
    <Container className="divide-y">
      <Header
        title="리뷰 상세"
        right={<ReviewDeleteButton reviewId={reviewId} />}
      />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <ReviewDetailContent reviewId={reviewId} />
      </Suspense>
    </Container>
  );
}
