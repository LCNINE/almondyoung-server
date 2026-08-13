import { DeferredRevalidateService } from './deferred-revalidate.service';
import { StorefrontRevalidateService } from './storefront-revalidate.service';

describe('DeferredRevalidateService', () => {
  let revalidate: jest.Mocked<Pick<StorefrontRevalidateService, 'revalidateProducts'>>;
  let service: DeferredRevalidateService;

  beforeEach(() => {
    revalidate = { revalidateProducts: jest.fn().mockResolvedValue(undefined) };
    service = new DeferredRevalidateService(
      revalidate as unknown as StorefrontRevalidateService,
      { get: () => undefined } as never,
    );
  });

  it('누적한 handle 을 flush 에서 한 번에 보낸다', async () => {
    service.enqueue('m1');
    service.enqueue('m2');

    await service.flush();

    expect(revalidate.revalidateProducts).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidateProducts).toHaveBeenCalledWith(['m1', 'm2']);
  });

  it('같은 handle 이 여러 번 들어와도 한 번만 보낸다', async () => {
    service.enqueue('m1');
    service.enqueue('m1');

    await service.flush();

    expect(revalidate.revalidateProducts).toHaveBeenCalledWith(['m1']);
  });

  it('버퍼가 비면 호출하지 않는다', async () => {
    await service.flush();

    expect(revalidate.revalidateProducts).not.toHaveBeenCalled();
  });

  it('flush 가 실패해도 예외를 밖으로 내지 않는다 — 캐시 지연은 동기화를 막을 이유가 아니다', async () => {
    revalidate.revalidateProducts.mockRejectedValue(new Error('boom'));
    service.enqueue('m1');

    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('flush 실패분은 버려진다 — 다음 flush 를 무한히 오염시키지 않는다', async () => {
    revalidate.revalidateProducts.mockRejectedValueOnce(new Error('boom'));
    service.enqueue('m1');
    await service.flush();

    revalidate.revalidateProducts.mockClear();
    await service.flush();

    expect(revalidate.revalidateProducts).not.toHaveBeenCalled();
  });
});
