/**
 * 상세설명 블록 계약. 마크다운 컨테이너 디렉티브(`:::이름{속성}` … `:::`)로 쓰고,
 * 스토어프론트·어드민 렌더러가 블록마다 정해진 HTML+CSS 로 그린다.
 * 블록 밖의 일반 마크다운(제목·문단·표·이미지)은 지금처럼 그대로 그려진다.
 *
 * 스토어프론트는 이 패키지를 import 하지 못해 이름을 옮겨 적는다
 * (web/almondyoung-storefront/.../description-blocks.tsx). 바꾸면 두 곳을 같이 고친다.
 */
export const DESCRIPTION_BLOCK_NAMES = [
  'cover',
  'intro',
  'checks',
  'compare',
  'point',
  'details',
  'spec',
  'steps',
] as const;

export type DescriptionBlockName = (typeof DESCRIPTION_BLOCK_NAMES)[number];

/** details 블록 안의 옵션 카드. `::swatch{fileId=… crop=… code=… name=…}` */
export const SWATCH_DIRECTIVE_NAME = 'swatch';

export function isDescriptionBlockName(value: unknown): value is DescriptionBlockName {
  return typeof value === 'string' && (DESCRIPTION_BLOCK_NAMES as readonly string[]).includes(value);
}
