export type PrintKind = 'card' | 'bizcard' | 'nail' | 'pet' | 'mini' | 'window' | 'menu';

export interface PrintKindProduct {
  prodno: number;
  sizeno: number;
  wsize?: number;
  hsize?: number;
  bleedMm: number;
  fileFormat: 'jpg' | 'pdf' | 'eps';
  fileDpi: number;
}

// bleedMm 은 스토어프론트 편집기(PRINT_SPECS)의 재단 여유와 같아야 bleedMatches 가 실제 편집기를 반영한다
export const PRINT_KIND_PRODUCTS: Record<PrintKind, PrintKindProduct[]> = {
  card: [{ prodno: 40073, sizeno: 5458, bleedMm: 1, fileFormat: 'pdf', fileDpi: 300 }],
  bizcard: [{ prodno: 40073, sizeno: 5458, bleedMm: 1, fileFormat: 'pdf', fileDpi: 300 }],
  nail: [{ prodno: 40073, sizeno: 7071, wsize: 90, hsize: 90, bleedMm: 1, fileFormat: 'pdf', fileDpi: 300 }],
  pet: [{ prodno: 40106, sizeno: 5670, bleedMm: 0, fileFormat: 'jpg', fileDpi: 150 }],
  mini: [
    { prodno: 40162, sizeno: 5668, bleedMm: 1.5, fileFormat: 'jpg', fileDpi: 300 },
    { prodno: 40162, sizeno: 5669, bleedMm: 1.5, fileFormat: 'jpg', fileDpi: 300 },
  ],
  window: [600, 800, 1000].map((side) => ({
    prodno: 40115,
    sizeno: 5666,
    wsize: side,
    hsize: side,
    bleedMm: 0,
    fileFormat: 'jpg' as const,
    fileDpi: 700,
  })),
  menu: [
    { prodno: 40164, sizeno: 5678, bleedMm: 3, fileFormat: 'jpg', fileDpi: 300 },
    { prodno: 40164, sizeno: 5677, bleedMm: 3, fileFormat: 'jpg', fileDpi: 300 },
    { prodno: 40164, sizeno: 5679, bleedMm: 3, fileFormat: 'jpg', fileDpi: 300 },
  ],
};
