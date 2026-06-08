export type VersionLifecycleStatus = 'active' | 'inactive' | 'draft' | null;

export type VersionLifecycleDetail = {
  source: 'master' | 'version';
  status: VersionLifecycleStatus;
  versionId: string | null;
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
  const isVersionDetail = detail.source === 'version' && Boolean(detail.versionId);
  const canPublish =
    isVersionDetail &&
    (detail.status === 'draft' || detail.status === 'inactive');
  const canDeleteDraft = isVersionDetail && detail.status === 'draft';

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
  const title =
    responseMessageLines[0]
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
      [...responseMessageDetails, ...detailSources.flatMap(collectTexts)].filter(
        (text) => text !== title
      )
    )
  );

  return {
    title: title || '발행할 수 없습니다.',
    details,
  };
}
