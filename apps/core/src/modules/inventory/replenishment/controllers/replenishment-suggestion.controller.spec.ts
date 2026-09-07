import { ReplenishmentSuggestionController } from './replenishment-suggestion.controller';
import { ReplenishmentSuggestionService } from '../suggestion/replenishment-suggestion.service';

describe('ReplenishmentSuggestionController', () => {
  const service = {
    listSuggestions: jest.fn().mockResolvedValue({ items: [], evaluated: 0 }),
    getSku: jest.fn().mockResolvedValue({ skuId: 'sku-1' }),
  } as unknown as ReplenishmentSuggestionService;
  const controller = new ReplenishmentSuggestionController(service);

  it('action 미지정은 all 로 위임한다', async () => {
    await controller.list({});
    expect(service.listSuggestions).toHaveBeenCalledWith({ action: 'all' });
  });

  it('action 을 그대로 넘긴다', async () => {
    await controller.list({ action: 'transfer' });
    expect(service.listSuggestions).toHaveBeenCalledWith({ action: 'transfer' });
  });

  it('skuId 를 그대로 넘긴다', async () => {
    await expect(controller.getSku('sku-1')).resolves.toEqual({ skuId: 'sku-1' });
    expect(service.getSku).toHaveBeenCalledWith('sku-1');
  });
});
