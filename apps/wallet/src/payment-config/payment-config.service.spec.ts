import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentConfigService } from './payment-config.service';
import { PaymentProviderDescriptor } from '../providers/provider-descriptors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRegistry(descriptors: PaymentProviderDescriptor[]) {
  const byCode = new Map(descriptors.map((d) => [d.code, d]));
  return {
    listDescriptors: jest.fn(() => descriptors),
    hasProvider: jest.fn((code: string) => byCode.has(code.trim().toUpperCase())),
    getDescriptorOrThrow: jest.fn((code: string) => {
      const descriptor = byCode.get(code.trim().toUpperCase());
      if (!descriptor) throw new NotFoundException();
      return descriptor;
    }),
  };
}

function makeService(db: any, registry = makeRegistry(TEST_DESCRIPTORS)): PaymentConfigService {
  return new (PaymentConfigService as any)({ db }, registry);
}

const REGION_KR = { id: 'r-kr', code: 'kr', name: '대한민국', isActive: true, sortOrder: 10 };
const TEST_DESCRIPTORS: PaymentProviderDescriptor[] = [
  {
    code: 'POINTS',
    displayName: '포인트',
    description: '내부 포인트 결제',
    defaultEnabled: true,
    defaultSortOrder: 10,
    kind: 'ledger',
    capabilities: ['points', 'checkout'],
    publicExposure: 'checkout',
  },
  {
    code: 'TOSS',
    displayName: '토스페이먼츠',
    description: '토스 descriptor',
    defaultEnabled: true,
    defaultSortOrder: 20,
    kind: 'gateway',
    capabilities: ['checkout', 'refund'],
    publicExposure: 'checkout',
  },
  {
    code: 'BANK_TRANSFER',
    displayName: '무통장입금',
    description: '계좌 무통장 입금 (수동 확인)',
    defaultEnabled: true,
    defaultSortOrder: 30,
    kind: 'gateway',
    capabilities: ['checkout', 'manual_transfer', 'refund'],
    publicExposure: 'checkout',
  },
  {
    code: 'CMS_BATCH',
    displayName: 'CMS 자동이체',
    description: '효성 CMS 배치 출금',
    defaultEnabled: true,
    defaultSortOrder: 40,
    kind: 'gateway',
    capabilities: ['recurring_billing'],
    publicExposure: 'billing',
  },
];

describe('PaymentConfigService', () => {
  describe('listCatalog - provider descriptor is source of truth', () => {
    it('registry descriptor를 기준으로 DB policy override를 overlay하고 DB-only row는 retired로 반환한다', async () => {
      const catalogRows = [
        {
          id: 'catalog-toss',
          code: 'TOSS',
          displayName: 'DB 토스',
          description: 'DB 설명은 descriptor로 대체된다',
          isEnabled: false,
          sortOrder: 5,
        },
        {
          id: 'catalog-nicepay',
          code: 'NICEPAY',
          displayName: '나이스페이',
          description: 'seed에 남아 있는 지원 중단 row',
          isEnabled: true,
          sortOrder: 30,
        },
      ];
      const select = jest.fn().mockReturnValue({ from: () => ({ orderBy: () => Promise.resolve(catalogRows) }) });

      const service = makeService({ select });
      const result = await service.listCatalog();

      const byCode = Object.fromEntries(result.map((item) => [item.code, item]));
      expect(Object.keys(byCode)).toEqual(['TOSS', 'POINTS', 'BANK_TRANSFER', 'CMS_BATCH', 'NICEPAY']);
      expect(byCode.POINTS.isEnabled).toBe(true);
      expect(byCode.POINTS.supportStatus).toBe('supported');
      expect(byCode.TOSS.displayName).toBe('토스페이먼츠');
      expect(byCode.TOSS.description).toBe('토스 descriptor');
      expect(byCode.TOSS.isEnabled).toBe(false);
      expect(byCode.TOSS.sortOrder).toBe(5);
      expect(byCode.NICEPAY.supportStatus).toBe('retired');
      expect(byCode.NICEPAY.isRetired).toBe(true);
      expect(byCode.NICEPAY.isEnabled).toBe(false);
    });
  });

  // ── 2계층 AND 가용성 (글로벌 AND 리전 AND 리전 active) ──────────────────────
  describe('getRegionMethods - 매트릭스 available 계산', () => {
    it('available = region.isActive && globalEnabled && regionEnabled 를 정확히 반영한다', async () => {
      const matrixRows = [
        // globalEnabled && regionEnabled → available
        {
          id: 'catalog-toss',
          code: 'TOSS',
          displayName: '토스',
          description: null,
          isEnabled: true,
          sortOrder: 20,
        },
        // global off → not available
        {
          id: 'catalog-nicepay',
          code: 'NICEPAY',
          displayName: '나이스',
          description: null,
          isEnabled: false,
          sortOrder: 40,
        },
        // region off → not available
        {
          id: 'catalog-bank-transfer',
          code: 'BANK_TRANSFER',
          displayName: '무통장',
          description: null,
          isEnabled: true,
          sortOrder: 30,
        },
        // 매핑 없음(null) → regionEnabled false → not available
        {
          id: 'catalog-points',
          code: 'POINTS',
          displayName: '포인트',
          description: null,
          isEnabled: true,
          sortOrder: 10,
        },
      ];
      const mappingRows = [
        { code: 'TOSS', isEnabled: true, sortOrder: 20 },
        { code: 'NICEPAY', isEnabled: true, sortOrder: 40 },
        { code: 'BANK_TRANSFER', isEnabled: false, sortOrder: 30 },
      ];

      const select = jest
        .fn()
        // 1st call: getRegionOrThrow
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([REGION_KR]) }) }) })
        // 2nd call: catalog rows
        .mockReturnValueOnce({ from: () => ({ orderBy: () => Promise.resolve(matrixRows) }) })
        // 3rd call: region mapping rows
        .mockReturnValueOnce({
          from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve(mappingRows) }) }) }),
        });

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
          id: 'catalog-toss',
          code: 'TOSS',
          displayName: '토스',
          description: null,
          isEnabled: true,
          sortOrder: 20,
        },
      ];
      const mappingRows = [{ code: 'TOSS', isEnabled: true, sortOrder: 20 }];
      const select = jest
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([inactiveRegion]) }) }) })
        .mockReturnValueOnce({ from: () => ({ orderBy: () => Promise.resolve(matrixRows) }) })
        .mockReturnValueOnce({
          from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve(mappingRows) }) }) }),
        });

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
    it('ProviderRegistry에 없는 code 면 BadRequestException', async () => {
      const db = {
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
      };
      const service = makeService(db);
      await expect(service.updateCatalog('UNKNOWN', { isEnabled: false })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('putRegionMethods', () => {
    it('DB에 catalog row가 남아 있어도 registry에 없는 provider code는 저장하지 않는다', async () => {
      const db = {
        select: jest
          .fn()
          .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([REGION_KR]) }) }) }),
        transaction: jest.fn(async (callback: (tx: any) => Promise<void>) => callback({})),
      };
      const service = makeService(db);

      await expect(
        service.putRegionMethods('kr', { items: [{ code: 'NICEPAY', isEnabled: true, sortOrder: 40 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getAvailablePaymentMethods - public exposure', () => {
    it('registry checkout provider만 public에 노출하고 retired/internal provider는 제외한다', async () => {
      const regionRows = [REGION_KR];
      const catalogRows = [
        {
          id: 'catalog-toss',
          code: 'TOSS',
          displayName: 'DB 토스',
          description: null,
          isEnabled: true,
          sortOrder: 20,
        },
        {
          id: 'catalog-cms',
          code: 'CMS_BATCH',
          displayName: 'CMS',
          description: null,
          isEnabled: true,
          sortOrder: 30,
        },
        {
          id: 'catalog-nicepay',
          code: 'NICEPAY',
          displayName: '나이스페이',
          description: null,
          isEnabled: true,
          sortOrder: 40,
        },
      ];
      const mappingRows = [
        { code: 'TOSS', isEnabled: true, sortOrder: 20 },
        { code: 'CMS_BATCH', isEnabled: true, sortOrder: 30 },
        { code: 'NICEPAY', isEnabled: true, sortOrder: 40 },
      ];
      const select = jest
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve(regionRows) }) }) })
        .mockReturnValueOnce({ from: () => ({ orderBy: () => Promise.resolve(catalogRows) }) })
        .mockReturnValueOnce({
          from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve(mappingRows) }) }) }),
        });

      const service = makeService({ select });
      const result = await service.getAvailablePaymentMethods('kr');

      expect(result).toEqual([
        {
          code: 'TOSS',
          displayName: '토스페이먼츠',
          description: '토스 descriptor',
          sortOrder: 20,
        },
      ]);
    });
  });
});
