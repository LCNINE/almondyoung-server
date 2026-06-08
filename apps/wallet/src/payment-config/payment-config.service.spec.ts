import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentConfigService } from './payment-config.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeService(db: any): PaymentConfigService {
  return new PaymentConfigService({ db } as any);
}

const REGION_KR = { id: 'r-kr', code: 'kr', name: '대한민국', isActive: true, sortOrder: 10 };

describe('PaymentConfigService', () => {
  // ── 2계층 AND 가용성 (글로벌 AND 리전 AND 리전 active) ──────────────────────
  describe('getRegionMethods - 매트릭스 available 계산', () => {
    it('available = region.isActive && globalEnabled && regionEnabled 를 정확히 반영한다', async () => {
      const matrixRows = [
        // globalEnabled && regionEnabled → available
        {
          code: 'TOSS',
          displayName: '토스',
          description: null,
          globalEnabled: true,
          catalogSort: 20,
          mappingEnabled: true,
          mappingSort: 20,
        },
        // global off → not available
        {
          code: 'NICEPAY',
          displayName: '나이스',
          description: null,
          globalEnabled: false,
          catalogSort: 40,
          mappingEnabled: true,
          mappingSort: 40,
        },
        // region off → not available
        {
          code: 'BANK_TRANSFER',
          displayName: '무통장',
          description: null,
          globalEnabled: true,
          catalogSort: 30,
          mappingEnabled: false,
          mappingSort: 30,
        },
        // 매핑 없음(null) → regionEnabled false → not available
        {
          code: 'POINTS',
          displayName: '포인트',
          description: null,
          globalEnabled: true,
          catalogSort: 10,
          mappingEnabled: null,
          mappingSort: null,
        },
      ];

      const select = jest
        .fn()
        // 1st call: getRegionOrThrow
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([REGION_KR]) }) }) })
        // 2nd call: matrix
        .mockReturnValueOnce({ from: () => ({ leftJoin: () => ({ orderBy: () => Promise.resolve(matrixRows) }) }) });

      const service = makeService({ select });
      const result = await service.getRegionMethods('kr');

      const byCode = Object.fromEntries(result.items.map((i) => [i.code, i]));
      expect(byCode.TOSS.available).toBe(true);
      expect(byCode.NICEPAY.available).toBe(false);
      expect(byCode.BANK_TRANSFER.available).toBe(false);
      expect(byCode.POINTS.available).toBe(false);
      expect(byCode.POINTS.regionEnabled).toBe(false);
      expect(result.region.code).toBe('kr');
    });

    it('리전이 비활성(isActive=false)이면 모든 결제수단 available=false', async () => {
      const inactiveRegion = { ...REGION_KR, isActive: false };
      const matrixRows = [
        {
          code: 'TOSS',
          displayName: '토스',
          description: null,
          globalEnabled: true,
          catalogSort: 20,
          mappingEnabled: true,
          mappingSort: 20,
        },
      ];
      const select = jest
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([inactiveRegion]) }) }) })
        .mockReturnValueOnce({ from: () => ({ leftJoin: () => ({ orderBy: () => Promise.resolve(matrixRows) }) }) });

      const service = makeService({ select });
      const result = await service.getRegionMethods('kr');
      expect(result.items[0].available).toBe(false);
    });

    it('존재하지 않는 리전이면 NotFoundException', async () => {
      const select = jest
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) });
      const service = makeService({ select });
      await expect(service.getRegionMethods('kr')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── 소문자 alpha-2 검증/정규화 ────────────────────────────────────────────────
  describe('region code 정규화/검증', () => {
    it.each(['USA', 'u1', 'k', '12', ''])('잘못된 코드 "%s" 는 BadRequestException', async (bad) => {
      const service = makeService({});
      await expect(service.getAvailablePaymentMethods(bad)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('대문자 입력은 소문자로 정규화되어 저장된다', async () => {
      let capturedValues: any = null;
      const db = {
        select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
        insert: () => ({
          values: (v: any) => {
            capturedValues = v;
            return { returning: () => Promise.resolve([{ id: 'r1', ...v }]) };
          },
        }),
      };
      const service = makeService(db);
      const region = await service.createRegion({ code: 'KR', name: '대한민국' } as any);
      expect(capturedValues.code).toBe('kr');
      expect(region.code).toBe('kr');
    });
  });

  // ── 카탈로그 글로벌 토글 ─────────────────────────────────────────────────────
  describe('updateCatalog', () => {
    it('존재하지 않는 code 면 NotFoundException', async () => {
      const db = {
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
      };
      const service = makeService(db);
      await expect(service.updateCatalog('UNKNOWN', { isEnabled: false })).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
