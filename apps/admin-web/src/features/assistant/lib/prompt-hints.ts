/**
 * 입력 중 띄우는 추천어. 도구 목록(TOOL_LABELS)에 맞춰 손으로 적는다 —
 * 서버가 내려주는 값이 아니라 «무엇을 시킬 수 있는가» 의 안내문이다.
 */
export const PROMPT_HINTS: string[] = [
  '상품 목록 5개 보여줘',
  '상품 이름으로 검색해줘',
  '상품 상세 정보 알려줘',
  '상품 가격을 수정해줘',
  '상품 판매를 중지해줘',
  '삭제한 상품을 복구해줘',
  '상품 이미지를 올릴게',
  '새 상품을 등록할게',
  '내 초안 목록 보여줘',
  '초안을 발행해줘',
  '엑셀로 상품을 일괄 등록하는 방법 알려줘',
  '엑셀 양식을 알려줘',
  '일괄 등록 작업 목록 보여줘',
  '일괄 작업 진행 상태를 확인해줘',
  '충돌난 항목을 처리해줘',
  '일괄 등록을 승인해줘',
  '일괄 발행해줘',
  '일괄 작업을 취소해줘',
];

/** 입력한 조각을 품은 추천어. 앞쪽에서 걸린 것을 먼저 보여준다. */
export function matchHints(input: string, limit = 5): string[] {
  const needle = input.trim();
  if (needle.length < 1) return [];
  const hit = PROMPT_HINTS.filter((hint) => hint.includes(needle));
  if (hit.length === 0) return [];
  // 이미 추천어를 그대로 쳤으면 띄울 이유가 없다.
  if (hit.length === 1 && hit[0] === needle) return [];
  return hit
    .sort((a, b) => a.indexOf(needle) - b.indexOf(needle))
    .slice(0, limit);
}
