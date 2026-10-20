import { NextRequest, NextResponse } from 'next/server';
import { getMyPermissions, type PermissionState } from '@/lib/auth/my-permissions.server';
import { canAny } from '@/lib/auth/screen-access';
import { forwardRequest, staffClientHeaders } from '../../_lib/forward';
import { applyMedusaPii, medusaPiiRuleFor, type MedusaAccessRecord } from './medusa-pii';
import { requiredForMedusa } from './medusa-permissions';

const MEDUSA_API_URL = process.env.MEDUSA_API_URL ?? 'http://localhost:9000';
const MEDUSA_API_KEY = process.env.MEDUSA_API_KEY ?? '';

type Params = { params: Promise<{ path: string[] }> };

function medusaExtraHeaders(): Record<string, string> | undefined {
  if (!MEDUSA_API_KEY) return undefined;
  const encoded = Buffer.from(`${MEDUSA_API_KEY}:`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

// Medusa 는 사용자 토큰이 아니라 공유 키 하나로 호출되므로, 넘기기 전에 여기서 경로별 권한을 확인한다.
type Gate = { rejection: NextResponse } | { rejection: null; permissions: ReadonlySet<string> };

async function rejectWithoutPermission(method: string, path: string[]): Promise<Gate> {
  let state: PermissionState;
  try {
    state = await getMyPermissions();
  } catch {
    return { rejection: NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 }) };
  }
  if (state.state === 'unauthenticated') {
    return { rejection: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (state.state === 'unavailable') {
    return { rejection: NextResponse.json({ error: 'Permission data is not loaded yet' }, { status: 503 }) };
  }
  const required = requiredForMedusa(method, path);
  if (!required || !canAny(state.permissions, required)) {
    return {
      rejection: NextResponse.json({ error: 'Forbidden', requiredPermissions: required ?? [] }, { status: 403 }),
    };
  }
  return { rejection: null, permissions: state.permissions };
}

const RECORD_TIMEOUT_MS = 2_000;

/** 원문을 넘기기 전에 직원 본인 토큰으로 접속기록을 남긴다 — 행위자는 user-service 가 토큰에서 정한다. */
function recorderFor(request: NextRequest) {
  return async (entry: MedusaAccessRecord): Promise<void> => {
    const base = process.env.USER_SERVICE_URL;
    if (!base) throw new Error('USER_SERVICE_URL is not configured');
    const token = request.cookies.get('accessToken')?.value ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: `accessToken=${token}` };
    for (const name of ['x-request-id', 'user-agent']) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    const res = await fetch(`${base.replace(/\/$/, '')}/iam/pii-access-logs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`pii access log answered ${res.status}`);
  };
}

/** 개인정보 경로의 JSON 응답만 가리거나 기록한다. 그 밖의 응답은 바이트 그대로 넘긴다. */
async function withPersonalDataRules(
  request: NextRequest,
  path: string[],
  permissions: ReadonlySet<string>,
  upstream: Response,
): Promise<Response> {
  const rule = medusaPiiRuleFor(request.method, path);
  const contentType = upstream.headers.get('Content-Type') ?? '';
  // 성공 응답 전부(200·201 …)가 대상이다 — 생성 응답도 고객 정보를 되돌려준다.
  const success = upstream.status >= 200 && upstream.status < 300 && upstream.status !== 204;
  if (!rule || !success || !contentType.includes('application/json')) return upstream;
  const text = await upstream.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(text, { status: upstream.status, headers: { 'Content-Type': contentType } });
  }
  const result = await applyMedusaPii({
    body,
    rule,
    method: request.method,
    queryKeys: [...new Set(request.nextUrl.searchParams?.keys() ?? [])],
    permissions,
    revealRequired: process.env.PII_REVEAL_REQUIRED === 'true',
    revealRequested: request.headers.get('x-pii-reveal') === '1',
    client: staffClientHeaders(request),
    now: new Date(),
    record: recorderFor(request),
  });
  return new Response(result.body === body ? text : JSON.stringify(result.body), {
    status: upstream.status,
    headers: { 'Content-Type': contentType, ...result.headers },
  });
}

async function forwardToMedusa(request: NextRequest, path: string[]) {
  const gate = await rejectWithoutPermission(request.method, path);
  if (gate.rejection) return gate.rejection;
  const upstream = await forwardRequest(request, MEDUSA_API_URL, path, {
    extraHeaders: medusaExtraHeaders(),
    forwardAuthCookie: false,
    ...(isTimeSaleWrite(request, path)
      ? { timeoutMs: TIME_SALE_WRITE_TIMEOUT_MS }
      : {}),
  });
  return withPersonalDataRules(request, path, gate.permissions, upstream);
}

// 타임세일 저장은 품목 수천 개의 가격표를 통째로 다시 써서 30초를 넘길 수 있다. 프록시가 먼저 끊으면
// 화면은 실패인데 서버는 끝까지 저장한다(운영자가 다시 눌러 겹친다). 서버 저장 잠금 ttl(120초)에 맞춘다.
const TIME_SALE_WRITE_TIMEOUT_MS = 120_000;

function isTimeSaleWrite(request: NextRequest, path: string[]) {
  return (
    request.method !== 'GET' && path[0] === 'admin' && path[1] === 'time-sales'
  );
}

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}
