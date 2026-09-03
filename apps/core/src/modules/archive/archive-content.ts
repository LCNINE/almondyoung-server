/**
 * 본문 블록(JSON)에서 검색용 평문을 뽑는다.
 *
 * 정본은 블록 JSON 이고 평문은 파생이다. 클라이언트가 보낸 평문을 믿으면 본문과 검색이
 * 어긋날 수 있으므로 서버가 정본에서 직접 만든다. 블록 모양을 특정 에디터 스키마에
 * 묶지 않기 위해, 어떤 깊이에 있든 문자열 `text` 필드를 모아 붙이는 방식으로만 훑는다.
 */
const MAX_SEARCH_TEXT_LENGTH = 100_000;

export function extractPlainText(content: unknown): string {
  const parts: string[] = [];
  let budget = MAX_SEARCH_TEXT_LENGTH;

  const walk = (node: unknown): void => {
    if (budget <= 0 || node === null || node === undefined) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    const text = record.text;
    if (typeof text === 'string' && text.length > 0) {
      const slice = text.slice(0, budget);
      parts.push(slice);
      budget -= slice.length;
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'text') continue;
      walk(value);
    }
  };

  walk(content);

  // 조각을 이어 붙이며 들어간 구분 공백까지 상한 안에 들어와야 한다.
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_TEXT_LENGTH);
}

/** 검색 결과에 보여줄, 일치 지점 앞뒤 문맥. */
export function buildSnippet(searchText: string, query: string, radius = 60): string | null {
  if (!searchText || !query) return null;

  const index = searchText.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return null;

  const start = Math.max(0, index - radius);
  const end = Math.min(searchText.length, index + query.length + radius);

  return `${start > 0 ? '…' : ''}${searchText.slice(start, end)}${end < searchText.length ? '…' : ''}`;
}
