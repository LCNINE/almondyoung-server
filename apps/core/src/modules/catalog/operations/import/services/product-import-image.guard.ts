import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * 임포트 이미지 다운로드의 **네트워크 경계** 가드.
 *
 * MIME·크기 검증은 여기 없다 — file-service 가 버퍼를 콘텐츠 스니핑해 컨텍스트
 * 화이트리스트로 검증한다(upload.service.ts:51-67). core 가 맡는 것은 "이 URL 로
 * 나가도 되는가" 뿐이다.
 *
 * **DNS 재바인딩(검사 후 실제 연결에서 다른 IP 로 해석)은 막지 않는다** — 막으려면 해석한
 * IP 로 직접 연결하고 Host 헤더를 세팅해야 하는데, 이번 입력은 관리자가 올린 워크북이지
 * 임의 사용자 입력이 아니다. 리다이렉트 홉마다 재검사하는 것까지만 한다(스펙 §3.2.3).
 */
export class ImageUrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUrlBlockedError';
  }
}

/** `a.b.c.d` → 32비트 정수. 형식이 아니면 null. */
function toIpv4Int(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** [네트워크, 프리픽스길이] 목록. 사설·링크로컬·loopback·예약 대역 전부. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // 사설
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // 링크로컬 — ECS 메타데이터(169.254.170.2)·EC2 IMDS(169.254.169.254)
  ['172.16.0.0', 12], // 사설
  ['192.0.0.0', 24], // IETF 프로토콜 할당
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // 사설
  ['198.18.0.0', 15], // 벤치마크
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // 예약 + 255.255.255.255
];

function isBlockedV4(ip: string): boolean {
  const value = toIpv4Int(ip);
  if (value === null) return true;
  for (const [network, bits] of BLOCKED_V4) {
    const base = toIpv4Int(network);
    if (base === null) continue;
    // bits=0 은 목록에 없다(있으면 전부 차단이라 의미가 없다) — 시프트 32 문제도 함께 피한다.
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (base & mask)) return true;
  }
  return false;
}

/**
 * IPv4-mapped IPv6(`::ffff:1.2.3.4`) 는 벗겨서 v4 규칙으로 본다 — 벗기지 않으면
 * `::ffff:169.254.169.254` 가 "공개 IPv6" 로 통과해 가드가 통째로 무력화된다.
 */
function unmapV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const marker = '::ffff:';
  if (!lower.startsWith(marker)) return null;
  const tail = lower.slice(marker.length);
  return isIP(tail) === 4 ? tail : null;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  // 해석할 수 없으면 막는다 — 모르는 것을 통과시키는 가드는 가드가 아니다.
  if (version !== 6) return true;

  const mapped = unmapV4(ip);
  if (mapped) return isBlockedV4(mapped);

  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const head = lower.split(':')[0];
  const prefix = Number.parseInt(head === '' ? '0' : head, 16);
  if (Number.isNaN(prefix)) return true;
  if ((prefix & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((prefix & 0xffc0) === 0xfe80) return true; // fe80::/10 링크로컬
  if ((prefix & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

/**
 * 스킴을 확인하고 호스트를 해석해 **모든** 주소가 공개 대역인지 본다.
 * 하나라도 사설이면 거부한다 — 라운드로빈 DNS 로 하나만 사설을 섞는 우회를 막는다.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageUrlBlockedError(`URL 을 해석할 수 없습니다: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageUrlBlockedError(`http/https 만 허용됩니다: ${url.protocol}//…`);
  }

  // URL 의 IPv6 호스트는 대괄호로 감싸여 있다 — 벗겨야 isIP 가 인식한다.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new ImageUrlBlockedError(`사설·링크로컬 주소는 차단됩니다: ${hostname}`);
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (error) {
    throw new ImageUrlBlockedError(
      `호스트를 해석할 수 없습니다: ${hostname} (${error instanceof Error ? error.message : '알 수 없는 오류'})`,
    );
  }
  if (addresses.length === 0) {
    throw new ImageUrlBlockedError(`호스트를 해석할 수 없습니다: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new ImageUrlBlockedError(`사설·링크로컬 주소로 해석되어 차단됩니다: ${hostname} → ${address}`);
    }
  }

  return url;
}
