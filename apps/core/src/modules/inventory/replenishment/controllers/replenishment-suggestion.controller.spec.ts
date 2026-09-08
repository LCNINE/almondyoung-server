import { ReplenishmentSuggestionController } from './replenishment-suggestion.controller';
import { ReplenishmentSuggestionService } from '../suggestion/replenishment-suggestion.service';

describe('ReplenishmentSuggestionController', () => {
  const listSuggestions = jest.fn().mockResolvedValue({ items: [], evaluated: 0, total: 0 });
  const getSku = jest.fn().mockResolvedValue({ skuId: 'sku-1' });
  const service = { listSuggestions, getSku } as unknown as ReplenishmentSuggestionService;
  const controller = new ReplenishmentSuggestionController(service);

  it('action 미지정은 all 로, limit 미지정은 200 으로 위임한다', async () => {
    await controller.list({});
    expect(listSuggestions).toHaveBeenCalledWith({ action: 'all', limit: 200 });
  });

  it('action 을 그대로 넘긴다', async () => {
    await controller.list({ action: 'transfer' });
    expect(listSuggestions).toHaveBeenCalledWith({ action: 'transfer', limit: 200 });
  });

  it('limit 을 그대로 넘긴다', async () => {
    await controller.list({ action: 'transfer', limit: 50 });
    expect(listSuggestions).toHaveBeenCalledWith({ action: 'transfer', limit: 50 });
  });

  it('skuId 를 그대로 넘긴다', async () => {
    await expect(controller.getSku('sku-1')).resolves.toEqual({ skuId: 'sku-1' });
    expect(getSku).toHaveBeenCalledWith('sku-1');
  });
});
