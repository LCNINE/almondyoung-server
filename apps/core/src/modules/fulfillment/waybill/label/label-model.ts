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

/** 창고 프린터(XP-DT108B) 최대 인쇄폭. 프린터에 넣는 방향의 가로가 이걸 넘으면 잘려 찍힌다. */
export const PRINTER_MAX_WIDTH_MM = 108;

/**
 * 프린터에 넣을 때 시계방향 회전(도). 템플릿은 늘 포털 도면 방향대로 그리고, 넣는 방향은 형이 정한다 —
 * NS(200mm)·FS(123mm)는 긴 변이 인쇄폭을 넘어 90°, NL(100mm)은 그대로 들어가 0°.
 */
export type LabelRotation = 0 | 90;

/** 템플릿 출력. svg 의 viewBox 는 0 0 widthMm heightMm(mm 단위, 템플릿이 그린 방향)이다. */
export interface LabelSpec {
  widthMm: number;
  heightMm: number;
  rotation: LabelRotation;
  svg: string;
  barcodes: BarcodePlacement[];
}

/**
 * 바코드 인쇄 폭(mm) «상한». quiet zone 판정과 미리보기 테두리에 쓴다 — ZPL 은 프린터가 `^B2`/`^BC` 로
 * 직접 그리므로 출력에는 영향이 없다.
 *
 * ITF: start(좁은 4모듈) + 자릿수 × (좁은 3 + 넓은 2) + stop(넓은 1 + 좁은 2). 넓은 막대는 모듈 × 비를 dot 단위로 «올린» 값 — 프린터는 반 dot 를 못 찍는다(3dot × 2.5 = 7.5 → 8, zebrash 역렌더 실측 2026-09-28).
 * CODE128: subset B 기준 start·check 포함 (n + 2) 글자 × 11 + stop 13 모듈. 숫자 쌍을 subset C 로
 * 접으면 더 좁아지므로 상한이다.
 */
export function barcodeWidthMm(b: BarcodePlacement): number {
  if (b.kind === 'CODE128') return ((11 * (b.data.length + 2) + 13) * b.moduleDots) / DOTS_PER_MM;
  const wideDots = Math.ceil(b.moduleDots * (b.wideRatio ?? 2.5));
  return (
    (4 * b.moduleDots + b.data.length * (3 * b.moduleDots + 2 * wideDots) + (wideDots + 2 * b.moduleDots)) / DOTS_PER_MM
  );
}

/** 바코드 좌우에 비워 둬야 하는 quiet zone(모듈 × 10). */
export function quietZoneMm(b: BarcodePlacement): number {
  return (10 * b.moduleDots) / DOTS_PER_MM;
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
