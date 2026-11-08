// DB·파일을 읽지 않는 판정 규칙. 여기만 유닛 테스트한다(rules.spec.ts).
import { PERMISSION_CATALOG } from '../../../libs/authorization/src/permissions/permission-catalog';

/** 카탈로그가 «첫 등록 때» 그 역할에 주게 적어 둔 권한 키. 라이브 부여의 기대값이다. */
export function catalogGrantsFor(role: string): string[] {
  return PERMISSION_CATALOG.filter((p) => (p.grantOnFirstRegistration as readonly string[]).includes(role))
    .map((p) => p.key)
    .sort();
}

/** 기대 권한 중 라이브에 없는 것. */
export function missingGrants(expected: readonly string[], granted: readonly string[]): string[] {
  const have = new Set(granted);
  return expected.filter((key) => !have.has(key));
}

/** IaC 파일에서 `KEY: '1'` 같은 자리표시 값을 찾는다. */
export function isPlaceholderEnv(iacText: string, key: string): boolean {
  return new RegExp(`${key}:\\s*'(1|[^']*dummy[^']*)'`).test(iacText);
}

/**
 * channel-capabilities.ts 에서 채널 블록의 `inventory` 축이 manual 인가.
 * 블록 경계는 «`  <채널>: {` 부터 다음 최상위 채널 키까지»로 잡는다 — 파일 모양이 바뀌면 이 함수도 바꾼다.
 */
export function channelInventoryIsManual(capabilitiesText: string, channel: string): boolean {
  const start = capabilitiesText.indexOf(`\n  ${channel}: {`);
  if (start < 0) return false;
  const rest = capabilitiesText.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}['a-z0-9]+['"]?: \{/);
  const block = next < 0 ? rest : rest.slice(0, next + 1);
  return /inventory:\s*\{\s*kind:\s*'manual'/.test(block);
}

/** adapter.module.ts 의 주문 수집 source 배열에 그 클래스가 배선돼 있나. */
export function orderSourceWired(adapterModuleText: string, sourceClass: string): boolean {
  return new RegExp(`createOrderProvider\\(\\s*\\w+\\s*,\\s*translator\\s*\\)`).test(adapterModuleText)
    ? new RegExp(`inject:\\s*\\[[^\\]]*\\b${sourceClass}\\b`).test(adapterModuleText)
    : false;
}
