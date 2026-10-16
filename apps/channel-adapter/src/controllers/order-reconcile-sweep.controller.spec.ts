import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { OrderReconcileSweepController } from './order-reconcile-sweep.controller';

const config = {
  get: (key: string) => (key === 'CHANNEL_ADAPTER_INTERNAL_KEY' ? 'secret' : undefined),
} as unknown as ConfigService;

describe('OrderReconcileSweepController', () => {
  it('내부 키가 틀리면 401', async () => {
    const service = { runCycle: jest.fn() };
    const controller = new OrderReconcileSweepController(service as never, config);
    await expect(
      controller.sweep('Bearer nope', { channel: 'medusa', updatedAfter: '2026-01-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.runCycle).not.toHaveBeenCalled();
  });

  it('관찰 전용으로 백그라운드 실행하고 바로 202 몸체를 돌려준다', async () => {
    const service = { runCycle: jest.fn(async () => ({ scanned: 0 })) };
    const controller = new OrderReconcileSweepController(service as never, config);
    await expect(
      controller.sweep('Bearer secret', { channel: 'medusa', updatedAfter: '2026-01-01T00:00:00Z' }),
    ).resolves.toEqual({ accepted: true });
    expect(service.runCycle).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({ updatedAfter: new Date('2026-01-01T00:00:00Z'), observeOnly: true }),
    );
  });
});
