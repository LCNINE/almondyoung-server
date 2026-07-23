/**
 * @vitest-environment node
 *
 * 기본 jsdom 환경에서는 `import.meta.url` 이 `file://` URL 이 아니라서 아래 `fileURLToPath()` 가
 * `TypeError: The URL must be of scheme file` 로 실패한다 — 그래서 이 파일만 node 환경을 쓴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// src-tauri/capabilities/default.json 은 빌드 산출물이 아니라 소스다. build.rs 가 컴파일
// 타임에 읽어 권한 코드를 생성하고, 여기 없는 URL 은 plugin-http 가 런타임에 거부한다
// (deny-by-default) — 요청이 앱 밖으로 나가지도 않는다. 같은 디렉터리의 httpClient.ts 가
// 그 plugin-http 를 쓰므로, 이 목록이 곧 httpClient 가 도달 가능한 범위다.
const capabilityPath = fileURLToPath(
  new URL('../../../src-tauri/capabilities/default.json', import.meta.url)
);

interface HttpPermission {
  identifier: string;
  allow: { url: string }[];
}

function httpAllowList(): string[] {
  const capability = JSON.parse(readFileSync(capabilityPath, 'utf8')) as {
    permissions: (string | HttpPermission)[];
  };
  const http = capability.permissions.find(
    (p): p is HttpPermission =>
      typeof p === 'object' && p.identifier === 'http:default'
  );
  if (!http) throw new Error('http:default permission not found in default.json');
  return http.allow.map((entry) => entry.url);
}

describe('tauri http scope', () => {
  it('로컬 core 를 허용한다 — 빠지면 로컬 개발의 모든 API 호출이 차단된다', () => {
    const urls = httpAllowList();
    expect(urls).toContain('http://localhost:3100/*');
    // scope 매칭은 호스트 문자열 기준이라 localhost 항목이 127.0.0.1 을 커버하지 않는다.
    expect(urls).toContain('http://127.0.0.1:3100/*');
  });

  it('라이브 호스트를 유지한다 — tauri:dev:live 와 OIDC 토큰 교환이 쓴다', () => {
    const urls = httpAllowList();
    expect(urls).toContain('https://user.almondyoung.com/*');
    expect(urls).toContain('https://core.almondyoung.com/*');
  });

  it('호스트 와일드카드를 쓰지 않는다 — 설계에서 `http://*:3100/*` 형태를 명시적으로 기각했다 (§3.1)', () => {
    const urls = httpAllowList();
    for (const url of urls) {
      const host = url.replace(/^[a-z]+:\/\//, '').split('/')[0];
      expect(host).not.toContain('*');
    }
  });
});
