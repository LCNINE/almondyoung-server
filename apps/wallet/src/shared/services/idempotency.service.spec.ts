import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from './idempotency.service';
import { DbService } from '@libs/db';
import * as schema from '../schemas/schema';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockDbService: jest.Mocked<DbService<typeof schema>>;

  beforeEach(async () => {
    const mockDb = {
      query: {
        idempotencyKeys: {
          findFirst: jest.fn(),
        },
      },
      insert: jest.fn().mockReturnValue({
        values: jest.fn(),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn(),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn(),
      }),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn(),
        }),
      }),
    };

    mockDbService = {
      db: mockDb,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: 'DB_SERVICE',
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  describe('generateRequestHash', () => {
    it('should generate consistent hash for same payload', () => {
      const payload1 = { amount: 1000, orderId: 'ORDER123' };
      const payload2 = { orderId: 'ORDER123', amount: 1000 }; // 순서 다름
      
      const hash1 = service.generateRequestHash(payload1);
      const hash2 = service.generateRequestHash(payload2);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 해시는 64자
    });

    it('should generate different hash for different payload', () => {
      const payload1 = { amount: 1000, orderId: 'ORDER123' };
      const payload2 = { amount: 2000, orderId: 'ORDER123' };
      
      const hash1 = service.generateRequestHash(payload1);
      const hash2 = service.generateRequestHash(payload2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty payload', () => {
      const hash1 = service.generateRequestHash({});
      const hash2 = service.generateRequestHash(null);
      const hash3 = service.generateRequestHash(undefined);
      
      expect(hash1).toBeDefined();
      expect(hash2).toBeDefined();
      expect(hash3).toBeDefined();
    });
  });

  describe('validateRequestHash', () => {
    it('should return true for matching payloads', () => {
      const payload = { amount: 1000, orderId: 'ORDER123' };
      const hash = service.generateRequestHash(payload);
      
      const isValid = service.validateRequestHash(hash, payload);
      
      expect(isValid).toBe(true);
    });

    it('should return false for different payloads', () => {
      const payload1 = { amount: 1000, orderId: 'ORDER123' };
      const payload2 = { amount: 2000, orderId: 'ORDER123' };
      const hash = service.generateRequestHash(payload1);
      
      const isValid = service.validateRequestHash(hash, payload2);
      
      expect(isValid).toBe(false);
    });
  });

  describe('findIdempotencyKey', () => {
    it('should return null for non-existent key', async () => {
      mockDbService.db.query.idempotencyKeys.findFirst.mockResolvedValue(null);
      
      const result = await service.findIdempotencyKey('non-existent-key');
      
      expect(result).toBeNull();
    });

    it('should return record for existing key', async () => {
      const mockRecord = {
        id: 'test-key',
        userId: 'user123',
        requestPath: '/payments',
        requestHash: 'hash123',
        status: 'COMPLETED',
        responseCode: 200,
        responseBody: '{"success": true}',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24시간 후
      };

      mockDbService.db.query.idempotencyKeys.findFirst.mockResolvedValue(mockRecord);
      
      const result = await service.findIdempotencyKey('test-key');
      
      expect(result).toEqual(mockRecord);
    });

    it('should delete and return null for expired key', async () => {
      const expiredRecord = {
        id: 'expired-key',
        userId: 'user123',
        requestPath: '/payments',
        requestHash: 'hash123',
        status: 'COMPLETED',
        responseCode: 200,
        responseBody: '{"success": true}',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // 1초 전 만료
      };

      mockDbService.db.query.idempotencyKeys.findFirst.mockResolvedValue(expiredRecord);
      mockDbService.db.delete.mockReturnValue({
        where: jest.fn(),
      } as any);
      
      const result = await service.findIdempotencyKey('expired-key');
      
      expect(result).toBeNull();
      expect(mockDbService.db.delete).toHaveBeenCalled();
    });
  });

  describe('createIdempotencyKey', () => {
    it('should create new idempotency key', async () => {
      const insertMock = jest.fn();
      const valuesMock = jest.fn();
      
      mockDbService.db.insert.mockReturnValue({
        values: valuesMock,
      } as any);

      await service.createIdempotencyKey(
        'test-key',
        'user123',
        '/payments',
        { amount: 1000 }
      );

      expect(mockDbService.db.insert).toHaveBeenCalled();
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-key',
          userId: 'user123',
          requestPath: '/payments',
          status: 'PROCESSING',
          requestHash: expect.any(String),
          expiresAt: expect.any(Date),
        })
      );
    });
  });
});