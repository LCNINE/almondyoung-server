import { Global, Injectable, Module } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@app/db';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { CronOnce } from './cron-once.decorator';
import { CronOnceModule } from './cron-once.module';
import { CronRunClaimer } from './cron-run.claimer';

/** 절대 발화하지 않는 크론식 — 등록만 검사한다. */
const NEVER = '0 0 0 29 2 1';

const fakeDb = { provide: DbService, useValue: { db: { execute: jest.fn().mockResolvedValue([]) } } };

/**
 * 실제 앱에서 `DbService` 는 `DbModule.forRoot` 라는 **글로벌** 모듈이 export 한다
 * (`cron-once.module.ts` 의 docblock). 테스트에서도 같은 모양으로 흉내내야 `CronOnceModule`
 * 안의 `CronRunClaimer` 가 `DbService` 를 볼 수 있다 — 형제 모듈의 `providers` 배열에
 * 값을 얹는 것만으로는 안 된다: Nest 는 모듈 경계를 참조(imports/exports)로만 넘고,
 * 이 저장소가 도는 Nest 11.1.17 에서 형제 모듈의 로컬 provider 는 서로 보이지 않는다
 * (직접 격리 재현으로 확인). `@CronOnce` 앱들이 이미 `DbModule.forRoot()` 를 전역으로 두는
 * 컨벤션과 동형이다.
 */
@Global()
@Module({ providers: [fakeDb], exports: [DbService] })
class FakeDbModule {}

describe('CronOnceExplorer', () => {
  let app: TestingModule | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('@CronOnce 메서드를 이름으로 SchedulerRegistry 에 등록하고 시작한다', async () => {
    @Injectable()
    class Jobs {
      @CronOnce(NEVER, { name: 'alpha' })
      async a(): Promise<void> {}
      @CronOnce(NEVER, { name: 'beta', timeZone: 'Asia/Seoul' })
      async b(): Promise<void> {}
      async notACron(): Promise<void> {}
    }
    @Module({ imports: [SCHEDULE_ROOT, CronOnceModule, FakeDbModule], providers: [Jobs] })
    class Root {}

    app = await Test.createTestingModule({ imports: [Root] }).compile();
    await app.init();

    const registry = app.get(SchedulerRegistry);
    expect([...registry.getCronJobs().keys()].sort()).toEqual(['alpha', 'beta']);
    expect(registry.getCronJob('alpha').isActive).toBe(true);
  });

  it('같은 이름이 둘이면 부팅에서 throw 한다 (#599 의 «조용한 두 벌» 을 시끄럽게)', async () => {
    @Injectable()
    class A {
      @CronOnce(NEVER, { name: 'dup' })
      async run(): Promise<void> {}
    }
    @Injectable()
    class B {
      @CronOnce(NEVER, { name: 'dup' })
      async run(): Promise<void> {}
    }
    @Module({ imports: [SCHEDULE_ROOT, CronOnceModule, FakeDbModule], providers: [A, B] })
    class Root {}

    const building = Test.createTestingModule({ imports: [Root] }).compile();
    await expect(building.then((m) => m.init())).rejects.toThrow(/dup/);
  });

  it('등록된 콜백은 러너를 거친다 — 선점 실패면 본문이 안 돈다', async () => {
    const calls: string[] = [];
    @Injectable()
    class Jobs {
      @CronOnce(NEVER, { name: 'gated' })
      async run(): Promise<void> {
        calls.push('ran');
      }
    }
    @Module({ imports: [SCHEDULE_ROOT, CronOnceModule, FakeDbModule], providers: [Jobs] })
    class Root {}

    app = await Test.createTestingModule({ imports: [Root] }).compile();
    await app.init();
    jest.spyOn(app.get(CronRunClaimer), 'claim').mockResolvedValue(false);

    await app.get(SchedulerRegistry).getCronJob('gated').fireOnTick();
    expect(calls).toEqual([]);

    jest.spyOn(app.get(CronRunClaimer), 'claim').mockResolvedValue(true);
    await app.get(SchedulerRegistry).getCronJob('gated').fireOnTick();
    expect(calls).toEqual(['ran']);
  });
});
