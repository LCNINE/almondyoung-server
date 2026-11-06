export const PRINT_KINDS = ['card', 'bizcard', 'nail', 'pet', 'mini', 'window', 'menu'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

export interface PrintSizeDto {
  /** 가로 mm */
  width: number;
  /** 세로 mm */
  height: number;
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
}

export interface PrintComboDto {
  key: string;
  paperno: number;
  colorno: number;
  qty: number;
  awk: number[];
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
