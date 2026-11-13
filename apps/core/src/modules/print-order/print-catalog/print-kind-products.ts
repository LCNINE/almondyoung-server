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

// 주제품과 같은 주문으로 붙여 보내는 와우프레스 부자재(문서 §7.5 prodaddinfo). 없음은 따로 두지 않고 고르지 않은 것으로 본다.
// qty 가 'perBanner' 면 배너 수량만큼, 숫자면 배너 수량과 상관없이 그 개수다. unitPrice 는 한 개 판매가(부가세 포함)다
export interface PrintAccessoryChoice {
  key: string;
  label: string;
  prodno: number;
  // 'banner' 는 주제품과 같은 규격 번호(미니배너 거치대 150x300 / 180x420)
  sizeno?: number | 'banner';
  qty: number | 'perBanner';
  unitPrice: number;
  // 이 부자재를 쓰려고 주제품에 함께 넣는 후가공(큐방을 꽂을 아일렛·보드타공)
  awk?: number[];
}

export interface PrintAccessoryAxis {
  key: string;
  group: string;
  choices: PrintAccessoryChoice[];
}

export const ACCESSORY_PRESET = '30';
const QBANG = 40080;

// 큐방은 아일렛·구멍에 꽂아 쓴다(와우프레스 상품 설명). 구멍이 없는 종류는 같은 개수의 구멍 후가공을 함께 넣고,
// 그 원가를 개당 판매가에 넣는다(2026-11-13 견적: 현수막 아일렛 4개 +1,650원, 포맥스 보드타공 4개 +2,200원)
const qbang = (holes: Record<number, number[]>, unitPrice: number): PrintAccessoryAxis => ({
  key: 'qbang',
  group: '큐방',
  choices: Object.entries(holes).map(([count, awk]) => ({
    key: `qbang-${count}`,
    label: awk.length > 0 ? `${count}개 (구멍 ${count}개 포함)` : `${count}개`,
    prodno: QBANG,
    qty: Number(count),
    unitPrice,
    ...(awk.length > 0 ? { awk } : {}),
  })),
});

// 현수막 아일렛 42101=4개, 42103=8개, 42105=12개 / 포맥스 보드타공 43336=4개, 43340=8개
const BANNER_EYELETS: Record<number, number[]> = { 4: [42101], 8: [42103], 12: [42105] };
const BOARD_HOLES: Record<number, number[]> = { 4: [43336], 8: [43340] };

// 일반명함은 와우프레스가 종이 명함케이스 1개를 기본으로 넣어 주므로(상품 페이지 안내) 추가 케이스만 판다
const cardCases: PrintAccessoryAxis = {
  key: 'case',
  group: '명함케이스 추가',
  choices: [
    { key: 'clear-1', label: '반투명 케이스(100매용) 1개', prodno: 40124, sizeno: 7037, qty: 1, unitPrice: 500 },
    { key: 'clear-2', label: '반투명 케이스(100매용) 2개', prodno: 40124, sizeno: 7037, qty: 2, unitPrice: 500 },
    { key: 'premium-1', label: '프리미엄 케이스(100매용) 1개', prodno: 40590, sizeno: 7037, qty: 1, unitPrice: 1500 },
    { key: 'premium-2', label: '프리미엄 케이스(100매용) 2개', prodno: 40590, sizeno: 7037, qty: 2, unitPrice: 1500 },
  ],
};

export const PRINT_KIND_ACCESSORIES: Partial<Record<PrintKind, PrintAccessoryAxis[]>> = {
  card: [cardCases],
  bizcard: [cardCases],
  mini: [
    {
      key: 'stand',
      group: '거치대',
      choices: [1, 2, 3, 5, 10].map((n) => ({
        key: `stand-${n}`,
        label: `${n}개`,
        prodno: 40119,
        sizeno: 'banner' as const,
        qty: n,
        unitPrice: 2200,
      })),
    },
  ],
  pet: [
    {
      key: 'stand',
      group: '거치대',
      choices: [
        { key: 'indoor', label: '실내용 일반형', prodno: 40586, sizeno: 7137, qty: 'perBanner', unitPrice: 13000 },
        { key: 'indoor-premium', label: '실내용 고급형', prodno: 40121, sizeno: 7137, qty: 'perBanner', unitPrice: 17000 },
        { key: 'outdoor', label: '실외용 단면', prodno: 40120, sizeno: 7137, qty: 'perBanner', unitPrice: 27000 },
      ],
    },
    // PET 는 아일렛 4개가 기본이라 큐방만 붙인다
    qbang({ 4: [], 8: [] }, 500),
  ],
  window: [qbang(BANNER_EYELETS, 1000)],
  menu: [qbang(BOARD_HOLES, 1200)],
};

export function accessoryCount(choice: PrintAccessoryChoice, bannerQty: number): number {
  return choice.qty === 'perBanner' ? bannerQty : choice.qty;
}


