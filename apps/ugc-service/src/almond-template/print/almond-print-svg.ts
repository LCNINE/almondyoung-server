import { BadRequestError } from '@app/shared';
import { ALMOND_DESIGN_MAX_SVG_LENGTH } from '../constants/almond-template.constants';

const SVG_START = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i;
const SVG_FORBIDDEN =
  /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|<!DOCTYPE|<\?xml-stylesheet|@import|\son[a-z]+\s*=/i;
const HREF_ATTRIBUTE = /(?<![\w-])(href\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
const PUBLIC_FILE_URL =
  /^(?:https?:\/\/[^\s/?#"'<>]+)?(?:\/[^\s?#"'<>]*)?\/files\/public\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#][^\s"'<>]*)?$/i;
const ROOT_SVG_TAG = /<svg\b[^>]*>/i;
const XML_DECLARATION = /^\s*<\?xml[^>]*\?>\s*/i;
const SIZE_MM = (attribute: 'width' | 'height'): RegExp =>
  new RegExp(`\\s${attribute}\\s*=\\s*["']\\s*(\\d+(?:\\.\\d+)?)\\s*mm\\s*["']`, 'i');
const VIEW_BOX = /\sviewBox\s*=\s*["'][^"']+["']/i;

export interface SvgSizeMm {
  width: number;
  height: number;
}

export type PrintImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

function hrefValues(svg: string): Array<string | null> {
  return [...svg.matchAll(HREF_ATTRIBUTE)].map(
    ([, , doubleQuoted, singleQuoted]) => doubleQuoted ?? singleQuoted ?? null,
  );
}

function cssUrlValues(svg: string): string[] {
  return [...svg.matchAll(CSS_URL)].map(([, , value]) => value.trim());
}

const DATA_SVG_PREFIX = /^data:image\/svg\+xml;base64,/;
const MAX_NESTED_SVG_DEPTH = 3;

function isInternalOrInline(value: string): boolean {
  return value.startsWith('#') || DATA_IMAGE.test(value);
}

function nestedSvgs(values: Array<string | null>): string[] {
  return values
    .filter((value): value is string => value !== null && DATA_SVG_PREFIX.test(value) && DATA_IMAGE.test(value))
    .map((value) => Buffer.from(value.replace(DATA_SVG_PREFIX, ''), 'base64').toString('utf8'));
}

function findUnsafeReference(svg: string, allowPublicFiles: boolean, depth: number): string | null {
  if (depth > MAX_NESTED_SVG_DEPTH) return '내장 SVG 가 너무 깊습니다';
  if (SVG_FORBIDDEN.test(svg)) return '허용하지 않는 요소나 속성이 있습니다';
  const hrefs = hrefValues(svg);
  const urls = cssUrlValues(svg);
  for (const value of hrefs) {
    if (value === null) return '따옴표 없는 href 는 허용하지 않습니다';
    if (!isInternalOrInline(value) && !(allowPublicFiles && PUBLIC_FILE_URL.test(value))) {
      return '허용하지 않는 참조가 있습니다';
    }
  }
  if (urls.some((value) => !isInternalOrInline(value))) return '허용하지 않는 url() 참조가 있습니다';
  for (const nested of nestedSvgs([...hrefs, ...urls])) {
    const reason = findUnsafeReference(nested, false, depth + 1);
    if (reason) return reason;
  }
  return null;
}

export function readSvgSizeMm(svg: string): SvgSizeMm | null {
  const root = ROOT_SVG_TAG.exec(svg)?.[0];
  if (!root || !VIEW_BOX.test(root)) return null;
  const width = SIZE_MM('width').exec(root)?.[1];
  const height = SIZE_MM('height').exec(root)?.[1];
  if (!width || !height) return null;
  const size = { width: Number(width), height: Number(height) };
  return size.width > 0 && size.height > 0 ? size : null;
}

export function assertSafeDesignSvg(svg: string, side: 'front' | 'back'): void {
  const reject = (reason: string): never => {
    throw new BadRequestError(`${side === 'front' ? '앞면' : '뒷면'} SVG 가 올바르지 않습니다: ${reason}`);
  };

  if (svg.length > ALMOND_DESIGN_MAX_SVG_LENGTH) reject('너무 큽니다');
  if (!SVG_START.test(svg)) reject('<svg 로 시작해야 합니다');
  const reason = findUnsafeReference(svg, true, 0);
  if (reason) reject(reason);
  if (!readSvgSizeMm(svg)) reject('루트에 mm 단위 width·height 와 viewBox 가 있어야 합니다');
}

export function extractPublicFileIds(svg: string): string[] {
  const ids = hrefValues(svg)
    .map((value) => (value === null ? undefined : PUBLIC_FILE_URL.exec(value)?.[1]?.toLowerCase()))
    .filter((id): id is string => id !== undefined);
  return [...new Set(ids)];
}

export function inlinePublicImages(svg: string, dataUris: ReadonlyMap<string, string>): string {
  const inlined = svg.replace(
    HREF_ATTRIBUTE,
    (match: string, prefix: string, doubleQuoted?: string, singleQuoted?: string): string => {
      const value = doubleQuoted ?? singleQuoted;
      const fileId = value === undefined ? undefined : PUBLIC_FILE_URL.exec(value)?.[1]?.toLowerCase();
      if (!fileId) return match;
      const dataUri = dataUris.get(fileId);
      if (!dataUri) throw new Error(`인라인할 이미지가 없습니다: ${fileId}`);
      return `${prefix}"${dataUri}"`;
    },
  );
  assertPrintReadySvg(inlined);
  return inlined;
}

export function assertPrintReadySvg(svg: string): void {
  const reason = findUnsafeReference(svg, false, 0);
  if (reason) throw new Error(`인쇄할 SVG 를 쓸 수 없습니다: ${reason}`);
}

export function sniffImageMime(bytes: Buffer): PrintImageMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const head = bytes
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  if (SVG_START.test(head)) return 'image/svg+xml';
  return null;
}

function prefixIds(svg: string, prefix: string): string {
  return svg
    .replace(/(\s)id\s*=\s*(["'])([^"']*)\2/g, `$1id=$2${prefix}$3$2`)
    .replace(/((?<![\w-])href\s*=\s*)(["'])#([^"']*)\2/gi, `$1$2#${prefix}$3$2`)
    .replace(/url\(\s*(["']?)#([^"')\s]*)\1\s*\)/g, `url(#${prefix}$2)`);
}

function formatMm(value: number): string {
  return String(Number(value.toFixed(3)));
}

function nestSvg(svg: string, x: number, size: SvgSizeMm, idPrefix: string): string {
  const body = prefixIds(svg.replace(XML_DECLARATION, ''), idPrefix);
  return body.replace(ROOT_SVG_TAG, (root) => {
    const stripped = root.replace(/\s(?:x|y|width|height)\s*=\s*(["'])[^"']*\1/gi, '');
    const placement = ` x="${formatMm(x)}" y="0" width="${formatMm(size.width)}" height="${formatMm(size.height)}"`;
    return stripped.replace(/^<svg\b/i, `<svg${placement}`);
  });
}

export function composeSideBySide(front: string, back: string | null, gapMm: number): string {
  const frontSize = readSvgSizeMm(front);
  const backSize = back === null ? null : readSvgSizeMm(back);
  if (!frontSize || (back !== null && !backSize)) throw new Error('SVG 루트 크기를 읽을 수 없습니다');

  const parts = [nestSvg(front, 0, frontSize, 'f-')];
  let width = frontSize.width;
  let height = frontSize.height;
  if (back !== null && backSize) {
    const x = frontSize.width + gapMm;
    parts.push(nestSvg(back, x, backSize, 'b-'));
    width = x + backSize.width;
    height = Math.max(height, backSize.height);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${formatMm(width)}mm" height="${formatMm(height)}mm" viewBox="0 0 ${formatMm(width)} ${formatMm(height)}">`,
    ...parts,
    '</svg>',
  ].join('\n');
}
