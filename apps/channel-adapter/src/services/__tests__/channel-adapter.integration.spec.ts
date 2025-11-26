import { Test, TestingModule } from '@nestjs/testing';
import { ChannelAdapterService } from '../channel-adapter.service';
import { ChannelDataReader } from '../channel-data.reader';
import { ChannelSyncManager } from '../channel-sync.manager';
import { ChannelCommandManager } from '../channel-command.manager';
import { ChannelAdapterRepository } from '../channel-adapter.repository';
import { ChannelAdapterFactory } from '../adapters/channel-adapter.factory';
import { DbModule, DbService } from '@app/db';
import { channelAdapterSchema } from '../../schema';
import { StreamPublisher } from '@app/events';
import { NullEventPublisher } from '../null-event-publisher.service';
import { v7 as uuidv7 } from 'uuid';
import { InternalOrderEvent } from '../../types';

/**
 * 채널 어댑터 Service 통합 테스트
 *
 * 실제 환경에서 Service와 Manager가 정상 작동하는지 검증
 *
 * 테스트 시나리오:
 * 1. Service → Manager → Repository 전체 흐름
 * 2. 에러 처리 및 검증 로직
 * 3. 병렬 처리 동작
 */
describe('ChannelAdapterService (Integration)', () => {
  let service: ChannelAdapterService;
  let syncManager: ChannelSyncManager;
  let commandManager: ChannelCommandManager;
  let repository: ChannelAdapterRepository;
  let dbService: DbService<typeof channelAdapterSchema>;
  let module: TestingModule;

  // Mock Adapter
  const mockAdapter = {
    syncFromChannel: jest.fn(),
    processIncomingEvent: jest.fn(),
    syncToChannel: jest.fn(),
    executeCommand: jest.fn(),
    executeQuery: jest.fn(),
    findOrders: jest.fn(),
  };

  let testChannelId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://neondb_owner:npg_4jlXAK7qVywN@ep-young-thunder-a1bkhlx2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
          },
          schema: channelAdapterSchema,
        }),
      ],
      providers: [
        ChannelAdapterService,
        ChannelDataReader,
        ChannelSyncManager,
        ChannelCommandManager,
        ChannelAdapterRepository,
        {
          provide: ChannelAdapterFactory,
          useValue: {
            getAdapter: jest.fn().mockReturnValue(mockAdapter),
            getSupportedChannels: jest
              .fn()
              .mockReturnValue(['naver_smartstore', 'coupang']),
          },
        },
        {
          provide: StreamPublisher,
          useClass: NullEventPublisher,
        },
      ],
    }).compile();

    service = module.get<ChannelAdapterService>(ChannelAdapterService);
    syncManager = module.get<ChannelSyncManager>(ChannelSyncManager);
    commandManager = module.get<ChannelCommandManager>(ChannelCommandManager);
    repository = module.get<ChannelAdapterRepository>(ChannelAdapterRepository);
    dbService = module.get<DbService<typeof channelAdapterSchema>>(DbService);

    testChannelId = uuidv7();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await module.close();
  });

  describe('Service → Manager → Repository 전체 흐름', () => {
    it('1. poll() 메서드가 전체 동기화 흐름을 실행해야 한다', async () => {
      // Mock 데이터 설정
      const mockEvents: InternalOrderEvent[] = [
        {
          externalOrderId: 'ORDER-001',
          status: 'PAID',
          buyer: { name: 'Test User' },
        } as any,
      ];

      mockAdapter.syncFromChannel.mockResolvedValue(mockEvents);

      // Service 호출
      const result = await service.poll('naver_smartstore', 'orders');

      // 검증
      expect(result).toEqual(mockEvents);
      expect(mockAdapter.syncFromChannel).toHaveBeenCalledWith('orders');

      // DB에 저장되었는지 확인
      const histories = await dbService.db
        .select()
        .from(channelAdapterSchema.syncHistories);

      expect(histories.length).toBeGreaterThan(0);
    });

    it('2. syncToChannel() 메서드가 전송 → 로깅 흐름을 실행해야 한다', async () => {
      mockAdapter.syncToChannel.mockResolvedValue({ success: true });

      const payload = {
        dataType: 'inventory' as const,
        payload: {
          productId: 'PROD-001',
          stockQuantity: 100,
          isOptionProduct: false,
        },
      };

      const result = await service.syncToChannel('naver_smartstore', payload);

      expect(result.success).toBe(true);
      expect(mockAdapter.syncToChannel).toHaveBeenCalledWith(payload);

      // 동기화 로그 확인
      const histories = await dbService.db
        .select()
        .from(channelAdapterSchema.syncHistories);

      expect(histories.length).toBeGreaterThan(0);
    });
  });

  describe('SyncManager 검증 로직', () => {
    it('1. 빈 이벤트 배열로 동기화 시 에러를 던져야 한다', async () => {
      mockAdapter.syncFromChannel.mockResolvedValue([]);

      await expect(
        service.poll('naver_smartstore', 'orders'),
      ).rejects.toThrow();
    });

    it('2. 유효한 이벤트는 정상 처리되어야 한다', async () => {
      const mockEvents: InternalOrderEvent[] = [
        {
          externalOrderId: 'ORDER-002',
          status: 'PAID',
          buyer: { name: 'Valid User' },
        } as any,
      ];

      mockAdapter.syncFromChannel.mockResolvedValue(mockEvents);

      const result = await service.poll('coupang', 'orders');

      expect(result).toHaveLength(1);
      expect(result[0].externalOrderId).toBe('ORDER-002');
    });
  });

  describe('CommandManager 검증 로직', () => {
    it('1. 유효한 명령은 정상 실행되어야 한다', async () => {
      mockAdapter.executeCommand.mockResolvedValue({ success: true });

      const command = {
        type: 'dispatch.ship' as const,
        orderId: 'ORDER-003',
        tracking: {
          companyCode: 'CJ',
          number: '123456789',
        },
      };

      const result = await service.command('naver_smartstore', command);

      expect(result.success).toBe(true);
      expect(mockAdapter.executeCommand).toHaveBeenCalledWith(command);
    });

    it('2. tracking 정보가 없으면 에러를 던져야 한다', async () => {
      const invalidCommand = {
        type: 'dispatch.ship' as const,
        orderId: 'ORDER-004',
      } as any;

      await expect(
        commandManager.execute('naver_smartstore', invalidCommand),
      ).rejects.toThrow('Tracking information required');
    });

    it('3. orderIds가 빈 배열이면 에러를 던져야 한다', async () => {
      const invalidCommand = {
        type: 'order.prepare' as const,
        orderIds: [],
      };

      await expect(
        commandManager.execute('naver_smartstore', invalidCommand),
      ).rejects.toThrow('Order IDs required');
    });
  });

  describe('병렬 처리 동작', () => {
    it('1. executeOnAllChannels는 모든 채널에 병렬로 명령을 실행해야 한다', async () => {
      mockAdapter.executeCommand.mockResolvedValue({ success: true });

      const command = {
        type: 'order.prepare' as const,
        orderIds: ['ORDER-007'],
      };

      const results = await service.executeOnAllChannels(command);

      expect(results).toHaveLength(2); // naver_smartstore, coupang
      expect(results.every((r) => r.success)).toBe(true);
      expect(mockAdapter.executeCommand).toHaveBeenCalledTimes(2);
    });

    it('2. 일부 채널 실패 시에도 다른 채널은 계속 처리되어야 한다', async () => {
      mockAdapter.executeCommand
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('API Error'));

      const command = {
        type: 'order.prepare' as const,
        orderIds: ['ORDER-008'],
      };

      const results = await service.executeOnAllChannels(command);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('API Error');
    });
  });

  describe('에러 처리', () => {
    it('1. Service에서 발생한 에러는 명확한 메시지와 함께 전파되어야 한다', async () => {
      mockAdapter.syncFromChannel.mockRejectedValue(
        new Error('Channel API Error'),
      );

      await expect(service.poll('naver_smartstore', 'orders')).rejects.toThrow(
        'Failed to poll orders from naver_smartstore',
      );
    });
  });

  describe('실제 사용 시나리오', () => {
    it('전체 플로우: 폴링 → 동기화 → 명령 실행', async () => {
      // 1. 폴링
      const mockEvents: InternalOrderEvent[] = [
        {
          externalOrderId: 'SCENARIO-ORDER-001',
          status: 'PAID',
          buyer: { name: 'Scenario User' },
        } as any,
      ];

      mockAdapter.syncFromChannel.mockResolvedValue(mockEvents);
      const pollResult = await service.poll('naver_smartstore', 'orders');
      expect(pollResult).toHaveLength(1);

      // 2. 명령 실행
      mockAdapter.executeCommand.mockResolvedValue({ success: true });
      const command = {
        type: 'order.prepare' as const,
        orderIds: ['SCENARIO-ORDER-001'],
      };

      const commandResult = await service.command('naver_smartstore', command);
      expect(commandResult.success).toBe(true);

      // 3. DB 확인
      const histories = await dbService.db
        .select()
        .from(channelAdapterSchema.syncHistories);

      expect(histories.length).toBeGreaterThan(0);
    });
  });

  // 🧹 청소 함수
  async function cleanupDatabase() {
    try {
      await dbService.db.delete(channelAdapterSchema.eventLogs);
      await dbService.db.delete(channelAdapterSchema.syncHistories);
      await dbService.db.delete(channelAdapterSchema.processedEvents);
      await dbService.db.delete(channelAdapterSchema.syncStatuses);
    } catch (error) {
      // 무시
    }
  }
});
