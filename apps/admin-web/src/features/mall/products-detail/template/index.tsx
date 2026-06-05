'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { GitBranch } from 'lucide-react';
import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Spinner } from '@/components/ui/spinner';
import { ProductDetailDescription } from '../components/description';
import { ProductDetailGeneral } from '../components/general';
import { ProductDetailImages } from '../components/images';
import { ProductDetailOptions } from '../components/options';
import { ProductDetailVariants } from '../components/variants';
import { InactiveVersionBanner } from '../components/inactive-version-banner';

type Props = {
  masterId: string;
  versionId: string | null;
};

export default function ProductsDetailTemplate({ masterId, versionId }: Props) {
  return (
    <div className="flex w-full flex-col gap-y-3">
      <div className="flex items-center justify-end">
        <Link
          href={`/mall/products-list/${masterId}/versions${versionId ? `?versionId=${versionId}` : ''}`}
          className="flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <GitBranch className="h-4 w-4" />
          버전 트리 보기
        </Link>
      </div>

      {versionId && (
        <CardErrorBoundary>
          <Suspense fallback={null}>
            <InactiveVersionBanner masterId={masterId} versionId={versionId} />
          </Suspense>
        </CardErrorBoundary>
      )}

      <TwoColumnPage>
        <TwoColumnPage.Main>
          <ProductDetailGeneral masterId={masterId} versionId={versionId} />
          <ProductDetailDescription masterId={masterId} versionId={versionId} />
          <ProductDetailOptions masterId={masterId} versionId={versionId} />
          <ProductDetailVariants masterId={masterId} versionId={versionId} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <ProductDetailImages masterId={masterId} versionId={versionId} />
        </TwoColumnPage.Sidebar>
      </TwoColumnPage>
    </div>
  );
}
