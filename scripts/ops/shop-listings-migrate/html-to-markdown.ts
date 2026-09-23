/**
 * core 샵 매매 본문(tiptap HTML)을 마크다운으로 옮긴다. 2026-09-07 실측으로 본문 태그는 <p>·<br> 뿐이었다.
 * 그 밖의 태그는 **실패**시킨다 — 모르는 태그를 조용히 벗기면 서식이 사라진 걸 아무도 모른다.
 */
export class UnsupportedHtmlError extends Error {
  constructor(readonly tag: string) {
    super(`지원하지 않는 태그: <${tag}>`);
    this.name = 'UnsupportedHtmlError';
  }
}

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ALLOWED_TAGS = new Set(['p', 'br']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+|#39);/g, (whole, body: string) => {
    if (body in NAMED_ENTITIES) return NAMED_ENTITIES[body];
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return whole;
  });
}

/** 줄 머리의 # 과 > 만 막는다. 목록(- , 1. )은 의도일 가능성이 높아 그대로 둔다. */
function escapeLineStarts(line: string): string {
  return line.replace(/^(\s*)([#>])/, '$1\\$2');
}

export function htmlToMarkdown(html: string): string {
  for (const match of html.matchAll(TAG)) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) throw new UnsupportedHtmlError(tag);
  }

  const paragraphs = html
    .replace(/<\/?br\b[^>]*>/gi, '\n')
    .split(/<\/p>/i)
    .map((chunk) => chunk.replace(/<p\b[^>]*>/gi, ''))
    .map((chunk) => decodeEntities(chunk))
    .map((chunk) =>
      chunk
        .split('\n')
        .map((line) => escapeLineStarts(line.trimEnd()))
        .join('\n')
        .trim(),
    )
    .filter((chunk) => chunk.length > 0);

  return paragraphs.join('\n\n');
}
