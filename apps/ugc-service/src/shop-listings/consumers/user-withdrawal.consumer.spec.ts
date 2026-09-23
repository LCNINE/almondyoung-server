import { MODULE_METADATA } from '@nestjs/common/constants';
import { ShopListingManager } from '../shop-listing.manager';
import { ShopListingsModule } from '../shop-listings.module';
import { ShopListingUserWithdrawalConsumer } from './user-withdrawal.consumer';

describe('ShopListingUserWithdrawalConsumer', () => {
  const makeConsumer = () => {
    const manager = { withdrawAuthor: jest.fn().mockResolvedValue(1) };
    return {
      manager,
      consumer: new ShopListingUserWithdrawalConsumer(manager as unknown as ShopListingManager),
    };
  };

  // 탈퇴 즉시 나가는 이벤트 — 이걸 안 들으면 연락처가 휴면 크론(약 3년)까지 공개된 채 남는다.
  it('탈퇴(UserDeleted)한 회원의 매물을 바로 감춘다', async () => {
    const { consumer, manager } = makeConsumer();
    await consumer.onUserDeleted({ userId: 'u-1' });
    expect(manager.withdrawAuthor).toHaveBeenCalledWith('u-1');
  });

  it('영구 삭제(UserPermanentDeleted)도 같은 처리를 한다 — 보조 경로', async () => {
    const { consumer, manager } = makeConsumer();
    await consumer.onUserPermanentDeleted({ userId: 'u-1', deletedAt: new Date().toISOString() });
    expect(manager.withdrawAuthor).toHaveBeenCalledWith('u-1');
  });

  // 빈 userId 로 부르면 WHERE 가 아무 행도 못 고르지만, 애초에 부르지 않는다.
  it('userId 가 없으면 두 이벤트 모두 아무것도 하지 않는다', async () => {
    const { consumer, manager } = makeConsumer();
    await consumer.onUserDeleted({ userId: '' });
    await consumer.onUserPermanentDeleted({ userId: '', deletedAt: new Date().toISOString() });
    expect(manager.withdrawAuthor).not.toHaveBeenCalled();
  });

  // @On 컨슈머는 controllers 에 있어야 구독된다. providers 에 두면 에러 없이 조용히 안 돈다.
  it('모듈의 controllers 에 등록돼 있다', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ShopListingsModule) ?? [];
    expect(controllers).toContain(ShopListingUserWithdrawalConsumer);
  });
});
