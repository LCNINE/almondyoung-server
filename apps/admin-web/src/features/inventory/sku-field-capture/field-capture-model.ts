import type { BarcodeFormat } from '@zxing/browser';
import { CustomError } from '@/lib/api/customError';
import type {
  BarcodeOwnerDto,
  CompleteFieldCaptureRequest,
  FieldCaptureBarcodeStatus,
  FieldCaptureCompletionDto,
  FieldCaptureDetailDto,
} from '@/lib/types/dto/inventory';

// core 의 MIN_REFERENCE_PHOTOS 와 같은 값 (앱이 달라 상수 공유 불가)
export const MIN_REFERENCE_PHOTOS = 3;
export const REFERENCE_PHOTO_CONTEXT_ID = 'sku-reference-photo';
export const REFERENCE_PHOTO_MAX_BYTES = 26214400;

const MAX_MM = 5000;
// core MAX_PACKAGE_G 와 같은 값
const MAX_G = 100_000;
// core CompleteFieldCaptureDto.scannedBarcode 의 @MaxLength(64) 와 같은 값
const MAX_BARCODE_LENGTH = 64;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export type BarcodeFormatName = keyof typeof BarcodeFormat;

/**
 * 카메라 요청. 해상도를 안 정하면 PC 웹캠·안드로이드 크롬이 640×480 으로 열어 1D 바코드의 가는 막대가
 * 뭉개진다(2026-10-21 실기에서 음료 캔 EAN-13 을 PC·폰 모두 못 읽음). ideal 이라 못 주는 기기는 가능한 만큼만 준다.
 */
export const SCANNER_VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: 'environment',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

const PHOTO_DECODE_MAX_EDGE = 2000;

/** 사진으로 읽을 때 디코드할 크기 — 폰 원본(1200만 화소)을 그대로 돌리면 수 초 걸린다. 키우지는 않는다. */
export function photoDecodeSize(
  width: number,
  height: number
): { width: number; height: number } {
  const scale = Math.min(1, PHOTO_DECODE_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export const PHOTO_DECODE_FAILED =
  '사진에서 바코드를 못 찾았어요. 바코드가 화면 가운데에 크고 또렷하게 나오게 다시 찍어 주세요.';

/**
 * 제조사 바코드 카메라가 읽는 형식 — 소매 1D 만. 화장품 포장엔 QR(URL)이 흔해서, 다 읽으면 그 URL 이
 * 보조 바코드로 영구히 붙는다(작업자는 뗄 수 없다). 선반 스캔은 이 제한 없이 모든 형식을 읽는다.
 */
export const MANUFACTURER_BARCODE_FORMATS: readonly BarcodeFormatName[] = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'ITF',
];

function parseIntInRange(input: string, max: number): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= max ? n : null;
}

export function parseMm(input: string): number | null {
  return parseIntInRange(input, MAX_MM);
}

export function parseGrams(input: string): number | null {
  return parseIntInRange(input, MAX_G);
}

export function photoRejectionReason(file: {
  type: string;
  size: number;
}): string | null {
  if (!ALLOWED_MIME.includes(file.type)) {
    return 'HEIC 사진은 올릴 수 없어요. 아이폰 설정 > 카메라 > 포맷 > 「높은 호환성」으로 바꿔 주세요';
  }
  if (file.size > REFERENCE_PHOTO_MAX_BYTES)
    return '사진이 너무 커요 (25MB 이하)';
  return null;
}

export type CaptureDraft = {
  widthMm: string;
  lengthMm: string;
  heightMm: string;
  weightG: string;
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
  if (parseGrams(d.weightG) === null) out.push('무게를 g 정수로 입력해 주세요');
  if (d.photoCount < MIN_REFERENCE_PHOTOS) {
    out.push(`사진을 ${MIN_REFERENCE_PHOTOS - d.photoCount}장 더 찍어 주세요`);
  }
  if (
    d.barcodeStatus === null ||
    (d.barcodeStatus === 'scanned' && d.scannedBarcode.trim() === '')
  ) {
    out.push('바코드 칸에서 하나를 골라 주세요');
  } else if (
    d.barcodeStatus === 'scanned' &&
    d.scannedBarcode.trim().length > MAX_BARCODE_LENGTH
  ) {
    // 카메라는 막대 바코드만 읽지만 블루투스 스캐너·직접 입력은 QR(URL)도 들어온다 — 서버 400(영문) 전에 막는다
    out.push(
      '바코드가 너무 길어요. 포장의 제조사 바코드(막대 모양)를 찍어 주세요'
    );
  }
  if (!d.allFacesConfirmed) out.push('여섯 면이 다 나왔는지 확인해 주세요');
  return out;
}

export function toCompleteRequest(
  d: CaptureDraft
): CompleteFieldCaptureRequest {
  const width = parseMm(d.widthMm);
  const length = parseMm(d.lengthMm);
  const height = parseMm(d.heightMm);
  const weight = parseGrams(d.weightG);
  if (
    missingRequirements(d).length > 0 ||
    width === null ||
    length === null ||
    height === null ||
    weight === null ||
    d.barcodeStatus === null
  ) {
    throw new Error('실측 완료 조건이 충족되지 않았습니다');
  }
  const req: CompleteFieldCaptureRequest = {
    packageWidthMm: width,
    packageLengthMm: length,
    packageHeightMm: height,
    packageWeightG: weight,
    barcodeStatus: d.barcodeStatus,
    allFacesConfirmed: true,
  };
  if (d.barcodeStatus === 'scanned')
    req.scannedBarcode = d.scannedBarcode.trim();
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

export function completedByText(c: {
  lastWorkerLabel: string;
  lastCompletedAt: string;
}): string {
  const parts = Object.fromEntries(
    KST_FORMAT.formatToParts(new Date(c.lastCompletedAt)).map((p) => [
      p.type,
      p.value,
    ])
  );
  return `${c.lastWorkerLabel} 님이 ${parts.month}-${parts.day} ${parts.hour}:${parts.minute} 에 완료함`;
}

// ── 화면 배선용 판정 (컴포넌트는 이것만 부른다) ──

/** 스캔/입력칸 제출값. 빈칸이면 제출하지 않고, 값은 손대지 않는다 — 정규화는 서버 몫. */
export function scanInputValue(raw: string): string | null {
  return raw.trim() === '' ? null : raw;
}

const TYPE_INSTEAD = ' — 아래 칸에 입력해 주세요';

/** 카메라를 아예 못 쓰는 환경이면 그 이유. 쓸 수 있으면 null. */
export function cameraUnavailableReason(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
}): string | null {
  if (!env.isSecureContext)
    return `카메라는 https 주소에서만 쓸 수 있어요${TYPE_INSTEAD}`;
  if (!env.hasGetUserMedia)
    return `이 브라우저는 카메라를 쓸 수 없어요${TYPE_INSTEAD}`;
  return null;
}

/** getUserMedia/디코더가 던진 오류 → 안내 문구 + 다시 눌러 볼 가치가 있는지. */
export function cameraFailure(err: unknown): {
  message: string;
  retryable: boolean;
} {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String(err.name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      message: `카메라 권한이 막혀 있어요${TYPE_INSTEAD}`,
      retryable: false,
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      message: `카메라를 찾지 못했어요${TYPE_INSTEAD}`,
      retryable: false,
    };
  }
  if (name === 'NotReadableError') {
    return {
      message: `다른 앱이 카메라를 쓰고 있어요${TYPE_INSTEAD}`,
      retryable: true,
    };
  }
  return { message: `카메라를 열지 못했어요${TYPE_INSTEAD}`, retryable: true };
}

/** 이미 완료된 SKU 를 고르면 보여 줄 문구. null 이면 확인 없이 들어간다. */
export function reworkNotice(sku: {
  completion: Pick<
    FieldCaptureCompletionDto,
    'lastWorkerLabel' | 'lastCompletedAt'
  > | null;
}): string | null {
  return sku.completion ? completedByText(sku.completion) : null;
}

/** 찍은 제조사 바코드의 주인이 다른 SKU 면 경고 (완료는 막지 않는다 — 서버가 충돌로만 기록). */
export function barcodeConflictWarning(
  owner: BarcodeOwnerDto | null,
  currentSkuId: string
): string | null {
  if (!owner || owner.skuId === currentSkuId) return null;
  return `이 바코드는 ${owner.name}(${owner.code}) 상품에 이미 붙어 있어요. 이 상품엔 붙이지 않고 기록만 남겨요`;
}

/**
 * 오류 안내. 언제나 «무엇이 안 됐는지» 문장으로 시작하고, 서버가 준 사유가 있을 때만 괄호로 붙인다.
 * admin-web axios 인터셉터는 모든 실패를 CustomError(message 는 비지 않음)로 던진다 — 네트워크 실패면
 * 서버 본문 없이 statusCode 500 + 'Network Error' 라, 그 문구는 작업자에게 보이지 않는다.
 * fetch 기반 업로드 오류(CustomError 아님)는 상황 문장만 보인다 — 단 서버가 검증으로 거부한 업로드
 * (upload.client 의 UploadRejectedError: 크기·형식·컨텍스트)는 다시 해도 같으니 사유를 붙인다.
 * 그 클래스는 'use client' 모듈 안에 있어 instanceof 대신 name 으로 알아본다.
 */
export function errorMessageOf(e: unknown, context: string): string {
  const fromServer =
    e instanceof CustomError &&
    (e.response !== undefined || e.statusCode < 500);
  const uploadRejected = e instanceof Error && e.name === 'UploadRejectedError';
  return fromServer || uploadRejected ? `${context} (${e.message})` : context;
}

/** 재작업이면 지난 실측값(치수·무게)을 채운다. 여섯 면 확인은 매번 다시 받는다. 사진 수는 서버 수치. */
export function draftFromDetail(detail: FieldCaptureDetailDto): CaptureDraft {
  const num = (v: number | null) => (v === null ? '' : String(v));
  const c = detail.completion;
  return {
    widthMm: num(detail.packageWidthMm),
    lengthMm: num(detail.packageLengthMm),
    heightMm: num(detail.packageHeightMm),
    weightG: num(detail.packageWeightG),
    barcodeStatus: c?.barcodeStatus ?? null,
    scannedBarcode:
      c?.barcodeStatus === 'scanned' ? (c.scannedBarcode ?? '') : '',
    photoCount: detail.photos.length,
    allFacesConfirmed: false,
  };
}

/**
 * 쿼리키. 인자는 string 만 받는다 — undefined 가 섞인 키로 무효화하면 조용히 아무것도 안 지운다.
 * 위치 전체 무효화는 `positions` 접두사로.
 */
export const fieldCaptureKeys = {
  positions: ['sku-field-capture', 'position'] as const,
  position: (code: string) => ['sku-field-capture', 'position', code] as const,
  detail: (skuId: string) => ['sku-field-capture', 'detail', skuId] as const,
  barcodeOwners: ['sku-field-capture', 'barcode-owner'] as const,
  barcodeOwner: (barcode: string) =>
    ['sku-field-capture', 'barcode-owner', barcode] as const,
  myToday: ['sku-field-capture', 'me', 'today'] as const,
  progress: ['sku-field-capture', 'progress'] as const,
  search: (term: string) => ['sku-field-capture', 'search', term] as const,
};

/** 관리자 현황 자동 새로고침 간격 */
export const PROGRESS_REFETCH_MS = 60_000;

/** 실시간 스캔 진단(`?scanDebug=1` 일 때만 보인다). 실기에서 실시간만 못 읽는 원인을 숫자로 보려고 둔다. */
export type ScanDebugInfo = {
  videoWidth: number;
  videoHeight: number;
  trackLabel: string;
  focusMode: string | undefined;
  attempts: number;
  lastError: string | null;
  lastDecodeMs: number | null;
};

export function scanDebugLine(i: ScanDebugInfo): string {
  return [
    `${i.videoWidth}×${i.videoHeight}`,
    i.trackLabel || '(label 없음)',
    `focus=${i.focusMode ?? '?'}`,
    `시도 ${i.attempts}`,
    i.lastError ?? '-',
    i.lastDecodeMs === null ? '-' : `${i.lastDecodeMs}ms`,
  ].join(' · ');
}

export function isScanDebug(search: string): boolean {
  return new URLSearchParams(search).get('scanDebug') === '1';
}

const BACK_LENS = /back|rear|environment|후면/i;

/**
 * 실시간 스캔에 쓸 후면 렌즈. 갤럭시 크롬은 후면 렌즈를 `camera2 0, facing back`(메인)·`2`(초광각)·`3`(망원)으로
 * 따로 내놓는데, facingMode 만 주면 초광각을 골라 가까운 바코드에 초점이 안 잡혔다(2026-10-21 S25 실측:
 * `camera 2, facing back`, 미리보기 흐림, 시도는 계속 NotFound). 번호가 가장 작은 후면 렌즈가 보통 메인이다.
 * 이름이 비어 있으면(권한 전) 고를 수 없다 — null.
 */
export function pickBackCamera(
  devices: readonly { deviceId: string; label: string; kind: string }[]
): string | null {
  const back = devices
    .filter((d) => d.kind === 'videoinput' && BACK_LENS.test(d.label))
    // 'camera2 0, facing back' 의 앞 숫자(2)는 API 이름이라, 마지막 숫자를 렌즈 번호로 본다
    .map((d) => ({
      id: d.deviceId,
      n: Number(d.label.match(/\d+/g)?.at(-1) ?? 0),
    }))
    .sort((a, b) => a.n - b.n);
  return back[0]?.id ?? null;
}

/** 고른 렌즈가 있으면 그 렌즈를 정확히(해상도 요청은 그대로), 없으면 facingMode 로. */
export function scannerConstraintsFor(
  deviceId: string | null
): MediaStreamConstraints {
  if (!deviceId) return SCANNER_VIDEO_CONSTRAINTS;
  return {
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };
}
