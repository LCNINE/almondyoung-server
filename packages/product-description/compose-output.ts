import { createProductImageDirective, PRODUCT_IMAGE_DIRECTIVE_NAME } from './directive';

const HASHTAG_LINE = /^#[^\s#]\S*(\s+#[^\s#]\S*)*\s*$/;

/**
 * 작성 단계 모델은 이미지가 많으면 절반 가까이를 본문에서 버린다(19장 중 8~10장만 썼다).
 * 프롬프트로는 못 막으므로, 통째로 한 번도 안 쓰인 이미지를 올린 순서대로 해시태그 줄 위에 덧붙인다.
 * 영역(crop)으로만 쓰인 이미지도 나머지가 빠진 것이라 전체를 붙인다.
 */
export function appendUnusedImages(markdown: string, fileIds: string[]): string {
  const used = new Set(
    [...markdown.matchAll(/\{[^}]*\}/g)]
      .map(([attrs]) => (/\bcrop="/.test(attrs) ? undefined : /\bfileId="([^"]+)"/.exec(attrs)?.[1]))
      .filter(Boolean),
  );
  const missing = [...new Set(fileIds)].filter((fileId) => !used.has(fileId));

  if (missing.length === 0) return markdown;

  const directives = missing.map((fileId) => createProductImageDirective({ fileId, alt: '' })).join('\n');
  const lines = markdown.split('\n');
  const hashtagAt = lines.findLastIndex((line) => HASHTAG_LINE.test(line.trim()));

  if (hashtagAt === -1) return `${markdown.trimEnd()}\n\n${directives}`;

  const before = lines.slice(0, hashtagAt).join('\n').trimEnd();

  return `${before}\n\n${directives}\n\n${lines.slice(hashtagAt).join('\n')}`;
}

/** 분석은 축소본으로 하고 본문은 원본을 가리키게 fileId 속성만 바꾼다. crop 은 0~1 비율이라 그대로 맞다. */
export function swapFileIds(markdown: string, fileIds: Map<string, string>): string {
  return markdown.replace(/\bfileId="([^"]+)"/g, (attr, fileId: string) => {
    const swapped = fileIds.get(fileId);

    return swapped ? `fileId="${swapped}"` : attr;
  });
}

/**
 * 원본 일부를 화면 폭으로 키우면 테두리·글씨가 어중간하게 걸려 잘려 보인다. 영역은 compare 칸과 swatch 에만 쓰고,
 * 블록 밖 이미지 줄은 crop 을 떼어 이미지 전체로 바꾼다. 그래서 같은 이미지가 두 번 나오면 뒤의 줄을 지운다.
 */
export function wholeImagesOutsideBlocks(markdown: string): string {
  const imageLine = new RegExp(`^::${PRODUCT_IMAGE_DIRECTIVE_NAME}\\{`);
  const shown = new Set<string>();
  let depth = 0;

  return markdown
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();

      if (/^:::[a-z]/.test(trimmed)) depth += 1;
      if (trimmed === ':::') depth = Math.max(0, depth - 1);
      if (depth > 0 || !imageLine.test(trimmed)) return [line];

      const whole = line.replace(/\s+crop="[^"]*"/, '');
      const fileId = /\bfileId="([^"]+)"/.exec(whole)?.[1];

      if (fileId && shown.has(fileId)) return [];
      if (fileId) shown.add(fileId);

      return [whole];
    })
    .join('\n');
}
