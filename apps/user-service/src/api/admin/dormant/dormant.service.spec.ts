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

  function makeDb() {
    updateCalls = [];
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
            return { where: jest.fn(async () => undefined) };
          }),
        })),
        delete: jest.fn(() => ({ where: jest.fn(async () => undefined) })),
      },
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DormantService,
        { provide: DbService, useValue: makeDb() },
        { provide: 'STREAM_PUBLISHER_users.events.v1', useValue: { publishEvent: jest.fn() } },
      ],
    }).compile();

    service = module.get<DormantService>(DormantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('휴면 전환은 dormant_at 에 쓰고 deleted_at 은 건드리지 않는다', async () => {
    selectRows.push([{ id: 'u-1', email: 'a@b.c' }]);

    await service.handleDormantAccounts();

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toHaveProperty('dormantAt');
    expect(updateCalls[0].set).not.toHaveProperty('deletedAt');
  });

  it('휴면 대상이 없으면 아무것도 업데이트하지 않는다', async () => {
    await service.handleDormantAccounts();

    expect(updateCalls).toHaveLength(0);
  });

  it('스키마에 dormant_at 과 deleted_at 이 별도 컬럼으로 존재한다', () => {
    expect(schema.users.dormantAt).toBeDefined();
    expect(schema.users.deletedAt).toBeDefined();
    expect(schema.users.dormantAt.name).toBe('dormant_at');
    expect(schema.users.deletedAt.name).toBe('deleted_at');
  });
});
