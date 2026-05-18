'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import {
  useVersionTreeSuspense,
  useMasterSuspense,
} from '@/lib/services/products/queries';
import { TreeGraph } from '../components/tree-graph';
import { CollapsedChainPanel } from '../components/collapsed-chain-panel';
import type { CollapsedGroup } from '../lib/collapse';

type Props = {
  masterId: string;
  currentVersionId: string | null;
};

function MasterTitle({ masterId }: { masterId: string }) {
  const { data } = useMasterSuspense(masterId);
  return <span>{data.name}</span>;
}

function TreeContent({ masterId, currentVersionId }: Props) {
  const { data: tree } = useVersionTreeSuspense(masterId);
  const [openGroup, setOpenGroup] = useState<CollapsedGroup | null>(null);

  return (
    <div className="flex w-full flex-col gap-y-3 xl:grid xl:grid-cols-[minmax(0,_1fr)_360px]">
      <Container className="h-[calc(100vh-160px)] min-h-[500px] overflow-hidden p-0">
        <TreeGraph
          masterId={masterId}
          tree={tree}
          currentVersionId={currentVersionId}
          openGroupId={openGroup?.id ?? null}
          onOpenGroup={setOpenGroup}
        />
      </Container>
      <div>
        {openGroup ? (
          <CollapsedChainPanel
            masterId={masterId}
            versions={openGroup.versions}
            onClose={() => setOpenGroup(null)}
          />
        ) : (
          <Container>
            <Header title="안내" />
            <div className="px-3 py-4 text-sm text-gray-500 leading-relaxed">
              버전 노드를 클릭하면 해당 버전의 상세 페이지로 이동합니다.
              <br />
              점선으로 표시된 묶음(+N개)은 분기 없이 이어진 버전들이며, 클릭하면 이 자리에 펼쳐집니다.
            </div>
          </Container>
        )}
      </div>
    </div>
  );
}

export default function ProductVersionsTreeTemplate({ masterId, currentVersionId }: Props) {
  return (
    <div className="flex w-full flex-col gap-y-3">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href={`/mall/products-list/${masterId}`}
          className="flex items-center gap-1 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          <Suspense fallback={<span>마스터로</span>}>
            <CardErrorBoundary>
              <MasterTitle masterId={masterId} />
            </CardErrorBoundary>
          </Suspense>
        </Link>
        <span>/</span>
        <span className="text-gray-900">버전 트리</span>
      </div>

      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <TreeContent masterId={masterId} currentVersionId={currentVersionId} />
        </Suspense>
      </CardErrorBoundary>
    </div>
  );
}
