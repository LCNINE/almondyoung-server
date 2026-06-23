import { BadRequestError } from '@app/shared';
import type { TokenRequestDto } from './dto/token.dto';
import type { RevokeRequestDto } from './dto/revoke.dto';

/**
 * RFC 6749 §3.2 의 token endpoint 는 application/x-www-form-urlencoded 와 snake_case 를 표준으로 요구한다.
 * 동시에 auth-web/내부 호출자가 보내 오던 application/json + camelCase 도 호환을 위해 수용한다.
 * 글로벌 ValidationPipe 와 충돌하지 않도록 컨트롤러에서 plain body 를 받아 이 함수로 정규화한다.
 *
 * RFC 6749 §2.3.1 — confidential client 의 자격 증명은 HTTP Basic Auth 헤더로 보내는 것이 표준이고,
 * 서버는 MUST 지원해야 한다. body 의 client_secret 은 NOT RECOMMENDED 이지만 대부분 구현이 같이 받는다.
 * 따라서 헤더에서 먼저 추출 시도 → 없으면 body 의 client_secret 을 fallback 으로 본다.
 */
export function parseBasicAuthCredentials(authHeader: string | undefined): {
  clientId?: string;
  clientSecret?: string;
} {
  if (!authHeader) return {};
  const m = authHeader.match(/^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i);
  if (!m) return {};
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf-8');
  } catch {
    return {};
  }
  // RFC 6749 §2.3.1: HTTP Basic 사용 시 clientId 와 clientSecret 은 application/x-www-form-urlencoded 인코딩 후 콜론으로 결합.
  const idx = decoded.indexOf(':');
  if (idx < 0) return {};
  const clientId = decodeURIComponent(decoded.slice(0, idx));
  const clientSecret = decodeURIComponent(decoded.slice(idx + 1));
  return { clientId, clientSecret };
}

const MAX_LEN_CLIENT_ID = 64;
const MAX_LEN_SECRET = 256;
const MAX_LEN_CODE = 128;
const MAX_LEN_HANDOFF_TOKEN = 2048;
const MAX_LEN_VERIFIER = 256;
const MAX_LEN_URI = 1024;
const MAX_LEN_REFRESH = 2048;
const MAX_LEN_TOKEN = 2048;

function readString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function assertMax(value: string | undefined, max: number, name: string): void {
  if (value !== undefined && value.length > max) {
    throw new BadRequestError(`${name} too long`);
  }
}

export function normalizeTokenBody(raw: unknown): TokenRequestDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError('invalid request body');
  }
  const body = raw as Record<string, unknown>;

  const grantType = readString(body, 'grant_type', 'grantType');
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token' && grantType !== 'payment_handoff') {
    throw new BadRequestError('unsupported grant_type');
  }

  const clientId = readString(body, 'client_id', 'clientId');
  if (!clientId) throw new BadRequestError('client_id required');
  assertMax(clientId, MAX_LEN_CLIENT_ID, 'client_id');

  const clientSecret = readString(body, 'client_secret', 'clientSecret');
  assertMax(clientSecret, MAX_LEN_SECRET, 'client_secret');

  const code = readString(body, 'code');
  assertMax(code, grantType === 'payment_handoff' ? MAX_LEN_HANDOFF_TOKEN : MAX_LEN_CODE, 'code');

  const codeVerifier = readString(body, 'code_verifier', 'codeVerifier');
  assertMax(codeVerifier, MAX_LEN_VERIFIER, 'code_verifier');

  const redirectUri = readString(body, 'redirect_uri', 'redirectUri');
  assertMax(redirectUri, MAX_LEN_URI, 'redirect_uri');

  const refreshToken = readString(body, 'refresh_token', 'refreshToken');
  assertMax(refreshToken, MAX_LEN_REFRESH, 'refresh_token');

  return { grantType, clientId, clientSecret, code, codeVerifier, redirectUri, refreshToken };
}

export function normalizeRevokeBody(raw: unknown): RevokeRequestDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError('invalid request body');
  }
  const body = raw as Record<string, unknown>;

  const clientId = readString(body, 'client_id', 'clientId');
  if (!clientId) throw new BadRequestError('client_id required');
  assertMax(clientId, MAX_LEN_CLIENT_ID, 'client_id');

  const clientSecret = readString(body, 'client_secret', 'clientSecret');
  assertMax(clientSecret, MAX_LEN_SECRET, 'client_secret');

  const token = readString(body, 'token');
  if (!token) throw new BadRequestError('token required');
  assertMax(token, MAX_LEN_TOKEN, 'token');

  return { clientId, clientSecret, token };
}
