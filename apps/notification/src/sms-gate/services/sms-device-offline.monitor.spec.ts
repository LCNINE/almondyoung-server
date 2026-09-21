import { GoogleChatClient } from '../clients/google-chat.client';
import { SmsGateClient } from '../clients/sms-gate.client';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsDeviceOfflineMonitor } from './sms-device-offline.monitor';

describe('SmsDeviceOfflineMonitor.check', () => {
  const setup = (offlineAlertedAt: Date | null, lastSeen: Date) => {
    const repository = {
      listDevices: jest
        .fn()
        .mockResolvedValue([{ id: 'row-a', deviceId: 'gw-a', name: '업무폰A', enabled: true, offlineAlertedAt }]),
      setOfflineAlertedAt: jest.fn(),
    };
    const client = {
      isConfigured: () => true,
      listDevices: jest.fn().mockResolvedValue([{ id: 'gw-a', name: 'A', lastSeen: lastSeen.toISOString() }]),
    };
    const googleChat = { isConfigured: jest.fn(() => true), send: jest.fn() };
    const monitor = new SmsDeviceOfflineMonitor(
      repository as unknown as SmsGateRepository,
      client as unknown as SmsGateClient,
      googleChat as unknown as GoogleChatClient,
    );
    return { monitor, repository, googleChat };
  };

  it('처음 꺼진 폰은 알리고 알린 시각을 남긴다', async () => {
    const { monitor, repository, googleChat } = setup(null, new Date(Date.now() - 60 * 60_000));

    await monitor.check();

    expect(googleChat.send).toHaveBeenCalledWith(expect.stringContaining('업무폰A — 1시간째 연결 없음'));
    expect(repository.setOfflineAlertedAt).toHaveBeenCalledWith(['row-a'], expect.any(Date));
  });

  it('이미 알린 폰이 계속 꺼져 있으면 다시 알리지 않는다', async () => {
    const { monitor, googleChat } = setup(new Date(), new Date(Date.now() - 60 * 60_000));

    await monitor.check();

    expect(googleChat.send).not.toHaveBeenCalled();
  });

  it('알린 폰이 다시 켜지면 복구를 한 번 알리고 표시를 지운다', async () => {
    const { monitor, repository, googleChat } = setup(new Date(), new Date());

    await monitor.check();

    expect(googleChat.send).toHaveBeenCalledWith(expect.stringContaining('다시 연결됐습니다'));
    expect(repository.setOfflineAlertedAt).toHaveBeenCalledWith(['row-a'], null);
  });

  it('웹훅이 없으면 알린 것으로 기록하지 않는다', async () => {
    const { monitor, repository, googleChat } = setup(null, new Date(Date.now() - 60 * 60_000));
    googleChat.isConfigured.mockReturnValue(false);

    await monitor.check();

    expect(googleChat.send).not.toHaveBeenCalled();
    expect(repository.setOfflineAlertedAt).not.toHaveBeenCalled();
  });
});
