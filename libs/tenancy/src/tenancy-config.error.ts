/**
 * 테넌트 설정이 틀렸다 — 부팅 중에 던져져 앱이 뜨지 않게 하는 것이 목적이다.
 * 틀린 곳을 한 번에 다 적는다(하나 고치고 재배포, 또 하나 고치고 재배포를 막는다).
 * 원문 값은 싣지 않는다: 목록은 비공개 Secret 이고 이 메시지는 로그로 간다.
 */
export class TenancyConfigError extends Error {
  constructor(
    readonly setting: string,
    readonly problems: readonly string[],
  ) {
    super(`${setting} 설정이 틀렸다:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'TenancyConfigError';
  }
}
