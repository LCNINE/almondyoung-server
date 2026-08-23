import { Test } from '@nestjs/testing';
import { EventTraceApiModule } from './event-trace-api.module';
import { EventTraceQueryService } from './event-trace-query.service';
import { EventTraceReader, TraceLink } from './event-trace.reader';

const link = (chainId: string): TraceLink => ({
  id: `id-${chainId}`,
  eventId: `evt-${chainId}`,
  chainId,
  eventType: 'order.created',
  resourceType: 'order',
  resourceId: 'o-1',
  direction: 'OUT',
  action: null,
  description: null,
  serviceName: 'core',
  createdAt: new Date('2026-08-23T00:00:00Z'),
});

describe('EventTraceQueryService', () => {
  let service: EventTraceQueryService;
  let reader: jest.Mocked<
    Pick<EventTraceReader, 'findResourcesByType' | 'countResourcesByType' | 'findByResource' | 'findByChain'>
  >;

  beforeEach(async () => {
    reader = {
      findResourcesByType: jest.fn().mockResolvedValue([]),
      countResourcesByType: jest.fn().mockResolvedValue(0),
      findByResource: jest.fn().mockResolvedValue([]),
      findByChain: jest.fn().mockResolvedValue([]),
    };

    // `EventTraceApiModule` 을 실제로 태워 DI 계약(Query 서비스가 export 되는지)까지 함께 본다.
    // 앱들은 이 모듈만 import 하고 컨트롤러는 자기가 선언하므로, export 가 빠지면 5개 앱이 부팅에
    // 실패한다 (#705).
    const moduleRef = await Test.createTestingModule({ imports: [EventTraceApiModule] })
      .overrideProvider(EventTraceReader)
      .useValue(reader)
      .compile();

    service = moduleRef.get(EventTraceQueryService);
  });

  it('EventTraceApiModule 이 Query 서비스를 export 한다', () => {
    expect(service).toBeInstanceOf(EventTraceQueryService);
  });

  describe('listResourcesByType — 페이지네이션 인자', () => {
    it('값이 없으면 limit 20 / offset 0', async () => {
      const res = await service.listResourcesByType('order');

      expect(reader.findResourcesByType).toHaveBeenCalledWith('order', 20, 0);
      expect(res).toMatchObject({ limit: 20, offset: 0 });
    });

    it('limit 상한은 100 이다', async () => {
      await service.listResourcesByType('order', '500');

      expect(reader.findResourcesByType).toHaveBeenCalledWith('order', 100, 0);
    });

    // 옛 컨트롤러는 상한만 걸고 하한이 없어서 음수가 그대로 드리즐로 내려갔다 — 500 이 된다.
    it('음수 limit 은 1 로, 음수 offset 은 0 으로 자른다', async () => {
      await service.listResourcesByType('order', '-5', '-10');

      expect(reader.findResourcesByType).toHaveBeenCalledWith('order', 1, 0);
    });

    it('숫자가 아니면 기본값으로 떨어진다', async () => {
      await service.listResourcesByType('order', 'abc', 'xyz');

      expect(reader.findResourcesByType).toHaveBeenCalledWith('order', 20, 0);
    });
  });

  describe('byResource', () => {
    it('링크가 낀 체인 id 를 중복 없이 모은다', async () => {
      reader.findByResource.mockResolvedValue([link('c1'), link('c2'), link('c1')]);

      const res = await service.byResource('order', 'o-1');

      expect(res.chainIds).toEqual(['c1', 'c2']);
      expect(res.total).toBe(3);
    });
  });

  describe('byChain', () => {
    it('빈 chainId 는 chainIds 를 비운다', async () => {
      const res = await service.byChain('');

      expect(res.chainIds).toEqual([]);
    });
  });
});
