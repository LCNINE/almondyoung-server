/**
 * 공개 응답용 작성자명 마스킹. 스토어프론트 `maskName` 과 바이트 단위로 같은 규칙이다.
 *
 * 스토어프론트는 화면에서만 가리므로, 서버 컴포넌트가 내려보내는 HTML 페이로드와
 * 공개 API 에는 다른 채널 고객의 실명이 그대로 실린다. 그래서 서버에서 먼저 가린다.
 * (표시 결과가 같아야 하므로 `[...name]` 없이 인덱싱을 그대로 쓴다.)
 */
export function maskAuthorName(name: string): string {
  if (name.includes('*')) return name;
  const len = name.length;
  if (len <= 1) return name;
  if (len === 2) return name[0] + '*';
  if (len === 3) return name[0] + '**';
  return name[0] + '***' + name[len - 1];
}
