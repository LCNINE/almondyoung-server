import { BadRequestError, UserContactClient } from '@app/shared';
import { ProviderManagerService } from '../../provider/services/provider-manager.service';
import { SMS_GATE_PROVIDER_ID } from '../constants/sms-gate.constants';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsDeviceReader } from './sms-device.reader';
import { SmsMessageManager } from './sms-message.manager';

describe('SmsMessageManager.send', () => {
  const setup = () => {
    const repository = {
      enqueue: jest.fn().mockImplementation((rows: object[]) =>
        Promise.resolve(rows.map((row, i) => ({ ...row, notificationId: `n-${i}` }))),
      ),
      markSent: jest.fn(),
      markFailed: jest.fn(),
      findDeviceByDeviceId: jest.fn(),
    };
    const contacts = {
      findContacts: jest.fn().mockResolvedValue(
        new Map([['u-1', { phoneNumber: '01012345678', username: '회원', marketingConsent: true }]]),
      ),
    };
    const provider = {
      getProviderId: () => 'nhn-provider',
      send: jest.fn().mockResolvedValue({ success: true, messageId: 'm-1' }),
    };
    const providerManager = { getAvailableProviderForChannel: jest.fn().mockResolvedValue(provider) };
    const deviceReader = { loadStatuses: jest.fn() };
    const manager = new SmsMessageManager(
      repository as unknown as SmsGateRepository,
      contacts as unknown as UserContactClient,
      deviceReader as unknown as SmsDeviceReader,
      providerManager as unknown as ProviderManagerService,
    );
    return { manager, repository, deviceReader };
  };

  it('대표번호(NHN)를 고르면 폰 한도를 보지 않고 전부 NHN 으로 보낸다', async () => {
    const { manager, repository, deviceReader } = setup();

    const result = await manager.send(
      { userIds: ['u-1'], content: '안내', category: 'INFORMATIONAL', route: 'NHN' },
      'staff',
    );

    expect(deviceReader.loadStatuses).not.toHaveBeenCalled();
    const rows = repository.enqueue.mock.calls.flatMap(([batch]) => batch as { providerId: string }[]);
    expect(rows.map((row) => row.providerId)).toEqual(['nhn-provider']);
    expect(rows.some((row) => row.providerId === SMS_GATE_PROVIDER_ID)).toBe(false);
    expect(result.queued).toHaveLength(1);
  });

  it('광고 문자는 대표번호(NHN)로 보낼 수 없다', async () => {
    const { manager, repository } = setup();

    await expect(
      manager.send({ userIds: ['u-1'], content: '세일', category: 'MARKETING', route: 'NHN' }, 'staff'),
    ).rejects.toThrow(BadRequestError);
    expect(repository.enqueue).not.toHaveBeenCalled();
  });
});
