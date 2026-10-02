import type { LabelSpec } from '../../../label/label-model';
import type { HanjinLabelData } from './hanjin-label-data';
import { renderHanjinFsLabel } from './hanjin-fs-template';
import { renderHanjinNlLabel } from './hanjin-nl-template';
import { renderHanjinNsLabel } from './hanjin-ns-template';

/**
 * 한진 운송장 형 → 템플릿(#913). 어느 형을 쓸지는 한진 계약·라벨지가 정하는 설정이라 env
 * `HANJIN_LABEL_TYPE` 으로 고른다(스펙 2026-09-28 §2).
 */
export const HANJIN_LABEL_TYPES = ['NS', 'NL', 'FS'] as const;
export type HanjinLabelType = (typeof HANJIN_LABEL_TYPES)[number];

/** 형 하나 = 쪽 목록(1쪽 이상). 여러 쪽은 FS 품목 줄 스펙(2026-09-28)의 추가 쪽 — NS·NL 은 늘 1쪽이다. */
export type HanjinLabelTemplate = (d: HanjinLabelData) => LabelSpec[];

export const HANJIN_LABEL_TEMPLATES: Readonly<Record<HanjinLabelType, HanjinLabelTemplate>> = {
  NS: (d) => [renderHanjinNsLabel(d)],
  NL: (d) => [renderHanjinNlLabel(d)],
  FS: renderHanjinFsLabel,
};

function isHanjinLabelType(v: string): v is HanjinLabelType {
  return HANJIN_LABEL_TYPES.some((t) => t === v);
}

/**
 * 설정값으로 템플릿을 골라 그린다. 모르는 값은 설정 오류라 `Error`(500) — 요청을 바꿔서 풀리는 문제가
 * 아니다. 검증을 부팅이 아니라 여기서 하는 건 라벨 설정 하나로 core 기동·발급을 막지 않기 위해서다.
 */
export function renderHanjinLabel(type: string, d: HanjinLabelData): LabelSpec[] {
  if (!isHanjinLabelType(type)) {
    throw new Error(`Hanjin label: unknown HANJIN_LABEL_TYPE "${type}" (expected ${HANJIN_LABEL_TYPES.join('|')})`);
  }
  return HANJIN_LABEL_TEMPLATES[type](d);
}
