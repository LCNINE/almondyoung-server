import { Module } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { SCHEDULE_ROOT } from './schedule-root';

const countScheduleModules = (container: ModulesContainer): number =>
  [...container.values()].filter((moduleRef) => moduleRef.metatype?.name === 'ScheduleModule').length;

describe('SCHEDULE_ROOT (#599)', () => {
  /**
   * 이 테스트는 고칠 대상이 아니라 **근거**다. Nest 11 은 동적 모듈을 구조 해시가 아니라
   * **객체 참조**로 중복 제거한다 (`ByReferenceModuleOpaqueKeyFactory`, 기본 전략 `random`):
   * `forRoot()` 가 돌려준 객체에 id 를 도장 찍고, 도장이 없으면 새 랜덤 id 를 준다.
   *
   * 그래서 `forRoot()` 를 두 번 부르면 토큰이 달라 **모듈이 두 벌** 생기고, `ScheduleExplorer`
   * 도 둘이 되어 모든 `@Cron` 이 두 번 등록된다. Nest 10 의 기본은 구조 해시라 같은 코드가
   * 중복 제거됐다 — 그래서 이 함정은 조용히 들어왔다.
   *
   * 이 단언이 1 로 바뀌면 Nest 가 동작을 되돌린 것이므로, 그때는 `SCHEDULE_ROOT` 를 걷어내도 된다.
   */
  it('forRoot() 를 두 번 부르면 ScheduleModule 이 두 벌 생긴다 (Nest 11 동작 고정)', async () => {
    @Module({ imports: [ScheduleModule.forRoot()] })
    class Leaf {}

    @Module({ imports: [ScheduleModule.forRoot(), Leaf] })
    class Root {}

    const app = await Test.createTestingModule({ imports: [Root] }).compile();

    expect(countScheduleModules(app.get(ModulesContainer))).toBe(2);
  });

  it('여러 모듈이 SCHEDULE_ROOT 를 함께 import 하면 한 벌만 생긴다', async () => {
    @Module({ imports: [SCHEDULE_ROOT] })
    class Leaf {}

    @Module({ imports: [SCHEDULE_ROOT, Leaf] })
    class Root {}

    const app = await Test.createTestingModule({ imports: [Root] }).compile();

    expect(countScheduleModules(app.get(ModulesContainer))).toBe(1);
  });
});
