export type VersionLifecycleStatus = 'active' | 'inactive' | 'draft' | null;

export type VersionLifecycleDetail = {
  source: 'master' | 'version';
  status: VersionLifecycleStatus;
  versionId: string | null;
  /**
   * 일괄 등록/수정 세션이 이 버전을 잠갔다면 그 세션 id.
   * 서버가 개별 발행·삭제를 둘 다 409 로 거부하므로 버튼을 아예 내린다.
   */
  bulkSessionId?: string | null;
};

export type VersionLifecycleActions = {
  canPublish: boolean;
  canDeleteDraft: boolean;
};

export type VersionLifecycleError = {
  title: string;
  details: string[];
};

export function getVersionLifecycleActions(
  detail: VersionLifecycleDetail
): VersionLifecycleActions {
  const isVersionDetail =
    detail.source === 'version' && Boolean(detail.versionId);
  const locked = Boolean(detail.bulkSessionId);
  const canPublish =
    !locked &&
    isVersionDetail &&
    (detail.status === 'draft' || detail.status === 'inactive');
  const canDeleteDraft =
    !locked && isVersionDetail && detail.status === 'draft';

  return {
    canPublish,
    canDeleteDraft,
  };
}

export function getVersionLifecycleDeleteSuccessHref(): string {
  return '/mall/products-list';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function responseBodyFromError(error: unknown): unknown {
  if (!isRecord(error) || !('response' in error)) {
    return null;
  }

  const response = error.response;
  if (isRecord(response) && 'data' in response) {
    return response.data;
  }

  return response;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (isRecord(value)) {
    const message = value.message;
    if (typeof message === 'string') {
      const trimmed = message.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }

  return null;
}

function splitTextLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function collectTexts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectTexts);
  }

  const text = toText(value);
  if (text) return splitTextLines(text);

  if (isRecord(value)) {
    return Object.values(value).flatMap(collectTexts);
  }

  return [];
}

export function formatVersionLifecycleError(
  error: unknown
): VersionLifecycleError {
  const body = responseBodyFromError(error);
  const bodyRecord = isRecord(body) ? body : null;
  const responseMessage = bodyRecord?.message;
  const responseMessageLines =
    typeof responseMessage === 'string' ? splitTextLines(responseMessage) : [];
  const title = responseMessageLines[0]
    ? responseMessageLines[0]
    : error instanceof Error
      ? error.message
      : '발행할 수 없습니다.';
  const responseMessageDetails = responseMessageLines.slice(1);

  const detailSources = bodyRecord
    ? [
        bodyRecord.errors,
        bodyRecord.error,
        bodyRecord.details,
        bodyRecord.validationErrors,
        Array.isArray(responseMessage) ? responseMessage : null,
      ]
    : [];

  const details = Array.from(
    new Set(
      [
        ...responseMessageDetails,
        ...detailSources.flatMap(collectTexts),
      ].filter((text) => text !== title)
    )
  );

  return {
    title: title || '발행할 수 없습니다.',
    details,
  };
}

/** 발행 전에 보이는 «빠진 것». 발행을 막지는 않는다(판매가를 나중에 넣는 흐름이 있을 수 있다 — 11-05 결정). */
export type PublishGap = 'price' | 'price-unknown' | 'image';

export const PUBLISH_GAP_LABELS: Record<PublishGap, string> = {
  price: '판매가가 정해지지 않았습니다 — 이대로 발행하면 판매가·멤버십가가 0원으로 보입니다.',
  'price-unknown': '판매가 규칙을 확인하지 못했습니다 — 가격 관리에서 판매가를 확인해 주세요.',
  image: '대표 이미지가 없습니다.',
};

/**
 * @param basePriceRuleCount 판매가(base_price) 규칙 수. 아직 못 읽었거나 실패했으면 null.
 *   판매가는 0원에서 출발해 이 규칙들로 정해지므로, 규칙이 없으면 0원이다.
 */
export function getPublishGaps({
  basePriceRuleCount,
  images,
}: {
  basePriceRuleCount: number | null;
  images: readonly { isPrimary: boolean }[];
}): PublishGap[] {
  const gaps: PublishGap[] = [];
  if (basePriceRuleCount === null) gaps.push('price-unknown');
  else if (basePriceRuleCount === 0) gaps.push('price');
  if (!images.some((image) => image.isPrimary)) gaps.push('image');
  return gaps;
}
