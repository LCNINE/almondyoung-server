// 인쇄 줄은 아몬드템플릿 시안(almond_design_id) 또는 고객이 올린 인쇄 파일(print_file_id)로 인쇄한다

// 템플릿으로 게시한 주문제작 상품(print_product_specs)인데 시안도 고객 파일도 없이 들어온 줄. 발주할 것이 없다
export const PRINT_SOURCE_MISSING_ERROR = 'no almond design or customer print file — check with the customer';

export const CUSTOMER_FILE_OWNER_MISMATCH_ERROR =
  'customer print file does not belong to the ordering customer — not ordered';

export const CUSTOMER_FILE_FORMAT_ERROR =
  'customer print file type is not accepted by this WowPress product — not ordered';

// 와우프레스 주문은 들어갔는데 파일을 넘기기 전에 고객 파일을 쓸 수 없게 됐다(지웠거나 비활성). 추적은 이어 간다
export const CUSTOMER_FILE_UNDELIVERED_ERROR =
  'ordered on WowPress but the customer print file is no longer available — file not delivered, check with the customer';

// 와우프레스 상품 페이지의 접수 가능 파일(2026-11-23 확인). ZIP·ALZ 는 API 업로드가 받지 않아 뺐다.
// 일반현수막(40115)은 페이지 표기와 이전 답변이 달라 확인 전까지 받지 않는다. 스토어프론트 customer-print-file.ts 와 같아야 한다
export const CUSTOMER_FILE_EXTENSIONS: Readonly<Record<number, readonly string[]>> = {
  40073: ['pdf', 'ai', 'eps'],
  40106: ['ai', 'eps', 'jpg', 'jpeg', 'png'],
  40162: ['ai', 'eps'],
  40164: ['ai', 'eps'],
  40572: ['pdf', 'ai', 'eps'],
};

export function customerFileExtension(prodno: number, fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const accepted = CUSTOMER_FILE_EXTENSIONS[prodno] ?? [];

  return fileName.includes('.') && accepted.includes(extension) ? extension : null;
}
