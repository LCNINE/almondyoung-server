import { canonicalFulfillmentRequestHash } from '../../services/fulfillment-command.service';
import type { HanjinLabelContent } from '../carrier/hanjin/label/hanjin-label-data';

/**
 * 송장 내용 지문(스펙 §10.2) — 정규화 JSON(키 정렬)의 SHA-256. 매개변수가 «내용» 타입이라 출력일자·판차가
 * 섞일 수 없다(타입이 지킨다). 렌더러·출력 확인·게이트가 모두 같은 조립 결과에 이 함수를 쓴다.
 */
export function labelFingerprint(content: HanjinLabelContent): string {
  return canonicalFulfillmentRequestHash(content);
}
