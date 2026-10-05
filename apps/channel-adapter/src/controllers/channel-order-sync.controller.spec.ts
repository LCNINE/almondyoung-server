import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ChannelOrderSyncController } from './channel-order-sync.controller';

function makeController(outcome = 'emitted', internalKey: string | undefined = 'internal-secret') {
  const orderPoller = { syncOrder: jest.fn().mockResolvedValue({ outcome }) };
  const config = { get: jest.fn().mockReturnValue(internalKey) };
  return { controller: new ChannelOrderSyncController(orderPoller as never, config as never), orderPoller };
}

describe('ChannelOrderSyncController', () => {
  it('내부 키가 맞으면 force 를 넘겨 끌어오고 결과를 돌려준다', async () => {
    const { controller, orderPoller } = makeController('emitted');
    await expect(controller.sync('Bearer internal-secret', 'medusa', 'order_1', { force: true })).resolves.toEqual({
      outcome: 'emitted',
    });
    expect(orderPoller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
  });

  it('본문이 없으면 force 는 false', async () => {
    const { controller, orderPoller } = makeController('unchanged');
    await controller.sync('Bearer internal-secret', 'naver', 'order_1', {});
    expect(orderPoller.syncOrder).toHaveBeenCalledWith('naver', 'order_1', { force: false });
  });

  it('틀린 키는 채널을 부르기 전에 401', async () => {
    const { controller, orderPoller } = makeController();
    await expect(controller.sync('Bearer wrong', 'medusa', 'order_1', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(orderPoller.syncOrder).not.toHaveBeenCalled();
  });

  it('키가 설정되지 않았으면 401', async () => {
    const { controller, orderPoller } = makeController('emitted', undefined);
    await expect(controller.sync('Bearer anything', 'medusa', 'order_1', {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(orderPoller.syncOrder).not.toHaveBeenCalled();
  });

  it('medusa·naver 밖의 채널은 400', async () => {
    const { controller, orderPoller } = makeController();
    await expect(controller.sync('Bearer internal-secret', 'coupang', 'order_1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(orderPoller.syncOrder).not.toHaveBeenCalled();
  });

  it('비활성 채널은 409', async () => {
    const { controller } = makeController('channel_inactive');
    await expect(controller.sync('Bearer internal-secret', 'medusa', 'order_1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
