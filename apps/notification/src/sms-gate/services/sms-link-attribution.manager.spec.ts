import { NotFoundError } from '@app/shared';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsLinkAttributionManager } from './sms-link-attribution.manager';

function managerWith(clickState: { clicked: boolean } | undefined) {
  const repository = {
    findLinkClickState: jest.fn().mockResolvedValue(clickState),
    insertLinkAttribution: jest.fn().mockResolvedValue(undefined),
  };
  return { repository, manager: new SmsLinkAttributionManager(repository as unknown as SmsGateRepository) };
}

describe('SmsLinkAttributionManager.attribute', () => {
  it('없는 코드면 NotFoundError', async () => {
    const { repository, manager } = managerWith(undefined);

    await expect(manager.attribute('AbCd_123', 'u1', 'login')).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.insertLinkAttribution).not.toHaveBeenCalled();
  });

  it('한 번도 안 눌린 코드면 NotFoundError', async () => {
    const { repository, manager } = managerWith({ clicked: false });

    await expect(manager.attribute('AbCd_123', 'u1', 'login')).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.insertLinkAttribution).not.toHaveBeenCalled();
  });

  it('눌린 코드면 code·userId·kind 를 기록한다', async () => {
    const { repository, manager } = managerWith({ clicked: true });

    await manager.attribute('AbCd_123', 'u1', 'login');

    expect(repository.findLinkClickState).toHaveBeenCalledWith('AbCd_123');
    expect(repository.insertLinkAttribution).toHaveBeenCalledTimes(1);
    expect(repository.insertLinkAttribution).toHaveBeenCalledWith({ code: 'AbCd_123', userId: 'u1', kind: 'login' });
  });
});
