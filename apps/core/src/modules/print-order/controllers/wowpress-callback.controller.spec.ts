import { type PrintOrderTrackingManager } from '../services/print-order-tracking.manager';
import { WowpressCallbackController } from './wowpress-callback.controller';

describe('WowpressCallbackController', () => {
  it('refreshes only a well-formed ordnum and always answers ok', async () => {
    const refreshByVendorOrderNumber = jest.fn(() => Promise.resolve());
    const controller = new WowpressCallbackController({
      refreshByVendorOrderNumber,
    } as unknown as PrintOrderTrackingManager);

    await expect(controller.receive({ ordnum: 'WPAAP2611122089', ordstat: 90 })).resolves.toEqual({ ok: true });
    await expect(controller.receive({ ordnum: "x' or 1=1" })).resolves.toEqual({ ok: true });
    await expect(controller.receive({})).resolves.toEqual({ ok: true });

    expect(refreshByVendorOrderNumber).toHaveBeenCalledTimes(1);
    expect(refreshByVendorOrderNumber).toHaveBeenCalledWith('WPAAP2611122089');
  });
});
