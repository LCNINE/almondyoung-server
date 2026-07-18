'use client';

import Link from 'next/link';
import { ArrowRight, ListChecks } from 'lucide-react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import {
  getDraftCompletionChecklistItems,
  shouldShowDraftCompletionChecklist,
  type DraftCompletionChecklistItem,
} from './draft-completion-checklist-model';

type Props = {
  masterId: string;
  versionId: string;
};

function ChecklistItemLink({ item }: { item: DraftCompletionChecklistItem }) {
  return (
    <Link
      href={item.href}
      id={item.id === 'publish-readiness' ? 'product-draft-publish-readiness' : undefined}
      className="group flex items-center justify-between gap-3 rounded-md border bg-background p-4 text-left transition-colors hover:bg-accent"
    >
      <span className="text-sm font-semibold leading-5">{item.title}</span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function DraftCompletionChecklist({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);

  if (!shouldShowDraftCompletionChecklist(data) || !data.versionId) {
    return null;
  }

  const items = getDraftCompletionChecklistItems({
    masterId,
    versionId: data.versionId,
  });

  return (
    <Container className="divide-y-0 bg-background">
      <Header
        title="Draft 완성 체크리스트"
        subtitle="남은 편집 작업을 빠르게 찾기 위한 안내입니다."
      />

      <div className="flex flex-col gap-4 px-6 pb-6">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {items.map((item) => (
            <ChecklistItemLink key={item.id} item={item} />
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ListChecks className="size-4" />
          기본 정보, 이미지, 옵션/variant, 가격 정책, 발행 준비 상태를 같은 draft version 기준으로 확인하세요.
        </div>
      </div>
    </Container>
  );
}
