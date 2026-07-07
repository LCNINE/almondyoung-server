export type DraftChecklistStatus = 'active' | 'inactive' | 'draft' | null;

export type DraftChecklistDetail = {
  source: 'master' | 'version';
  status: DraftChecklistStatus;
  versionId: string | null;
};

export type DraftCompletionChecklistItemId =
  | 'basic-information'
  | 'images'
  | 'options-and-variants'
  | 'pricing-rules'
  | 'publish-readiness';

export type DraftCompletionChecklistItem = {
  id: DraftCompletionChecklistItemId;
  title: string;
  href: string;
  state: 'advisory';
  blocksPublish: false;
};

export function shouldShowDraftCompletionChecklist(detail: DraftChecklistDetail): boolean {
  return detail.source === 'version' && detail.status === 'draft' && Boolean(detail.versionId);
}

export function getDraftCompletionChecklistItems({
  masterId,
  versionId,
}: {
  masterId: string;
  versionId: string;
}): DraftCompletionChecklistItem[] {
  return [
    {
      id: 'basic-information',
      title: '기본 정보',
      href: '#product-basic-information',
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'images',
      title: '이미지',
      href: '#product-images',
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'options-and-variants',
      title: '옵션 / variant',
      href: '#product-options-and-variants',
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'pricing-rules',
      title: '가격 정책',
      href: `/mall/pricing/${masterId}?versionId=${versionId}`,
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'publish-readiness',
      title: 'publish 준비',
      href: '#product-draft-publish-readiness',
      state: 'advisory',
      blocksPublish: false,
    },
  ];
}
