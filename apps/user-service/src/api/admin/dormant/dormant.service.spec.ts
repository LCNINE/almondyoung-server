import { DbService } from '@app/db';
import { Test, TestingModule } from '@nestjs/testing';
import { DormantService } from './dormant.service';
import * as schema from '../../../../database/drizzle/schema';

/**
 * 휴면 전환이 어느 컬럼에 쓰는지가 이 서비스의 핵심 계약이다.
 *
 * 예전엔 휴면도 `deleted_at` 에 찍었다. 그 컬럼은 (1) 관리자 화면에서 "탈퇴" 로 표시되고
 * (2) 월 1회 크론이 30일 경과분을 하드 DELETE 하는 대상이다. 즉 1년 미접속 고객이
 * "탈퇴" 로 표시된 뒤 30일 만에 영구 삭제됐다. 그래서 `dormant_at` 으로 분리했고,
 * 이 스펙이 되돌아가는 것을 막는다.
 */
describe('DormantService', () => {
  let service: DormantService;
  let updateCalls: { set: Record<string, unknown> }[];
  let selectRows: unknown[][];
  let returningRows: unknown[][];
  let publishedEvents: { eventType: string; aggregateId: string }[];

  function makeDb() {
    updateCalls = [];
    returningRows = [];
    // markDormantUsersAndNotify → permanentDelete 순으로 select 가 호출된다.
    // 각 루프가 빈 배열을 만나면 즉시 빠져나오도록 한 번씩만 결과를 준다.
    selectRows = [];

    const selectChain = () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
        chain[m] = jest.fn(self);
      }
      chain.limit = jest.fn(async () => selectRows.shift() ?? []);
      return chain;
    };

    return {
      db: {
        select: jest.fn(selectChain),
        update: jest.fn(() => ({
          set: jest.fn((set: Record<string, unknown>) => {
            updateCalls.push({ set });
            // `where` 는 그대로 await 되기도 하고 `.returning()` 이 이어지기도 한다.
            // 둘 다 되게 Promise 에 returning 을 얹는다 — returning 을 빼면
            // 서비스의 TypeError 가 handleDormantAccounts 의 catch 에 삼켜져
            // 「스펙은 초록인데 라이브는 매일 밤 실패」가 된다 (#707 수정 중 실제로 겪음).
            return {
              where: jest.fn(() =>
                Object.assign(Promise.resolve(undefined), {
                  returning: jest.fn(async () => returningRows.shift() ?? []),
                }),
              ),
            };
          }),
        })),
        delete: jest.fn(() => ({ where: jest.fn(async () => undefined) })),
      },
    };
  }

  beforeEach(async () => {
    publishedEvents = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DormantService,
        { provide: DbService, useValue: makeDb() },
        {
          provide: 'STREAM_PUBLISHER_users.events.v1',
          useValue: {
            publishEvent: jest.fn((e: { eventType: string; aggregateId: string }) => {
              publishedEvents.push(e);
              return Promise.resolve();
            }),
          },
        },
      ],
    }).compile();

    service = module.get<DormantService>(DormantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('휴면 전환은 dormant_at 에 쓰고 deleted_at 은 건드리지 않는다', async () => {
    selectRows.push([{ id: 'u-1', email: 'a@b.c' }]);
    returningRows.push([{ id: 'u-1', email: 'a@b.c' }]);

    await service.handleDormantAccounts();

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toHaveProperty('dormantAt');
    expect(updateCalls[0].set).not.toHaveProperty('deletedAt');
  });

  it('휴면 대상이 없으면 아무것도 업데이트하지 않는다', async () => {
    await service.handleDormantAccounts();

    expect(updateCalls).toHaveLength(0);
  });

  // #707. 배포 창에서 태스크가 겹치면 두 인스턴스가 같은 «미전환» 목록을 읽는다.
  // UPDATE 는 원래도 조건부였으니 DB 는 멀쩡하지만, 통지가 읽은 목록을 따라가면
  // 진 쪽도 발행해 휴면 안내가 두 번 나간다. 통지는 «전환한 행» 만 따라가야 한다.
  it('통지는 실제로 전환한 행만 따라간다 — 스캔 목록이 아니다', async () => {
    selectRows.push([
      { id: 'u-1', email: 'a@b.c' },
      { id: 'u-2', email: 'd@e.f' },
    ]);
    // 다른 인스턴스가 u-2 를 먼저 전환해 갔다 → 우리 UPDATE 는 u-1 만 잡는다.
    returningRows.push([{ id: 'u-1', email: 'a@b.c' }]);

    await service.handleDormantAccounts();

    expect(publishedEvents).toEqual([
      expect.objectContaining({ eventType: 'UserDormantConverted', aggregateId: 'u-1' }),
    ]);
  });

  it('한 건도 전환하지 못하면 아무에게도 통지하지 않는다', async () => {
    selectRows.push([{ id: 'u-1', email: 'a@b.c' }]);
    returningRows.push([]);

    await service.handleDormantAccounts();

    expect(publishedEvents).toEqual([]);
  });

  it('스키마에 dormant_at 과 deleted_at 이 별도 컬럼으로 존재한다', () => {
    expect(schema.users.dormantAt).toBeDefined();
    expect(schema.users.deletedAt).toBeDefined();
    expect(schema.users.dormantAt.name).toBe('dormant_at');
    expect(schema.users.deletedAt.name).toBe('deleted_at');
  });
});
