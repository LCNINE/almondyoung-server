import type {
  BarcodeOwnerDto,
  CompleteFieldCaptureRequest,
  FieldCaptureBarcodeStatus,
  FieldCaptureCompletionDto,
} from '@/lib/types/dto/inventory';

// core 의 MIN_REFERENCE_PHOTOS 와 같은 값 (앱이 달라 상수 공유 불가)
export const MIN_REFERENCE_PHOTOS = 3;
export const REFERENCE_PHOTO_CONTEXT_ID = 'sku-reference-photo';
export const REFERENCE_PHOTO_MAX_BYTES = 26214400;

const MAX_MM = 5000;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export function parseMm(input: string): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_MM ? n : null;
}

export function photoRejectionReason(file: { type: string; size: number }): string | null {
  if (!ALLOWED_MIME.includes(file.type)) {
    return 'HEIC 사진은 올릴 수 없어요. 아이폰 설정 > 카메라 > 포맷 > 「높은 호환성」으로 바꿔 주세요';
  }
  if (file.size > REFERENCE_PHOTO_MAX_BYTES) return '사진이 너무 커요 (25MB 이하)';
  return null;
}

export type CaptureDraft = {
  widthMm: string;
  lengthMm: string;
  heightMm: string;
  barcodeStatus: FieldCaptureBarcodeStatus | null;
  scannedBarcode: string;
  photoCount: number;
  allFacesConfirmed: boolean;
};

export function missingRequirements(d: CaptureDraft): string[] {
  const out: string[] = [];
  if (parseMm(d.widthMm) === null) out.push('가로를 mm 정수로 입력해 주세요');
  if (parseMm(d.lengthMm) === null) out.push('세로를 mm 정수로 입력해 주세요');
  if (parseMm(d.heightMm) === null) out.push('높이를 mm 정수로 입력해 주세요');
  if (d.photoCount < MIN_REFERENCE_PHOTOS) {
    out.push(`사진을 ${MIN_REFERENCE_PHOTOS - d.photoCount}장 더 찍어 주세요`);
  }
  if (d.barcodeStatus === null || (d.barcodeStatus === 'scanned' && d.scannedBarcode.trim() === '')) {
    out.push('바코드 칸에서 하나를 골라 주세요');
  }
  if (!d.allFacesConfirmed) out.push('여섯 면이 다 나왔는지 확인해 주세요');
  return out;
}

export function toCompleteRequest(d: CaptureDraft): CompleteFieldCaptureRequest {
  const width = parseMm(d.widthMm);
  const length = parseMm(d.lengthMm);
  const height = parseMm(d.heightMm);
  if (missingRequirements(d).length > 0 || width === null || length === null || height === null || d.barcodeStatus === null) {
    throw new Error('실측 완료 조건이 충족되지 않았습니다');
  }
  const req: CompleteFieldCaptureRequest = {
    packageWidthMm: width,
    packageLengthMm: length,
    packageHeightMm: height,
    barcodeStatus: d.barcodeStatus,
    allFacesConfirmed: true,
  };
  if (d.barcodeStatus === 'scanned') req.scannedBarcode = d.scannedBarcode.trim();
  return req;
}

const KST_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function completedByText(c: { lastWorkerLabel: string; lastCompletedAt: string }): string {
  const parts = Object.fromEntries(KST_FORMAT.formatToParts(new Date(c.lastCompletedAt)).map((p) => [p.type, p.value]));
  return `${c.lastWorkerLabel} 님이 ${parts.month}-${parts.day} ${parts.hour}:${parts.minute} 에 완료함`;
}

// ── 화면 배선용 판정 (컴포넌트는 이것만 부른다) ──

/** 스캔/입력칸 제출값. 빈칸이면 제출하지 않고, 값은 손대지 않는다 — 정규화는 서버 몫. */
export function scanInputValue(raw: string): string | null {
  return raw.trim() === '' ? null : raw;
}

const TYPE_INSTEAD = ' — 아래 칸에 입력해 주세요';

/** 카메라를 아예 못 쓰는 환경이면 그 이유. 쓸 수 있으면 null. */
export function cameraUnavailableReason(env: { isSecureContext: boolean; hasGetUserMedia: boolean }): string | null {
  if (!env.isSecureContext) return `카메라는 https 주소에서만 쓸 수 있어요${TYPE_INSTEAD}`;
  if (!env.hasGetUserMedia) return `이 브라우저는 카메라를 쓸 수 없어요${TYPE_INSTEAD}`;
  return null;
}

/** getUserMedia/디코더가 던진 오류 → 안내 문구 + 다시 눌러 볼 가치가 있는지. */
export function cameraFailure(err: unknown): { message: string; retryable: boolean } {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { message: `카메라 권한이 막혀 있어요${TYPE_INSTEAD}`, retryable: false };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { message: `카메라를 찾지 못했어요${TYPE_INSTEAD}`, retryable: false };
  }
  if (name === 'NotReadableError') {
    return { message: `다른 앱이 카메라를 쓰고 있어요${TYPE_INSTEAD}`, retryable: true };
  }
  return { message: `카메라를 열지 못했어요${TYPE_INSTEAD}`, retryable: true };
}

/** 이미 완료된 SKU 를 고르면 보여 줄 문구. null 이면 확인 없이 들어간다. */
export function reworkNotice(sku: { completion: Pick<FieldCaptureCompletionDto, 'lastWorkerLabel' | 'lastCompletedAt'> | null }): string | null {
  return sku.completion ? completedByText(sku.completion) : null;
}

/** 찍은 제조사 바코드의 주인이 다른 SKU 면 경고 (완료는 막지 않는다 — 서버가 충돌로만 기록). */
export function barcodeConflictWarning(owner: BarcodeOwnerDto | null, currentSkuId: string): string | null {
  if (!owner || owner.skuId === currentSkuId) return null;
  return `이 바코드는 ${owner.name}(${owner.code}) 상품에 이미 붙어 있어요. 이 상품엔 붙이지 않고 기록만 남겨요`;
}

/** axios 오류의 서버 message(검증 오류 배열 포함) → 문자열. */
export function errorMessageOf(e: unknown, fallback: string): string {
  if (typeof e === 'object' && e !== null) {
    const message = 'response' in e ? messageField(e.response) : undefined;
    if (message) return message;
    if (e instanceof Error && e.message) return e.message;
  }
  return fallback;
}

function messageField(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null || !('data' in response)) return undefined;
  const data = response.data;
  if (typeof data !== 'object' || data === null || !('message' in data)) return undefined;
  const m = data.message;
  if (typeof m === 'string' && m !== '') return m;
  if (Array.isArray(m) && m.length > 0) return m.map(String).join(', ');
  return undefined;
}

/**
 * 쿼리키. 인자는 string 만 받는다 — undefined 가 섞인 키로 무효화하면 조용히 아무것도 안 지운다.
 * 위치 전체 무효화는 `positions` 접두사로.
 */
export const fieldCaptureKeys = {
  positions: ['sku-field-capture', 'position'] as const,
  position: (code: string) => ['sku-field-capture', 'position', code] as const,
  detail: (skuId: string) => ['sku-field-capture', 'detail', skuId] as const,
  barcodeOwner: (barcode: string) => ['sku-field-capture', 'barcode-owner', barcode] as const,
  search: (term: string) => ['sku-field-capture', 'search', term] as const,
};
