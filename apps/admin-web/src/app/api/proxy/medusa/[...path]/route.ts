import { NextRequest, NextResponse } from 'next/server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { forwardRequest } from '../../_lib/forward';

const MEDUSA_API_URL = process.env.MEDUSA_API_URL ?? 'http://localhost:9000';
const MEDUSA_API_KEY = process.env.MEDUSA_API_KEY ?? '';

type Params = { params: Promise<{ path: string[] }> };

function medusaExtraHeaders(): Record<string, string> | undefined {
  if (!MEDUSA_API_KEY) return undefined;
  const encoded = Buffer.from(`${MEDUSA_API_KEY}:`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

// Medusa 는 사용자 토큰이 아니라 공유 키 하나로 호출되므로, 넘기기 전에 여기서 직원 세션을 확인한다.
const STAFF_ROLES = ['admin', 'master'];

async function rejectNonStaff(): Promise<NextResponse | null> {
  let payload;
  try {
    payload = await getTokenPayload();
  } catch {
    return NextResponse.json(
      { error: 'Authentication unavailable' },
      { status: 503 }
    );
  }
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!payload.roles.some((role) => STAFF_ROLES.includes(role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

async function forwardToMedusa(request: NextRequest, path: string[]) {
  const rejection = await rejectNonStaff();
  if (rejection) return rejection;
  return forwardRequest(request, MEDUSA_API_URL, path, {
    extraHeaders: medusaExtraHeaders(),
    forwardAuthCookie: false,
    ...(isTimeSaleWrite(request, path)
      ? { timeoutMs: TIME_SALE_WRITE_TIMEOUT_MS }
      : {}),
  });
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
