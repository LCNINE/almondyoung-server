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
  description: string;
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
      description: '상품명, 브랜드, SEO, 판매 조건이 운영 기준에 맞는지 확인합니다.',
      href: '#product-basic-information',
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'images',
      title: '이미지',
      description: '대표 이미지와 상세 이미지 구성이 고객 노출에 충분한지 확인합니다.',
      href: '#product-images',
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'options-and-variants',
      title: '옵션 / variant',
      description: '옵션 구조, variant 이름, 노출 순서, 판매 상태를 확인합니다.',
      href: '#product-options-and-variants',
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'pricing-rules',
      title: '가격 정책',
      description: '같은 draft version의 가격 관리 화면에서 base, 멤버십, tiered 룰을 확인합니다.',
      href: `/mall/pricing/${masterId}?versionId=${versionId}`,
      state: 'advisory',
      blocksPublish: false,
    },
    {
      id: 'publish-readiness',
      title: 'publish 준비',
      description: '최종 검수 체크입니다. 이 목록은 안내용이며 publish를 막는 검증 목록이 아닙니다.',
      href: '#product-draft-publish-readiness',
      state: 'advisory',
      blocksPublish: false,
    },
  ];
}
