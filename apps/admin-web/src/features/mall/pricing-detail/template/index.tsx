'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import {
  useMaster,
  useMasterVersions,
  useVariantsByMaster,
  useVersionDetail,
  useVersionPricingRules,
} from '@/lib/services/products/queries';
import {
  useReplaceVersionPricingRules,
  useDeleteVersionPricingRules,
  useCreateMasterDraftVersion,
} from '@/lib/services/products/mutations';
import { VersionSelector } from '../components/version-selector';
import { CreateDraftDialog } from '../components/create-draft-dialog';
import { RulesEditor } from '../components/rules-editor';
import { Calculator } from '../components/calculator';
import { PriceSetTable } from '../components/price-set-table';
import type { ReplacePricingRulesDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import {
  selectPricingVariants,
  toPricingVariantsFromMaster,
  toPricingVariantsFromVersion,
} from '../pricing-detail-model';

interface Props {
  masterId: string;
}

export default function PricingDetailTemplate({ masterId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createDraftOpen, setCreateDraftOpen] = useState(false);

  const { data: master } = useMaster(masterId);
  const { data: versionsTree = [] } = useMasterVersions(masterId);
  const { data: variantsRes, isLoading: masterVariantsLoading } = useVariantsByMaster({
    masterId,
    page: 1,
    limit: 100,
  });

  const flatVersions = useMemo(() => flattenVersions(versionsTree), [versionsTree]);
  const activeVersion = flatVersions.find((v) => v.status === 'active') ?? null;

  const paramVersionId = searchParams.get('versionId');
  const selectedVersionId = paramVersionId ?? activeVersion?.id ?? null;

  const selectedVersion = flatVersions.find((v) => v.id === selectedVersionId) ?? null;
  const isReadonly = selectedVersion?.status !== 'draft';
  const { data: selectedVersionDetail, isLoading: versionDetailLoading } = useVersionDetail(
    masterId,
    selectedVersionId
  );
  const masterPricingVariants = useMemo(
    () => toPricingVariantsFromMaster(variantsRes?.data ?? []),
    [variantsRes?.data]
  );
  const versionPricingVariants = useMemo(
    () => toPricingVariantsFromVersion(selectedVersionDetail?.variants ?? []),
    [selectedVersionDetail?.variants]
  );
  const variants = useMemo(
    () =>
      selectPricingVariants({
        selectedVersionId,
        masterVariants: masterPricingVariants,
        versionVariants: versionPricingVariants,
      }),
    [masterPricingVariants, selectedVersionId, versionPricingVariants]
  );
  const variantsLoading = selectedVersionId ? versionDetailLoading : masterVariantsLoading;

  const setVersionId = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('versionId', id);
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const { data: rules, isLoading: rulesLoading } = useVersionPricingRules(
    selectedVersionId ?? '',
  );

  const replaceRules = useReplaceVersionPricingRules();
  const deleteRules = useDeleteVersionPricingRules();
  const createDraft = useCreateMasterDraftVersion();

  const handleSave = (dto: ReplacePricingRulesDto) => {
    if (!selectedVersionId) return;
    replaceRules.mutate(
      { masterId, versionId: selectedVersionId, dto },
      {
        onSuccess: () => toast.success('가격 룰이 저장되었습니다.'),
        onError: () => toast.error('저장에 실패했습니다.'),
      },
    );
  };

  const handleDelete = () => {
    if (!selectedVersionId) return;
    deleteRules.mutate(
      { masterId, versionId: selectedVersionId },
      {
        onSuccess: () => toast.success('가격 룰이 삭제되었습니다.'),
        onError: () => toast.error('삭제에 실패했습니다.'),
      },
    );
  };

  const handleCreateDraft = (copyMappings: boolean) => {
    createDraft.mutate(
      { masterId, dto: { copyMappings } },
      {
        onSuccess: (newVersion) => {
          setCreateDraftOpen(false);
          toast.success('새 draft 버전이 생성되었습니다.');
          setVersionId(newVersion.id);
        },
        onError: (e: any) => {
          toast.error(e?.response?.data?.message ?? 'draft 생성에 실패했습니다.');
        },
      },
    );
  };

  const backHref = selectedVersionId
    ? `/mall/products-list/${masterId}?versionId=${selectedVersionId}`
    : `/mall/products-list/${masterId}`;

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href={backHref}
          className="flex items-center gap-1 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {master?.name ?? '상품 상세'}
        </Link>
        <span>/</span>
        <span className="text-gray-900">가격 관리</span>
      </div>
      <Container className="divide-y-0">
        <Header
          title={master?.name ?? '가격 관리'}
          subtitle={`마스터 상품의 버전별 가격 룰을 관리합니다. draft 버전만 편집 가능합니다.`}
        />

        <div className="px-4 pb-4 pt-2">
          <VersionSelector
            versions={versionsTree}
            selectedVersionId={selectedVersionId}
            onSelect={setVersionId}
            onCreateDraft={() => setCreateDraftOpen(true)}
          />
        </div>
      </Container>

      {!selectedVersionId ? (
        <Container>
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-muted-foreground">버전이 없습니다.</p>
            <p className="text-xs text-muted-foreground">
              먼저 상품 버전을 생성한 후 가격 룰을 설정하세요.
            </p>
          </div>
        </Container>
      ) : (
        <>
          <Container className="divide-y-0">
            {rulesLoading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">룰 로딩 중...</p>
            ) : (
              <RulesEditor
                rules={rules}
                readonly={isReadonly}
                isSaving={replaceRules.isPending}
                isDeleting={deleteRules.isPending}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            )}
          </Container>

          <div className="grid grid-cols-1 gap-y-2 lg:grid-cols-2 lg:gap-x-2 lg:gap-y-0">
            <Container className="divide-y-0">
              <Header title="가격 시뮬레이션" />
              {variantsLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">품목 로딩 중...</p>
              ) : (
                <Calculator
                  variants={variants}
                  versionId={selectedVersionId}
                  masterId={masterId}
                />
              )}
            </Container>
            <Container className="divide-y-0">
              <Header title="옵션별 가격 현황" />
              {variantsLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">품목 로딩 중...</p>
              ) : (
                <PriceSetTable
                  variants={variants}
                  versionId={selectedVersionId}
                  masterId={masterId}
                />
              )}
            </Container>
          </div>
        </>
      )}

      <CreateDraftDialog
        open={createDraftOpen}
        onOpenChange={setCreateDraftOpen}
        onConfirm={handleCreateDraft}
        isPending={createDraft.isPending}
      />
    </div>
  );
}

function flattenVersions(
  versions: import('@/lib/types/dto/products').MasterVersionDto[],
): import('@/lib/types/dto/products').MasterVersionDto[] {
  const result: import('@/lib/types/dto/products').MasterVersionDto[] = [];
  const walk = (nodes: typeof result) => {
    for (const n of nodes) {
      result.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(versions);
  return result;
}
