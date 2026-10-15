jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});

jest.mock('../../client', () => ({
  client: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

import { client } from '../../client';
import { lineCompositionClient } from './line-composition.client';

const mockedClient = client as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
};

describe('line composition client (#1063)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedClient.get.mockResolvedValue({ data: { changeable: 0 } });
    mockedClient.post.mockResolvedValue({ data: { changed: 0, skipped: [] } });
    mockedClient.put.mockResolvedValue({ data: { salesOrderLineId: 'l' } });
  });

  it('PUT 은 판매주문·라인 경로에 본문 그대로', async () => {
    await lineCompositionClient.assign('so/1', 'line/1', { items: [{ skuId: 's', qtyPerUnit: 2 }] });
    expect(mockedClient.put).toHaveBeenCalledWith('/core/sales-orders/so%2F1/lines/line%2F1/composition', {
      items: [{ skuId: 's', qtyPerUnit: 2 }],
    });
  });

  it('미리보기·적용은 matchings/variants 경로', async () => {
    await lineCompositionClient.existingLinesImpact('v/1');
    await lineCompositionClient.applyToExistingLines('v/1');
    expect(mockedClient.get).toHaveBeenCalledWith('/core/matchings/variants/v%2F1/existing-lines-impact');
    expect(mockedClient.post).toHaveBeenCalledWith('/core/matchings/variants/v%2F1/apply-to-existing-lines');
  });
});
