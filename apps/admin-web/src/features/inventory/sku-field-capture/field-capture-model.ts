import type { CompleteFieldCaptureRequest, FieldCaptureBarcodeStatus } from '@/lib/types/dto/inventory';

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
