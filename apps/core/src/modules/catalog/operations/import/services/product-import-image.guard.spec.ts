import { isBlockedIp, assertPublicHttpUrl, ImageUrlBlockedError } from './product-import-image.guard';

describe('isBlockedIp', () => {
  it.each([
    // 이 둘이 이 가드의 존재 이유다 — ECS 태스크 메타데이터 / EC2 IMDS
    '169.254.170.2',
    '169.254.169.254',
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '0.0.0.0',
    '100.64.0.1', // CGNAT
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
    '255.255.255.255',
  ])('사설·특수 IPv4 를 막는다: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '52.78.0.1', '172.32.0.1', '172.15.255.255', '11.0.0.1'])(
    '공개 IPv4 는 통과한다: %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1'])('사설·특수 IPv6 를 막는다: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['2001:4860:4860::8888', '2606:4700::1111'])('공개 IPv6 는 통과한다: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it.each(['::ffff:169.254.169.254', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])(
    'IPv4-mapped IPv6 는 벗겨서 v4 규칙으로 본다: %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    },
  );

  it('IPv4-mapped 공개 주소는 통과한다', () => {
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('해석할 수 없는 문자열은 막는다 (모르면 막는다)', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

describe('assertPublicHttpUrl', () => {
  it('http/https 가 아니면 막는다', async () => {
    for (const bad of ['file:///etc/passwd', 'gopher://x/1', 'ftp://e.example/a.jpg']) {
      await expect(assertPublicHttpUrl(bad)).rejects.toBeInstanceOf(ImageUrlBlockedError);
    }
  });

  it('파싱 불가 URL 을 막는다', async () => {
    await expect(assertPublicHttpUrl('그냥문자열')).rejects.toBeInstanceOf(ImageUrlBlockedError);
  });

  it('IP 리터럴 호스트도 DNS 없이 바로 걸린다', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/차단/);
    await expect(assertPublicHttpUrl('http://127.0.0.1:8080/x.jpg')).rejects.toThrow(/차단/);
    await expect(assertPublicHttpUrl('http://[::1]/x.jpg')).rejects.toThrow(/차단/);
  });

  it('localhost 처럼 사설로 해석되는 이름도 막는다 (실제 DNS 해석)', async () => {
    await expect(assertPublicHttpUrl('http://localhost/x.jpg')).rejects.toThrow(/차단/);
  });

  it('해석되지 않는 호스트는 막는다', async () => {
    await expect(
      assertPublicHttpUrl('https://this-host-does-not-exist.invalid/x.jpg'),
    ).rejects.toBeInstanceOf(ImageUrlBlockedError);
  });
});
