import { createProductImageDirective } from './directive';

const HASHTAG_LINE = /^#[^\s#]\S*(\s+#[^\s#]\S*)*\s*$/;

/**
 * 작성 단계 모델은 이미지가 많으면 절반 가까이를 본문에서 버린다(19장 중 8~10장만 썼다).
 * 프롬프트로는 못 막으므로, 한 번도 안 쓰인 이미지를 올린 순서대로 해시태그 줄 위에 덧붙인다.
 */
export function appendUnusedImages(markdown: string, fileIds: string[]): string {
  const used = new Set([...markdown.matchAll(/\bfileId="([^"]+)"/g)].map(([, fileId]) => fileId));
  const missing = [...new Set(fileIds)].filter((fileId) => !used.has(fileId));

  if (missing.length === 0) return markdown;

  const directives = missing.map((fileId) => createProductImageDirective({ fileId, alt: '' })).join('\n');
  const lines = markdown.split('\n');
  const hashtagAt = lines.findLastIndex((line) => HASHTAG_LINE.test(line.trim()));

  if (hashtagAt === -1) return `${markdown.trimEnd()}\n\n${directives}`;

  const before = lines.slice(0, hashtagAt).join('\n').trimEnd();

  return `${before}\n\n${directives}\n\n${lines.slice(hashtagAt).join('\n')}`;
}
