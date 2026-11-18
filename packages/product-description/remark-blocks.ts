import { isDescriptionBlockName, SWATCH_DIRECTIVE_NAME, type DescriptionBlockName } from './blocks';
import { formatImageCrop, parseProductImageDirective, PRODUCT_IMAGE_DIRECTIVE_NAME } from './directive';

/**
 * 상세설명 마크다운의 디렉티브를 렌더러가 그릴 수 있는 mdast 로 바꾸는 remark 플러그인.
 * 스토어프론트와 어드민 미리보기가 같은 함수를 써서 두 화면이 같은 HTML 을 낸다.
 *
 * unified 에 의존하지 않도록 노드를 평범한 객체로 다룬다 — 이 패키지는 ai 앱(Nest)도 import 한다.
 * 블록은 `data.hName`/`hProperties` 로 HTML 태그와 클래스만 정하고, 모양은 각 앱의 CSS 가 맡는다.
 */
export type DescriptionMdastNode = {
  type: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
  children?: DescriptionMdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  url?: string;
  alt?: string | null;
  value?: string;
  depth?: number;
};

export type RemarkProductDescriptionOptions = {
  resolveImageUrl: (fileId: string) => string;
};

const DIRECTIVE_TYPES = new Set(['leafDirective', 'textDirective', 'containerDirective']);

export function remarkProductDescription({ resolveImageUrl }: RemarkProductDescriptionOptions) {
  return () => (tree: DescriptionMdastNode) => {
    transformChildren(tree, resolveImageUrl);
  };
}

function transformChildren(node: DescriptionMdastNode, resolveImageUrl: (fileId: string) => string) {
  if (!node.children) return;

  node.children = node.children.flatMap((child) => {
    transformChildren(child, resolveImageUrl);

    if (!DIRECTIVE_TYPES.has(child.type)) return [child];

    if (child.name === PRODUCT_IMAGE_DIRECTIVE_NAME) return imageOrNothing(child, resolveImageUrl);

    if (child.name === SWATCH_DIRECTIVE_NAME) return swatch(child, resolveImageUrl);

    if (child.type === 'containerDirective' && isDescriptionBlockName(child.name)) {
      return [block(child.name, child, resolveImageUrl)];
    }

    return restoreUnknownDirective(child);
  });
}

/**
 * 우리가 쓰지 않는 디렉티브는 원래 글자로 되돌린다. remark-directive 는 "MU:A" 의 ":A" 나
 * "10:30" 같은 평범한 글자도 텍스트 디렉티브로 읽는데, 그대로 두면 화면에서 글자가 사라진다.
 */
function restoreUnknownDirective(node: DescriptionMdastNode): DescriptionMdastNode[] {
  const children = node.children ?? [];

  if (node.type === 'textDirective') {
    const label = children.length ? [{ type: 'text', value: '[' }, ...children, { type: 'text', value: ']' }] : [];

    return [{ type: 'text', value: `:${node.name ?? ''}` }, ...label];
  }

  if (node.type === 'leafDirective') {
    return [{ type: 'paragraph', children: [{ type: 'text', value: `::${node.name ?? ''}` }, ...children] }];
  }

  return children;
}

/** 깨진 이미지 디렉티브는 조용히 뺀다 — 고객 화면에 진단 UI 를 띄울 이유가 없다. */
function imageOrNothing(node: DescriptionMdastNode, resolveImageUrl: (fileId: string) => string) {
  const parsed = parseProductImageDirective(node);
  if (!parsed.ok) return [];

  return [image(parsed.fileId, parsed.alt, parsed.crop && formatImageCrop(parsed.crop), resolveImageUrl)];
}

function image(
  fileId: string,
  alt: string,
  crop: string | undefined,
  resolveImageUrl: (fileId: string) => string,
  className?: string,
): DescriptionMdastNode {
  const hProperties: Record<string, unknown> = {};
  if (crop) hProperties.dataCrop = crop;
  if (className) hProperties.className = [className];

  return { type: 'image', url: resolveImageUrl(fileId), alt, data: { hProperties } };
}

function swatch(node: DescriptionMdastNode, resolveImageUrl: (fileId: string) => string): DescriptionMdastNode[] {
  const parsed = parseProductImageDirective({ name: PRODUCT_IMAGE_DIRECTIVE_NAME, attributes: node.attributes });
  const code = text(node.attributes?.code);
  const name = text(node.attributes?.name);
  if (!parsed.ok || !name) return [];

  const caption: DescriptionMdastNode[] = code
    ? [{ type: 'strong', children: [{ type: 'text', value: code }] }, { type: 'text', value: ` ${name}` }]
    : [{ type: 'text', value: name }];

  return [
    element('figure', 'pd-swatch', [
      image(parsed.fileId, parsed.alt || name, parsed.crop && formatImageCrop(parsed.crop), resolveImageUrl),
      { type: 'paragraph', data: { hName: 'figcaption' }, children: caption },
    ]),
  ];
}

function block(
  name: DescriptionBlockName,
  node: DescriptionMdastNode,
  resolveImageUrl: (fileId: string) => string,
): DescriptionMdastNode {
  const attrs = node.attributes ?? {};
  const children = node.children ?? [];

  switch (name) {
    case 'cover': {
      const parsed = parseProductImageDirective({ name: PRODUCT_IMAGE_DIRECTIVE_NAME, attributes: attrs });
      const kicker = text(attrs.kicker);
      const body = element('div', 'pd-cover-body', [...(kicker ? [paragraph(kicker, 'pd-kicker')] : []), ...children]);
      const cover = parsed.ok ? [image(parsed.fileId, parsed.alt, undefined, resolveImageUrl, 'pd-cover-img')] : [];

      return section(name, [...cover, body]);
    }
    case 'compare': {
      const label = text(attrs.label);

      return section(name, [...(label ? [paragraph(label, 'pd-label')] : []), ...groupImages(children, 'pd-duo')]);
    }
    case 'point': {
      const no = text(attrs.no);

      return section(name, [...(no ? [paragraph(`POINT ${no}`, 'pd-no')] : []), ...children]);
    }
    case 'details': {
      const title = text(attrs.title);
      const subtitle = text(attrs.subtitle);
      const head = [...(title ? [heading(title, 'pd-title')] : []), ...(subtitle ? [paragraph(subtitle, 'pd-subtitle')] : [])];

      return section(name, [...head, ...groupNodes(children, (child) => child.data?.hName === 'figure', 'pd-swatches')]);
    }
    case 'checks':
    case 'spec': {
      const title = text(attrs.title);

      return section(name, [...(title ? [heading(title, 'pd-title')] : []), ...children]);
    }
    case 'intro':
      return section(name, children);
  }
}

/** 연달아 나오는 이미지를 한 줄짜리 격자로 묶는다. 문단 하나에 이미지만 든 경우도 이미지로 본다. */
function groupImages(children: DescriptionMdastNode[], className: string) {
  const flattened = children.flatMap((child) =>
    child.type === 'paragraph' && child.children?.length && child.children.every((c) => c.type === 'image')
      ? child.children
      : [child],
  );

  return groupNodes(flattened, (child) => child.type === 'image', className);
}

function groupNodes(
  children: DescriptionMdastNode[],
  belongs: (child: DescriptionMdastNode) => boolean,
  className: string,
) {
  const out: DescriptionMdastNode[] = [];
  let group: DescriptionMdastNode | null = null;

  for (const child of children) {
    if (!belongs(child)) {
      group = null;
      out.push(child);
      continue;
    }

    if (!group) {
      group = element('div', className, []);
      out.push(group);
    }

    group.children?.push(child);
  }

  return out;
}

function section(name: DescriptionBlockName, children: DescriptionMdastNode[]): DescriptionMdastNode {
  return {
    type: 'productDescriptionBlock',
    data: { hName: 'section', hProperties: { className: ['not-prose', 'pd-block', `pd-${name}`] } },
    children,
  };
}

function element(hName: string, className: string, children: DescriptionMdastNode[]): DescriptionMdastNode {
  return { type: 'productDescriptionGroup', data: { hName, hProperties: { className: [className] } }, children };
}

function paragraph(value: string, className: string): DescriptionMdastNode {
  return { type: 'paragraph', data: { hProperties: { className: [className] } }, children: [{ type: 'text', value }] };
}

function heading(value: string, className: string): DescriptionMdastNode {
  return {
    type: 'heading',
    depth: 3,
    data: { hProperties: { className: [className] } },
    children: [{ type: 'text', value }],
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
