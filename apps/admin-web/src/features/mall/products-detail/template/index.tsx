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
import { CreateDraftAction } from '../components/create-draft-action';
import { DraftCompletionChecklist } from '../components/draft-completion-checklist';
import { VersionLifecycleActions } from '../components/version-lifecycle-actions';

type Props = {
  masterId: string;
  versionId: string | null;
};

export default function ProductsDetailTemplate({ masterId, versionId }: Props) {
  return (
    <div className="flex flex-col w-full gap-y-3">
      <div className="flex items-center justify-end gap-2">
        <CreateDraftAction masterId={masterId} versionId={versionId} />
        <Link
          href={`/mall/products-list/${masterId}/versions${versionId ? `?versionId=${versionId}` : ''}`}
          className="flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <GitBranch className="w-4 h-4" />
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

      {versionId && (
        <CardErrorBoundary>
          <Suspense fallback={null}>
            <DraftCompletionChecklist
              masterId={masterId}
              versionId={versionId}
            />
          </Suspense>
        </CardErrorBoundary>
      )}

      {versionId && (
        <CardErrorBoundary>
          <Suspense fallback={null}>
            <VersionLifecycleActions
              masterId={masterId}
              versionId={versionId}
            />
          </Suspense>
        </CardErrorBoundary>
      )}

      <TwoColumnPage>
        <TwoColumnPage.Main>
          <div id="product-basic-information">
            <ProductDetailGeneral masterId={masterId} versionId={versionId} />
          </div>
          <ProductDetailDescription masterId={masterId} versionId={versionId} />
          <div
            id="product-options-and-variants"
            className="flex flex-col gap-y-3"
          >
            <ProductDetailOptions masterId={masterId} versionId={versionId} />
            <ProductDetailVariants masterId={masterId} versionId={versionId} />
          </div>
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <div id="product-images">
            <ProductDetailImages masterId={masterId} versionId={versionId} />
          </div>
        </TwoColumnPage.Sidebar>
      </TwoColumnPage>
    </div>
  );
}
