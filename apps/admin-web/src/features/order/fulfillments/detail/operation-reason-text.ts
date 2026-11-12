import { operationTypeLabel } from './fulfillment-labels';
import { operationReasonLabel } from './operation-reasons';

/** 화면에 보일 사유 — «기타» 는 직접 쓴 글을 뒤에 붙인다 */
export function operationReasonText(
  type: string,
  reasonCode: string | null | undefined,
  reason: string | null | undefined
): string {
  const text = reason ?? '';
  const label = operationReasonLabel(type, reasonCode, text);
  if (label === operationTypeLabel(type)) return '';
  if (reasonCode && reasonCode.toLowerCase() === 'other') {
    return text && text !== reasonCode ? `${label} · ${text}` : label;
  }
  return label;
}
