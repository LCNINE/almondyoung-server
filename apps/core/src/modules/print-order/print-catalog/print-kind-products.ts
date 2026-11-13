export type PrintKind = 'card' | 'bizcard' | 'nail' | 'pet' | 'mini' | 'window' | 'menu';

export interface PrintKindProduct {
  prodno: number;
  sizeno: number;
  wsize?: number;
  hsize?: number;
  bleedMm: number;
  fileFormat: 'jpg' | 'pdf' | 'eps';
  fileDpi: number;
  // 기본으로 고를 후가공. 필수 그룹의 기본값이 되고, 하나 이상 필수인 묶음에서는 이 값이 든 그룹을 필수로 둔다
  awkDefaults?: number[];
  // 우리 인쇄 파일로 만들 수 없는 도수
  excludeColors?: number[];
}

// 미니 투명배너 백색 도수는 화이트 레이어가 따로 든 AI·EPS 를 요구한다(방울이 답변 2026-11-13)
const MINI_WHITE_COLOR = 1355;
// 거치대에 걸려면 구멍이 있어야 한다
const MINI_CORNER_HOLES = 11804;
// 일반현수막은 후가공 하나 이상 필수. 유리창에 붙이므로 나무봉·아일렛 없이 열재단만 한다
const BANNER_HEAT_CUT = 11411;

// bleedMm 은 스토어프론트 편집기(PRINT_SPECS)의 재단 여유와 같아야 bleedMatches 가 실제 편집기를 반영한다
export const PRINT_KIND_PRODUCTS: Record<PrintKind, PrintKindProduct[]> = {
  card: [{ prodno: 40073, sizeno: 5458, bleedMm: 1, fileFormat: 'pdf', fileDpi: 300 }],
  bizcard: [{ prodno: 40073, sizeno: 5458, bleedMm: 1, fileFormat: 'pdf', fileDpi: 300 }],
  nail: [{ prodno: 40073, sizeno: 7071, wsize: 90, hsize: 90, bleedMm: 1, fileFormat: 'pdf', fileDpi: 300 }],
  pet: [{ prodno: 40106, sizeno: 5670, bleedMm: 0, fileFormat: 'jpg', fileDpi: 150 }],
  // 미니 투명배너는 AI·EPS 만 받는다(방울이 답변 2026-11-13)
  mini: [5668, 5669].map((sizeno) => ({
    prodno: 40162,
    sizeno,
    bleedMm: 1.5,
    fileFormat: 'eps' as const,
    fileDpi: 300,
    awkDefaults: [MINI_CORNER_HOLES],
    excludeColors: [MINI_WHITE_COLOR],
  })),
  window: [600, 800, 1000].map((side) => ({
    prodno: 40115,
    sizeno: 5666,
    wsize: side,
    hsize: side,
    bleedMm: 0,
    fileFormat: 'jpg' as const,
    fileDpi: 700,
    awkDefaults: [BANNER_HEAT_CUT],
  })),
  // 포맥스보드는 AI·EPS 만 받는다(방울이 답변 2026-11-13)
  menu: [5678, 5677, 5679].map((sizeno) => ({
    prodno: 40164,
    sizeno,
    bleedMm: 3,
    fileFormat: 'eps' as const,
    fileDpi: 300,
  })),
};
