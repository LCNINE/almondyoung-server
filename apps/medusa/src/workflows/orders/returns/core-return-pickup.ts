import { CoreEligibilityUnavailable } from './core-return-eligibility';
import { servedTenantHeaders } from '../../../utils/served-tenant-headers';

/** core 가 한진 취소까지 기다린다(한진 15초) — 자격 조회(5초)보다 길게 잡는다. */
const TIMEOUT_MS = 20_000;

/**
 * 반품 취소 전에 core 에 한진 회수 예약을 «놓아달라»고 동기로 묻는다(K8 PR9 N6).
 * released = 예약이 없거나 취소됐다(취소해도 된다). picked_up = 기사가 이미 가져갔다(취소하면 안 된다).
 * exchange_released = core 가 교환 대체 상자를 이미 열었다(K8 PR11 — 자격 조회 뒤에 CS 선발송이 끼었다, 취소하면 안 된다).
 * 404 는 이 라우트가 없는 옛 core — 회수 행이 있을 수 없으니 released 다. 그 밖의 실패(409 워커가 보내는 중·502 한진 취소 실패·
 * 네트워크·모양 불일치)는 «모른다» 이므로 취소를 진행하지 않게 CoreEligibilityUnavailable 로 닫는다.
 */
export async function releaseCoreReturnPickup(
  returnId: string,
): Promise<'released' | 'picked_up' | 'exchange_released'> {
  const baseUrl = process.env.CORE_SERVICE_URL;
  const key = process.env.CORE_INTERNAL_KEY;
  if (!baseUrl || !key)
    throw new CoreEligibilityUnavailable('CORE_SERVICE_URL / CORE_INTERNAL_KEY 가 설정되지 않았습니다');

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/internal/sales-orders/customer-return-pickup/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...servedTenantHeaders() },
      body: JSON.stringify({ channelReturnId: returnId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new CoreEligibilityUnavailable(`core 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 404) {
    console.warn(`core 에 회수 놓아주기 라우트가 없습니다(옛 core) — released 로 본다: ${returnId}`);
    return 'released';
  }
  if (!res.ok) throw new CoreEligibilityUnavailable(`core 응답 ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CoreEligibilityUnavailable('core 응답이 JSON 이 아닙니다');
  }
  const result = typeof body === 'object' && body !== null ? (body as { result?: unknown }).result : undefined;
  if (result !== 'released' && result !== 'picked_up' && result !== 'exchange_released')
    throw new CoreEligibilityUnavailable('core 응답 모양 불일치: result');
  return result;
}
