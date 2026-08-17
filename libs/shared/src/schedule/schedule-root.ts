import { ScheduleModule } from '@nestjs/schedule';

/**
 * 앱 전체가 공유하는 **단 하나의** `ScheduleModule.forRoot()` 결과 (#599).
 *
 * Nest 11 은 동적 모듈을 구조 해시가 아니라 **객체 참조**로 중복 제거한다
 * (`ByReferenceModuleOpaqueKeyFactory`, 기본 전략 `random`): `forRoot()` 가 돌려준 객체에
 * id 를 도장 찍고, 도장이 없으면 새 랜덤 id 를 발급한다. 따라서 **`forRoot()` 를 두 번 부르면
 * 토큰이 달라 모듈이 두 벌** 생기고, `ScheduleExplorer` 도 둘이 되어 그 앱의 **모든 `@Cron` 이
 * 두 번 등록**된다. Nest 10 의 기본은 구조 해시라 같은 코드가 조용히 중복 제거됐다 — 그래서
 * 이 함정은 증상 없이 들어왔다.
 *
 * 라이브에서 channel-adapter 의 5분 주문 폴러가 사이클마다 2회 돌던 원인이 이것이다.
 *
 * **`ScheduleModule.forRoot()` 를 직접 부르지 말고 이 상수를 import 할 것.** 모듈이 여러 곳에서
 * import 해도 참조가 같으므로 한 벌만 생긴다. `global: true` 라 앱 어디서든 한 번이면 충분하다.
 * 회귀는 `schedule-root.spec.ts` 와 `no-direct-schedule-forroot.spec.ts` 가 막는다.
 */
export const SCHEDULE_ROOT = ScheduleModule.forRoot();
