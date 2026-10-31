import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { InternalKeyGuard, IS_PUBLIC_KEY } from '@app/authorization';
import { ChannelListingController } from './channel-listing.controller';
import { ChannelListingsInternalController } from './channel-listings-internal.controller';
import { ChannelListingService } from './channel-listing.service';

/**
 * channel-adapter 의 주문 라인 식별(#674)이 부르는 리스팅 해석. 전에는 `@Public` 이었다 — 테넌트별 DB 에서 무인증 라우트는
 * 호출자 헤더로만 DB 를 고르는데, 이 호출자는 내부 키를 쥔 서비스라 내부 키 입구로 옮겼다.
 */
describe('ChannelListingsInternalController', () => {
  it('클래스 단위로 내부 키 입구다 — 면제만 되고 가드가 없으면 무인증 개방이다', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ChannelListingsInternalController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, ChannelListingsInternalController) as unknown[]).toContain(
      InternalKeyGuard,
    );
  });

  it('어드민 리스팅 컨트롤러에는 무인증 라우트가 남지 않는다', () => {
    const handlers = Object.getOwnPropertyNames(ChannelListingController.prototype).filter(
      (name) => name !== 'constructor',
    );
    const open = handlers.filter((name) =>
      Reflect.getMetadata(IS_PUBLIC_KEY, Reflect.get(ChannelListingController.prototype, name) as object),
    );
    expect(open).toEqual([]);
  });

  describe('resolve', () => {
    const stub = {
      resolveVariant: jest.fn().mockResolvedValue({ found: false, cause: 'listing_not_found' }),
      resolveVariantByChannelCode: jest.fn().mockResolvedValue({
        found: true,
        listing: {
          masterId: 'm',
          versionId: 'v',
          productName: 'p',
          variantId: 'var',
          variantCode: null,
          variantName: null,
          isActive: true,
        },
      }),
    };
    const controller = new ChannelListingsInternalController(stub as never as ChannelListingService);

    it('채널 코드로 해석한 매핑을 돌려준다', async () => {
      await expect(controller.resolve(undefined, 'naver', 'item-1')).resolves.toMatchObject({
        found: true,
        listing: { variantId: 'var' },
      });
      expect(stub.resolveVariantByChannelCode).toHaveBeenCalledWith('naver', 'item-1');
    });

    it('판매채널 id 가 오면 그것으로 해석하고 사유를 그대로 싣는다', async () => {
      await expect(controller.resolve('sc-1', undefined, 'item-1')).resolves.toEqual({
        found: false,
        cause: 'listing_not_found',
      });
      expect(stub.resolveVariant).toHaveBeenCalledWith('sc-1', 'item-1');
    });

    it('채널 상품 id 나 채널 지정이 없으면 400', async () => {
      await expect(controller.resolve(undefined, 'naver', undefined)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.resolve(undefined, undefined, 'item-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
