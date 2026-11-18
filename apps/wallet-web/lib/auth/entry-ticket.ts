import 'server-only';

import { randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

import { verifiedAccessTokenIdentity } from './access-token';
import { getPaymentIntent } from '../wallet-api';
import { SESSION_COOKIE_NAMES, getBackendAuthCookie } from './session-cookies';

// 결제수단 등록은 결제 건(intent)의 주인 확인 없이 세션 계정에 바로 붙는다. 그래서 쇼핑몰이 지금 고객을
// 보증한 직후(핸드오프·로그인 콜백)에만 진입표를 주고, 등록 화면과 등록 요청이 그 표를 본다.
const ENTRY_COOKIE = 'wallet_entry';
export const ENTRY_QUERY_PARAM = 'entry';
export const ENTRY_TTL_SECONDS = 30 * 60;

export interface EntryTicket {
  id: string;
  sub: string;
  issuedAt: number;
}

type Jar = {
  set(name: string, value: string, options?: { httpOnly?: boolean; secure?: boolean; sameSite?: 'lax'; path?: string; maxAge?: number }): unknown;
};

export function createEntryTicketId(): string {
  return randomBytes(16).toString('base64url');
}

export function writeEntryTicket(jar: Jar, ticket: EntryTicket): void {
  jar.set(ENTRY_COOKIE, Buffer.from(JSON.stringify(ticket), 'utf8').toString('base64url'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ENTRY_TTL_SECONDS,
  });
}

export function parseEntryTicket(raw: string | undefined): EntryTicket | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<EntryTicket>;
    if (typeof parsed.id !== 'string' || typeof parsed.sub !== 'string' || typeof parsed.issuedAt !== 'number') return null;

    return { id: parsed.id, sub: parsed.sub, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}

/** 진입표가 지금 세션 계정의 것이고 아직 유효한지. `entryId` 를 주면 그 표인지까지 본다. */
export function isEntryValidFor(
  ticket: EntryTicket | null,
  sub: string | null,
  entryId?: string | null,
  now = Date.now(),
): boolean {
  if (!ticket || !sub || ticket.sub !== sub) return false;
  if (now - ticket.issuedAt > ENTRY_TTL_SECONDS * 1000) return false;
  if (entryId !== undefined && ticket.id !== entryId) return false;

  return true;
}

export const ENTRY_HEADER = 'x-wallet-entry';
export const INTENT_HEADER = 'x-wallet-intent';

/**
 * 등록·변경 API 가 앞에 둔다. 요청이 그 화면을 연 계정에 묶여 있어야 받는다.
 * - 등록 화면(/billing-change): 화면을 그릴 때의 진입표 id 를 실어 보낸다. 다른 탭이 세션을 바꿨으면 표가 달라 거절된다.
 * - 결제 뒤 등록(/pay/…/billing-setup): 결제 건 id 를 실어 보낸다. 그 결제 건이 지금 세션 계정 것이어야 한다.
 * 로그인이 풀린 것은 401 로 돌려 화면의 재로그인 처리를 그대로 쓴다.
 */
export async function rejectUnboundBillingRequest(request: Request): Promise<Response | null> {
  const jar = await cookies();
  const identity = await verifiedAccessTokenIdentity(jar.get(SESSION_COOKIE_NAMES.ACCESS_TOKEN)?.value);
  if (!identity) {
    return Response.json({ error: '로그인이 필요해요.', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const entryId = request.headers.get(ENTRY_HEADER);
  if (entryId && isEntryValidFor(parseEntryTicket(jar.get(ENTRY_COOKIE)?.value), identity.sub, entryId)) {
    return null;
  }

  const intentId = request.headers.get(INTENT_HEADER);
  if (intentId && (await intentOwner(intentId)) === identity.sub) {
    return null;
  }

  return Response.json(
    { error: '확인 시간이 지났어요. 쇼핑몰에서 결제수단 등록을 다시 시작해 주세요.', code: 'ENTRY_EXPIRED' },
    { status: 409 },
  );
}

async function intentOwner(intentId: string): Promise<string | null> {
  try {
    const intent = await getPaymentIntent(intentId, await getBackendAuthCookie());

    return intent.userId ?? null;
  } catch {
    return null;
  }
}

export async function readEntryTicket(): Promise<EntryTicket | null> {
  const jar = await cookies();

  return parseEntryTicket(jar.get(ENTRY_COOKIE)?.value);
}
