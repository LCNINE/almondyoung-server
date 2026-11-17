import { ExternalLineOrigin, isUntrustedExternalLine } from './external-line-identity';

const line: ExternalLineOrigin = {
  salesChannel: 'naver',
  channelOrderItemId: 'item-1',
  channelProductId: 'product-1',
  exchangeReturnLineId: null,
};

describe('isUntrustedExternalLine', () => {
  it.each<[string, Partial<ExternalLineOrigin>, boolean]>([
    ['쇼핑몰 품목 번호가 있으면 믿는다', {}, false],
    ['품목 번호가 없으면 믿지 않는다', { channelOrderItemId: null }, true],
    ['품목 번호가 공백뿐이면 믿지 않는다', { channelOrderItemId: '  ' }, true],
    ['품목 번호가 상품 번호와 같으면 믿지 않는다', { channelOrderItemId: 'product-1' }, true],
    ['교환 줄은 품목 번호가 아직 없어도 된다', { channelOrderItemId: null, exchangeReturnLineId: 'r-1' }, false],
    [
      '교환 줄도 품목 번호가 상품 번호와 같으면 믿지 않는다',
      { channelOrderItemId: 'product-1', exchangeReturnLineId: 'r-1' },
      true,
    ],
    ['상품 번호가 없으면 품목 번호만 본다', { channelProductId: null }, false],
    ['검사하지 않는 채널은 번호가 없어도 된다', { salesChannel: 'manual', channelOrderItemId: null }, false],
    ['채널이 없으면 검사하지 않는다', { salesChannel: null, channelOrderItemId: null }, false],
  ])('%s', (_name, patch, expected) => {
    expect(isUntrustedExternalLine({ ...line, ...patch })).toBe(expected);
  });
});
