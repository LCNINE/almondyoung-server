export const PRINT_KINDS = ['card', 'bizcard', 'nail', 'pet', 'mini', 'window', 'menu'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

export interface PrintSizeDto {
  /** 가로 mm */
  width: number;
  /** 세로 mm */
  height: number;
}

/** 주제품에 붙여 파는 와우프레스 부자재 선택지. qty 가 'perBanner' 면 배너 수량만큼 */
export interface PrintAccessoryChoiceDto {
  key: string;
  label: string;
  prodno: number;
  sizeno?: number | 'banner';
  qty: number | 'perBanner';
  /** 한 개 판매가(원, 부가세 포함) */
  unitPrice: number;
}

export interface PrintAccessoryAxisDto {
  key: string;
  group: string;
  choices: PrintAccessoryChoiceDto[];
}

/** core `GET /admin/print-catalog/:kind/options` */
export interface PrintOptionsDto {
  prodno: number;
  prodname: string;
  cutsizeHalfMm: number;
  papers: { paperno: number; label: string }[];
  colors: { colorno: number; label: string; jobno: number }[];
  quantities: { key: string; values: number[] }[];
  requiredAwk: { group: string; options: { jobno: number; label: string }[]; defaultJobno: number }[];
  forbiddenAwk: { jobno: number; reason: string }[];
  bleedMatches: boolean;
  accessoryAxes: PrintAccessoryAxisDto[];
}

export interface PrintComboDto {
  key: string;
  paperno: number;
  colorno: number;
  qty: number;
  awk: number[];
  /** 부자재 축마다 고른 선택지 키 */
  accessories?: string[];
}

/** core `POST /admin/print-catalog/:kind/quotes` 요청 */
export interface PrintQuotesBodyDto extends PrintSizeDto {
  combos: PrintComboDto[];
}

export type PrintQuoteVerdictDto = { ok: true; supply: number; bill: number } | { ok: false; reason: string };

export interface PrintQuoteDto {
  key: string;
  verdict: PrintQuoteVerdictDto;
}

export interface PrintOptionLabelsDto {
  paper: string;
  side: string;
  qty: string;
  /** 부자재 옵션 축 표시(예: 거치대 · 1개) */
  extras?: { group: string; value: string }[];
}

export interface PublishPrintComboDto extends PrintComboDto {
  /** 판매가(원) */
  price: number;
  /** 멤버십가(원). 없으면 null */
  memberPrice: number | null;
  optionLabels: PrintOptionLabelsDto;
}

/** core `POST /admin/print-catalog/publish` 요청 */
export interface PublishPrintProductDto extends PrintSizeDto {
  templateId: string;
  kind: PrintKind;
  name: string;
  description: string;
  /** 템플릿 미리보기 이미지 fileId */
  thumbnailFileId: string;
  combos: PublishPrintComboDto[];
}

export interface PublishPrintProductResultDto {
  masterId: string;
  created: boolean;
}

/** core `POST /admin/print-catalog/republish` 요청. 이미 게시한 상품에 새 버전을 만든다 */
export interface RepublishPrintProductDto extends PublishPrintProductDto {
  masterId: string;
}

export interface RepublishPrintProductResultDto {
  masterId: string;
  versionId: string;
}
