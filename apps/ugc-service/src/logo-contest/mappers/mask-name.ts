/**
 * 작성자명 가리기. 리뷰는 실명을 내려보내고 스토어프론트가 가렸는데, 그러면 개발자도구로
 * 원본이 보인다 — 공모전은 서버가 가린 값만 내려보낸다.
 *
 * 규칙은 스토어프론트 `components/reviews/utils` 의 `maskName` 과 같다.
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  const len = trimmed.length;
  if (len <= 1) return trimmed;
  if (len === 2) return `${trimmed[0]}*`;
  if (len === 3) return `${trimmed[0]}**`;
  return `${trimmed[0]}***${trimmed[len - 1]}`;
}
