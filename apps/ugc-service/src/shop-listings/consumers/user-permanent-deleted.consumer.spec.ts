import { MODULE_METADATA } from '@nestjs/common/constants';
import { ShopListingManager } from '../shop-listing.manager';
import { ShopListingsModule } from '../shop-listings.module';
import { ShopListingUserPermanentDeletedConsumer } from './user-permanent-deleted.consumer';

describe('ShopListingUserPermanentDeletedConsumer', () => {
  const makeConsumer = () => {
    const manager = { withdrawAuthor: jest.fn().mockResolvedValue(1) };
    return {
      manager,
      consumer: new ShopListingUserPermanentDeletedConsumer(manager as unknown as ShopListingManager),
    };
  };

  it('영구 삭제된 회원의 매물을 감춘다', async () => {
    const { consumer, manager } = makeConsumer();
    await consumer.onUserPermanentDeleted({ userId: 'u-1', deletedAt: new Date().toISOString() });
    expect(manager.withdrawAuthor).toHaveBeenCalledWith('u-1');
  });

  // 빈 userId 로 부르면 WHERE 가 아무 행도 못 고르지만, 애초에 부르지 않는다.
  it('userId 가 없으면 아무것도 하지 않는다', async () => {
    const { consumer, manager } = makeConsumer();
    await consumer.onUserPermanentDeleted({ userId: '', deletedAt: new Date().toISOString() });
    expect(manager.withdrawAuthor).not.toHaveBeenCalled();
  });

  // @On 컨슈머는 controllers 에 있어야 구독된다. providers 에 두면 에러 없이 조용히 안 돈다.
  it('모듈의 controllers 에 등록돼 있다', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ShopListingsModule) ?? [];
    expect(controllers).toContain(ShopListingUserPermanentDeletedConsumer);
  });
});
