import { Test } from '@nestjs/testing';
import { NameMatchManager, NAME_MATCH_LIMIT } from './name-match.manager';
import { NameMatchReader } from './name-match.reader';
import { ProductMatchingService } from '../services/product-matching.service';
import { NameMatchCandidate } from './name-match';

const candidate = (id: number): NameMatchCandidate => ({
  matchingId: `matching-${id}`,
  productName: '가방',
  optionName: '파랑',
  skuId: `sku-${id}`,
  skuName: '가방 파랑',
  waitingOrder: false,
});

describe('NameMatchManager', () => {
  const candidates = jest.fn<Promise<NameMatchCandidate[]>, []>();
  const resolveMatchingPending = jest.fn();
  let manager: NameMatchManager;

  beforeEach(async () => {
    candidates.mockReset();
    resolveMatchingPending.mockReset().mockResolvedValue({});

    const module = await Test.createTestingModule({
      providers: [
        NameMatchManager,
        { provide: NameMatchReader, useValue: { candidates } },
        { provide: ProductMatchingService, useValue: { resolveMatchingPending } },
      ],
    }).compile();

    manager = module.get(NameMatchManager);
  });

  it('recomputes candidates on each call and uses the manual resolution payload', async () => {
    candidates.mockResolvedValueOnce([candidate(1)]).mockResolvedValueOnce([]);

    expect(await manager.apply()).toEqual({ resolved: 1, skipped: 0, failed: [] });
    expect(await manager.apply()).toEqual({ resolved: 0, skipped: 0, failed: [] });
    expect(candidates).toHaveBeenCalledTimes(2);
    expect(resolveMatchingPending).toHaveBeenCalledTimes(1);
    expect(resolveMatchingPending).toHaveBeenCalledWith('matching-1', {
      ignore: false,
      strategy: 'variant',
      stockPolicy: { preStockSellable: true, alwaysSellableZeroStock: false },
      links: [{ skuId: 'sku-1', quantity: 1 }],
      skuMappings: [{ skuId: 'sku-1', quantity: 1 }],
      isGift: false,
    });
  });

  it('caps work, awaits each resolution, and continues after one failure', async () => {
    candidates.mockResolvedValue(Array.from({ length: NAME_MATCH_LIMIT + 2 }, (_, index) => candidate(index)));
    let active = 0;
    let peak = 0;

    resolveMatchingPending.mockImplementation(async (matchingId: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;

      if (matchingId === 'matching-1') throw new Error('failed validation');
    });

    expect(await manager.apply()).toEqual({
      resolved: NAME_MATCH_LIMIT - 1,
      skipped: 2,
      failed: [{ matchingId: 'matching-1', reason: 'failed validation' }],
    });
    expect(resolveMatchingPending).toHaveBeenCalledTimes(NAME_MATCH_LIMIT);
    expect(peak).toBe(1);
  });
});
