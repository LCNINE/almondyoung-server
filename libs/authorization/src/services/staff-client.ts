import { isIP } from 'node:net';

/** admin-web 프록시가 붙이는 헤더. 브라우저가 보낸 같은 이름은 프록시 허용 목록 밖이라 넘어오지 않는다. */
export const STAFF_CLIENT_IP_HEADER = 'x-staff-client-ip';
export const STAFF_FORWARDED_FOR_HEADER = 'x-staff-forwarded-for';

const MAX_FORWARDED_LENGTH = 500;

export interface StaffClient {
  /** 프록시가 «주장»한 직원 단말 주소. 백엔드를 직접 부르면 위조될 수 있어 peerIp 와 함께 남긴다. */
  readonly claimedIp: string | null;
  readonly forwardedFor: string | null;
  /** 이 서비스가 본 연결 주소. */
  readonly peerIp: string | null;
}

function headerOf(request: unknown, name: string): string | null {
  if (typeof request !== 'object' || request === null || !('headers' in request)) return null;
  const headers: unknown = request.headers;
  if (typeof headers !== 'object' || headers === null || !(name in headers)) return null;
  const value: unknown = Reflect.get(headers, name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function peerIpOf(request: unknown): string | null {
  if (typeof request !== 'object' || request === null) return null;
  if ('ip' in request && typeof request.ip === 'string' && request.ip !== '') return request.ip;
  if ('socket' in request && typeof request.socket === 'object' && request.socket !== null) {
    const address: unknown = Reflect.get(request.socket, 'remoteAddress');
    if (typeof address === 'string' && address !== '') return address;
  }
  return null;
}

export function staffClientOf(request: unknown): StaffClient {
  const claimed = headerOf(request, STAFF_CLIENT_IP_HEADER);
  const forwarded = headerOf(request, STAFF_FORWARDED_FOR_HEADER);
  return {
    claimedIp: claimed !== null && isIP(claimed) !== 0 ? claimed : null,
    forwardedFor: forwarded === null ? null : forwarded.slice(0, MAX_FORWARDED_LENGTH),
    peerIp: peerIpOf(request),
  };
}
