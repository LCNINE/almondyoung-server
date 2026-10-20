type HeadingEntry = { id: string; level: number; text: string };

export type LooseBlock = {
  id: string;
  type: string;
  props?: { level?: number };
  content?: unknown;
  children?: LooseBlock[];
};

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return '';

  return content
    .map((item: { text?: string; content?: unknown }) =>
      typeof item.text === 'string' ? item.text : inlineText(item.content)
    )
    .join('');
}

/** 문서의 제목을 순서대로 모은다. 토글 안 제목까지 보려고 자식도 훑는다. */
export function collectHeadings(blocks: LooseBlock[]): HeadingEntry[] {
  return blocks.flatMap((block) => {
    const text = block.type === 'heading' ? inlineText(block.content).trim() : '';
    const own = text ? [{ id: block.id, level: block.props?.level ?? 1, text }] : [];

    return [...own, ...collectHeadings(block.children ?? [])];
  });
}
