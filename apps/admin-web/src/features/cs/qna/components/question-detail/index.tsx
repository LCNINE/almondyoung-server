'use client';

import React, { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Spinner } from '@/components/ui/spinner';
import { useQuestion } from '@/lib/services/qna';
import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  SUB_CATEGORY_LABELS,
  getQuestionSource,
} from '@/lib/types/dto/qna';
import { QnaStatusCell } from '@/components/table/table-cells/qna';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from '@/components/ui/carousel';
import { ChevronRight, LockIcon, PackageIcon } from 'lucide-react';
import Link from 'next/link';
import { useMastersByIds } from '@/lib/services/products/queries';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import Image from 'next/image';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-muted text-foreground inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium">
      {children}
    </span>
  );
}

function ProductStrip({ productId }: { productId: string }) {
  const { data, isLoading } = useMastersByIds([productId]);
  const product = data?.data?.[0];
  const thumbnail = resolvePublicFileUrl(product?.thumbnail);
  // active 버전이 없는 상품은 GET /masters/:id 가 404 라 versionId 로 연다 (상품 목록과 같은 규칙)
  const href =
    product && product.status !== 'active'
      ? `/mall/products-list/${productId}?versionId=${product.versionId}`
      : `/mall/products-list/${productId}`;

  return (
    <Link
      href={href}
      target="_blank"
      className="hover:bg-muted/60 mb-5 flex items-center gap-3 rounded-lg border p-3 transition-colors"
    >
      <div className="bg-muted relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {thumbnail ? (
          <Image
            src={thumbnail}
            alt=""
            fill
            unoptimized
            className="object-cover"
          />
        ) : (
          <PackageIcon className="text-muted-foreground size-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs">
          {product?.brand || '문의한 상품'}
        </p>
        <p className="truncate text-sm font-medium">
          {product?.name ??
            (isLoading ? '불러오는 중…' : '상품 정보를 불러오지 못했어요')}
        </p>
      </div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}

function QuestionDetailContent({ questionId }: { questionId: string }) {
  const { data } = useQuestion(questionId);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();

  const imageUrls = data.mediaFileIds.map(
    (fileId) => resolvePublicFileUrl(fileId) ?? ''
  );

  // 캐러셀이 열릴 때 선택한 이미지로 이동
  React.useEffect(() => {
    if (carouselApi && selectedIndex !== null) {
      carouselApi.scrollTo(selectedIndex);
    }
  }, [carouselApi, selectedIndex]);

  const category = data.category
    ? [
        CATEGORY_LABELS[data.category],
        data.subCategory &&
          (SUB_CATEGORY_LABELS[data.category][data.subCategory] ??
            data.subCategory),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <article className="p-6">
      {data.deletedAt && (
        <p className="bg-muted text-muted-foreground mb-4 rounded-md px-4 py-3 text-sm">
          고객에게 보이지 않는 삭제된 문의예요
        </p>
      )}

      {data.productId && <ProductStrip productId={data.productId} />}

      <div className="flex flex-wrap items-center gap-1.5">
        <QnaStatusCell status={data.status} />
        <Chip>{SOURCE_LABELS[getQuestionSource(data)]}</Chip>
        {category && <Chip>{category}</Chip>}
        {data.isSecret && (
          <Chip>
            <LockIcon className="size-3" /> 비밀글
          </Chip>
        )}
      </div>

      <h2 className="mt-3 text-xl leading-snug font-bold break-keep">
        {data.title}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {new Date(data.createdAt).toLocaleString('ko-KR')}
      </p>

      <p className="mt-6 text-[15px] leading-7 break-keep whitespace-pre-wrap">
        {data.content}
      </p>

      {imageUrls.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {imageUrls.map((url, index) => (
            <li key={url}>
              <button
                type="button"
                onClick={() => setSelectedIndex(index)}
                className="cursor-pointer"
              >
                <Image
                  unoptimized
                  width={96}
                  height={96}
                  src={url}
                  alt={`첨부 이미지 ${index + 1}`}
                  className="aspect-square rounded-md border object-cover transition-opacity hover:opacity-80"
                />
              </button>
            </li>
          ))}
        </ul>
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
                      unoptimized
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

export function QuestionDetail({ questionId }: { questionId: string }) {
  return (
    <Container>
      <Suspense
        fallback={
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        }
      >
        <QuestionDetailContent questionId={questionId} />
      </Suspense>
    </Container>
  );
}
