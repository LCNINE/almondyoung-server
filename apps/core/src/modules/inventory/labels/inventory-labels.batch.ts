import { BadRequestError } from '@app/shared';
import { encodeLabelRuns } from '../../../platform/label/label-document';
import type { LabelSpec } from '../../../platform/label/label-model';
import type { SvgRasterizer } from '../../../platform/label/svg-rasterizer';
import type { LabelSkipReason, Rendered } from './label-templates';

/** 라벨 ZPL 의 `^GF` 압축은 끈다 — 송장과 같은 이유(TX400 실물 확인 전). */
export const LABEL_ZPL_COMPRESS = false;
/**
 * 재고 라벨 프린터 해상도(dot/mm). 창고 라벨 칸 프린터는 300dpi 라 203dpi(8)로 보내면 0.68배로 줄어 찍혔다
 * (2026-11-24 실물: 1×3 바코드 27mm → 19mm). 송장 프린터(203dpi)는 이 값을 쓰지 않는다.
 * ponytail: 라벨 프린터가 한 종류일 때의 상수다. 해상도가 다른 라벨 프린터가 생기면 앱 설정에서 받는다.
 */
export const LABEL_DOTS_PER_MM = 12;
/** 한 요청이 찍을 수 있는 라벨 장수(장수 포함) 상한. */
export const LABEL_MAX_TOTAL = 500;
/** 항목 하나의 장수 상한. */
export const LABEL_MAX_COPIES = 200;

/** 요청 한 줄. `render` 는 상한 검사를 통과한 뒤에만 부른다. */
export interface LabelCandidate {
  /** 요청이 준 id(로케이션 id·SKU id). */
  ref: string;
  /** 로케이션 코드 또는 SKU 코드. DB 에서 못 찾았으면 null. */
  code: string | null;
  copies: number;
  /** 못 그리는 사유를 이미 아는 줄(NOT_FOUND·NO_BARCODE)은 사유만 준다. */
  render: () => Rendered | { ok: false; reason: LabelSkipReason };
}

export interface LabelSkip {
  ref: string;
  code: string | null;
  reason: LabelSkipReason;
}

export interface LabelBatch {
  format: 'zpl';
  data: string;
  labels: number;
  skipped: LabelSkip[];
}

/**
 * 라벨 묶음을 만든다. 장수 상한을 렌더 전에 먼저 검사하고(넘으면 400), 못 그린 줄은 사유와 함께 모은다.
 * 그릴 것이 없어도 에러가 아니다 — `data: ''` 와 `skipped` 만 돌려준다.
 */
export function buildLabelBatch(
  candidates: readonly LabelCandidate[],
  rasterizer: SvgRasterizer,
  compress: boolean = LABEL_ZPL_COMPRESS,
): LabelBatch {
  let total = 0;
  for (const c of candidates) {
    if (!Number.isInteger(c.copies) || c.copies < 1 || c.copies > LABEL_MAX_COPIES) {
      throw new BadRequestError(`라벨 장수는 1~${LABEL_MAX_COPIES} 사이여야 합니다.`);
    }
    total += c.copies;
  }
  if (total > LABEL_MAX_TOTAL) {
    throw new BadRequestError(`한 번에 ${LABEL_MAX_TOTAL}장까지 찍을 수 있습니다. (요청 ${total}장)`);
  }

  const runs: { spec: LabelSpec; copies: number }[] = [];
  const skipped: LabelSkip[] = [];
  let labels = 0;
  for (const c of candidates) {
    const rendered = c.render();
    if (rendered.ok) {
      runs.push({ spec: rendered.spec, copies: c.copies });
      labels += c.copies;
    } else {
      skipped.push({ ref: c.ref, code: c.code, reason: rendered.reason });
    }
  }
  return { format: 'zpl', data: encodeLabelRuns(runs, rasterizer, compress, LABEL_DOTS_PER_MM, true), labels, skipped };
}
