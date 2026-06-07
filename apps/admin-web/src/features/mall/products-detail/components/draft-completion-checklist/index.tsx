'use client';

import Link from 'next/link';
import { ArrowRight, ClipboardCheck, Info, ListChecks } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
      className="group flex min-h-24 flex-col justify-between gap-3 rounded-md border bg-background p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold leading-5">{item.title}</span>
            <Badge variant="outline">{item.state === 'advisory' ? '안내용' : item.state}</Badge>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
        </div>
        <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
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
        right={
          <Badge variant="secondary" className="gap-1">
            <ClipboardCheck />
            발행 차단 없음
          </Badge>
        }
      />

      <div className="flex flex-col gap-4 px-6 pb-6">
        <Alert>
          <Info />
          <AlertTitle>안내용 작업 목록</AlertTitle>
          <AlertDescription>
            체크리스트 상태는 검증 실패 목록이 아니며 발행 가능 여부를 판단하거나 차단하지 않습니다.
          </AlertDescription>
        </Alert>

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
