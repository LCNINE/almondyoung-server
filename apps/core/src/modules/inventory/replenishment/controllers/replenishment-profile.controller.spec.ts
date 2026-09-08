import { ReplenishmentProfileController } from './replenishment-profile.controller';
import { ReplenishmentProfileService } from '../demand/replenishment-profile.service';

describe('ReplenishmentProfileController', () => {
  const recompute = jest.fn().mockResolvedValue({ series: 'window' });
  const service = { recompute } as unknown as ReplenishmentProfileService;
  const controller = new ReplenishmentProfileController(service);

  it('series 미지정은 window', async () => {
    await controller.recompute({});
    expect(recompute).toHaveBeenCalledWith('window');
  });

  it('series=full 을 그대로 넘긴다', async () => {
    await controller.recompute({ series: 'full' });
    expect(recompute).toHaveBeenCalledWith('full');
  });
});
