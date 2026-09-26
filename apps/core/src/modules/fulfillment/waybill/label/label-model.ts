/**
 * 캐리어 중립 라벨 모델. 템플릿(캐리어 전용)이 LabelSpec 을 만들고, 래스터라이저가 svg 를
 * MonoBitmap 으로, ZPL 인코더가 비트맵 + 바코드를 프린터 명령으로 바꾼다(#913).
 */

/** 203dpi 프린터는 정확히 8 dot/mm 다. */
export const DOTS_PER_MM = 8;

export function mmToDots(mm: number): number {
  return Math.round(mm * DOTS_PER_MM);
}

/** 1비트 비트맵. 1 = 검정, 행 우선, 한 바이트의 MSB 가 가장 왼쪽 픽셀, 행 끝은 바이트 경계까지 패딩. */
export interface MonoBitmap {
  widthDots: number;
  heightDots: number;
  bytesPerRow: number;
  data: Uint8Array;
}

export type BarcodeKind = 'ITF' | 'CODE128';

/** 바코드 배치. 좌표는 템플릿과 같은 가로 방향 mm, (xMm, yMm) 는 바코드 상자의 왼쪽 위. */
export interface BarcodePlacement {
  kind: BarcodeKind;
  data: string;
  xMm: number;
  yMm: number;
  heightMm: number;
  /** 좁은 막대 폭(dot). */
  moduleDots: number;
  /** ITF 넓은/좁은 막대 비(2.0~3.0). CODE128 은 쓰지 않는다. */
  wideRatio?: number;
}

/** 템플릿 출력. svg 의 viewBox 는 0 0 widthMm heightMm(mm 단위, 가로 방향)이다. */
export interface LabelSpec {
  widthMm: number;
  heightMm: number;
  svg: string;
  barcodes: BarcodePlacement[];
}

export function createBitmap(widthDots: number, heightDots: number): MonoBitmap {
  const bytesPerRow = Math.ceil(widthDots / 8);
  return { widthDots, heightDots, bytesPerRow, data: new Uint8Array(bytesPerRow * heightDots) };
}

export function getBit(b: MonoBitmap, x: number, y: number): boolean {
  return (b.data[y * b.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

export function setBit(b: MonoBitmap, x: number, y: number): void {
  b.data[y * b.bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
}
