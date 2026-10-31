import { NextResponse } from 'next/server';
import { getTokenPayload } from './get-token-payload';
import {
  TENANT_HEADER,
  decideServerCredentialTenant,
  readServerCredentialTenantConfig,
  type ServerCredentialTenantDecision,
} from './server-credential-tenant';

const REJECTION_MESSAGE: Record<Extract<ServerCredentialTenantDecision, { admit: false }>['reason'], string> = {
  'not-configured': 'Tenant configuration missing',
  untenanted: 'Token has no tenant. Please sign in again.',
  'other-tenant': 'Not available for this tenant',
};

export type ServerCredentialAdmission =
  | { readonly rejection: NextResponse }
  /** 업스트림 호출에 펼친다 — T 만 섬기는 앱의 내부 키 입구는 테넌트 헤더가 T 여야 한다(`ServedTenantGate.admitService`). */
  | { readonly rejection: null; readonly tenantHeaders: Readonly<Record<string, string>> };

/**
 * 서버 자격증명으로 업스트림을 부르기 «전에» 거친다. `server-credential-routes.spec` 이 서버 자격증명을 읽는 라우트가
 * 이 함수를 부르는지 센다. `upstream` 은 warn 셈의 라벨이다.
 */
export async function admitServerCredentialTenant(
  upstream: 'medusa' | 'channel-adapter',
  headers?: Record<string, string>
): Promise<ServerCredentialAdmission> {
  const reject = (error: string, status: number) => ({ rejection: NextResponse.json({ error }, { status, headers }) });
  const config = readServerCredentialTenantConfig(process.env);
  if (!config) {
    console.error('SERVER_CREDENTIAL_TENANT_ID·TENANT_GATE_MODE are not configured — refusing server credential call');
    return reject(REJECTION_MESSAGE['not-configured'], 503);
  }
  const payload = await getTokenPayload();
  if (!payload) return reject('Unauthorized', 401);
  const decision = decideServerCredentialTenant(payload.tenant, config);
  if (!decision.admit) return reject(REJECTION_MESSAGE[decision.reason], decision.status);
  // warn 모드의 «셈» — reject 로 바꾸기 전에 이 줄이 0 에 멈췄는지 본다(CloudWatch Logs).
  if (decision.untenanted) {
    console.warn(JSON.stringify({ event: 'admin_web_untenanted_server_credential_request', upstream }));
  }
  return { rejection: null, tenantHeaders: { [TENANT_HEADER]: decision.tenantId } };
}
