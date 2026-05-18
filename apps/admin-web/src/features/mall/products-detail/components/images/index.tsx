'use client';

import Image from 'next/image';
import { Suspense, useMemo } from 'react';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { FILE_SERVICE_BASE_URL } from '@/const/api-const';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import type { ProductImage } from '@/lib/services/products/products-detail.types';

type Props = { masterId: string; versionId: string | null };

function resolveImageSrc(fileId: string): string {
  return `${FILE_SERVICE_BASE_URL}/files/public/${fileId}`;
}

function ProductDetailImagesContent({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);

  const { primary, rest } = useMemo(() => {
    const sorted = [...data.images].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
    const [head, ...tail] = sorted;
    return { primary: head ?? null, rest: tail } as {
      primary: ProductImage | null;
      rest: ProductImage[];
    };
  }, [data.images]);

  if (!primary) {
    return <div className="p-3 text-sm text-gray-500">이미지 없음</div>;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-gray-50">
        <Image
          src={resolveImageSrc(primary.fileId)}
          alt="대표 이미지"
          fill
          className="object-contain"
          sizes="(max-width: 1280px) 100vw, 440px"
          unoptimized
        />
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {rest.map((img) => (
            <div
              key={img.id}
              className="relative aspect-square overflow-hidden rounded-md bg-gray-50"
            >
              <Image
                src={resolveImageSrc(img.fileId)}
                alt="부가 이미지"
                fill
                className="object-contain"
                sizes="110px"
                unoptimized
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductDetailImages({ masterId, versionId }: Props) {
  return (
    <Container>
      <Header title="이미지" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailImagesContent masterId={masterId} versionId={versionId} />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
