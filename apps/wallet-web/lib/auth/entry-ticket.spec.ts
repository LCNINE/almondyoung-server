jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('./access-token', () => ({ verifiedAccessTokenIdentity: jest.fn() }));
jest.mock('./session-cookies', () => ({
  SESSION_COOKIE_NAMES: { ACCESS_TOKEN: 'wallet_at' },
  getBackendAuthCookie: jest.fn().mockResolvedValue('accessToken=t'),
}));
jest.mock('../wallet-api', () => ({ getPaymentIntent: jest.fn() }));
const cookieJar = new Map<string, string>();
jest.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
}));

import { maskLoginId } from '../../components/billing-account';
import { getPaymentIntent } from '../wallet-api';
import { verifiedAccessTokenIdentity } from './access-token';
import { ENTRY_TTL_SECONDS, isEntryValidFor, parseEntryTicket, rejectUnboundBillingRequest } from './entry-ticket';

describe('rejectUnboundBillingRequest', () => {
  const ticketCookie = (sub: string, id: string) =>
    Buffer.from(JSON.stringify({ id, sub, issuedAt: Date.now() }), 'utf8').toString('base64url');
  const post = (headers: Record<string, string>) => new Request('http://w/api/billing/x', { method: 'POST', headers });

  beforeEach(() => {
    cookieJar.clear();
    cookieJar.set('wallet_at', 'token');
    jest.mocked(verifiedAccessTokenIdentity).mockResolvedValue({ sub: 'user-b', loginId: 'b', name: 'B' });
  });

  it('화면을 연 진입표로 보낸 요청은 받는다', async () => {
    cookieJar.set('wallet_entry', ticketCookie('user-b', 'e-b'));

    expect(await rejectUnboundBillingRequest(post({ 'x-wallet-entry': 'e-b' }))).toBeNull();
  });

  it('A 로 연 탭에서 보냈는데 다른 탭이 세션을 B 로 바꿨으면 거절한다', async () => {
    cookieJar.set('wallet_entry', ticketCookie('user-b', 'e-b'));

    const res = await rejectUnboundBillingRequest(post({ 'x-wallet-entry': 'e-a' }));

    expect(res?.status).toBe(409);
  });

  it('로그인이 풀렸으면 401 로 돌려 재로그인 처리를 쓰게 한다', async () => {
    jest.mocked(verifiedAccessTokenIdentity).mockResolvedValue(null);

    const res = await rejectUnboundBillingRequest(post({ 'x-wallet-entry': 'e-b' }));

    expect(res?.status).toBe(401);
  });

  it('결제 뒤 등록은 그 결제 건이 세션 계정 것일 때만 받는다', async () => {
    jest.mocked(getPaymentIntent).mockResolvedValueOnce({ userId: 'user-b' } as never);
    expect(await rejectUnboundBillingRequest(post({ 'x-wallet-intent': 'pi-1' }))).toBeNull();

    jest.mocked(getPaymentIntent).mockResolvedValueOnce({ userId: 'user-a' } as never);
    expect((await rejectUnboundBillingRequest(post({ 'x-wallet-intent': 'pi-1' })))?.status).toBe(409);
  });
});

describe('entry ticket', () => {
  const now = 1_800_000_000_000;
  const ticket = { id: 'e1', sub: 'user-a', issuedAt: now };

  it('같은 계정·같은 표·유효시간 안이면 통과', () => {
    expect(isEntryValidFor(ticket, 'user-a', 'e1', now + 1000)).toBe(true);
  });

  it.each([
    ['다른 계정의 세션', 'user-b', 'e1', now],
    ['주소에 표가 없음(새로고침·즐겨찾기)', 'user-a', null, now],
    ['다른 표', 'user-a', 'e2', now],
    ['유효시간 지남', 'user-a', 'e1', now + ENTRY_TTL_SECONDS * 1000 + 1],
  ])('%s 이면 막는다', (_, sub, entryId, at) => {
    expect(isEntryValidFor(ticket, sub, entryId, at)).toBe(false);
  });

  it('등록 API 는 표 번호 없이 계정·시간만 본다', () => {
    expect(isEntryValidFor(ticket, 'user-a', undefined, now)).toBe(true);
    expect(isEntryValidFor(ticket, 'user-b', undefined, now)).toBe(false);
  });

  it('깨진 쿠키는 표가 없는 것으로 본다', () => {
    expect(parseEntryTicket('not-base64-json')).toBeNull();
    expect(parseEntryTicket(undefined)).toBeNull();
  });
});

describe('maskLoginId', () => {
  it.each([
    ['almond1717', 'almo****'],
    ['abcde', 'abcd****'],
    ['abcd', 'ab****'],
    ['ab', 'a****'],
  ])('%s → %s', (input, expected) => {
    expect(maskLoginId(input)).toBe(expected);
  });
});
