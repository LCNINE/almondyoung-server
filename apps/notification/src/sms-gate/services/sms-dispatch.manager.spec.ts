import { UserContactClient } from '@app/shared';
import { Notification } from '../../../database/schemas/notification-schema';
import { SmsGateClient } from '../clients/sms-gate.client';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsDeviceReader } from './sms-device.reader';
import { SmsDispatchManager } from './sms-dispatch.manager';

const bulkRow = (id: string) =>
  ({
    notificationId: id,
    campaignId: 'campaign',
    category: 'INFORMATIONAL',
    userId: id,
    attempts: 0,
    payload: { phoneNumber: '01012345678' },
    renderedContent: { body: 'x' },
    metadata: {},
  }) as unknown as Notification;

describe('SmsDispatchManager.dispatchDue', () => {
  const devPhone = process.env.NOTIFICATION_DEV_PHONE;
  beforeEach(() => {
    process.env.NOTIFICATION_DEV_PHONE = '01000000000';
  });
  afterEach(() => {
    jest.useRealTimers();
    if (devPhone === undefined) delete process.env.NOTIFICATION_DEV_PHONE;
    else process.env.NOTIFICATION_DEV_PHONE = devPhone;
  });

  it('발송 도중 20시를 넘기면 남은 대량 건은 보내지 않는다', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-21T19:59:59+09:00') });
    const repository = {
      withDispatchLock: (fn: () => Promise<void>) => fn(),
      findDue: jest.fn((_now: Date, _limit: number, _marketing: boolean, bulk: boolean) =>
        Promise.resolve(bulk ? [bulkRow('1'), bulkRow('2')] : []),
      ),
      claim: jest.fn().mockResolvedValue(true),
      markSent: jest.fn(),
      markFailed: jest.fn(),
    };
    const online = { enabled: true, dailyLimit: 1000, sentToday: 0, lastSeen: new Date(), lastSentAt: null };
    const deviceReader = {
      loadStatuses: jest.fn().mockResolvedValue([
        { ...online, id: 'a', name: 'A', deviceId: 'A', online: true },
        { ...online, id: 'b', name: 'B', deviceId: 'B', online: true },
      ]),
    };
    const client = {
      send: jest.fn(async () => {
        jest.setSystemTime(new Date('2026-09-21T20:00:01+09:00'));
        return { id: 'ext' };
      }),
    };
    const manager = new SmsDispatchManager(
      repository as unknown as SmsGateRepository,
      deviceReader as unknown as SmsDeviceReader,
      client as unknown as SmsGateClient,
      {} as UserContactClient,
    );

    await manager.dispatchDue(new Date());

    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('수신자 그룹 광고 건은 수신거부 번호이거나 그 번호의 회원이 동의를 껐으면 취소한다', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-21T10:00:00+09:00') });
    const groupRow = (id: string, phone: string) =>
      ({
        ...bulkRow(id),
        category: 'MARKETING',
        userId: `group:${id}`,
        payload: { phoneNumber: phone },
        metadata: { recipientGroupId: 'g1' },
      }) as unknown as Notification;
    const optedOut = groupRow('1', '+821011112222');
    const kept = groupRow('2', '+821033334444');
    const consentOff = groupRow('3', '+821055556666');
    const repository = {
      withDispatchLock: (fn: () => Promise<void>) => fn(),
      findDue: jest.fn((_now: Date, _limit: number, _marketing: boolean, bulk: boolean) =>
        Promise.resolve(bulk ? [optedOut, kept, consentOff] : []),
      ),
      findOptedOut: jest.fn().mockResolvedValue(new Set(['+821011112222'])),
      markCancelled: jest.fn(),
      claim: jest.fn().mockResolvedValue(true),
      markSent: jest.fn(),
      markFailed: jest.fn(),
    };
    const contacts = {
      findActiveContactsByPhone: jest.fn(async (phone: string) =>
        phone === '+821055556666' ? [{ userId: 'u-off', username: '동의끔' }] : [],
      ),
      findContacts: jest.fn().mockResolvedValue(new Map([['u-off', { userId: 'u-off', marketingConsent: false }]])),
    };
    const deviceReader = {
      loadStatuses: jest.fn().mockResolvedValue([
        {
          id: 'a',
          name: 'A',
          deviceId: 'A',
          online: true,
          enabled: true,
          dailyLimit: 1000,
          sentToday: 0,
          lastSeen: new Date(),
          lastSentAt: null,
        },
      ]),
    };
    const client = { send: jest.fn().mockResolvedValue({ id: 'ext' }) };
    const manager = new SmsDispatchManager(
      repository as unknown as SmsGateRepository,
      deviceReader as unknown as SmsDeviceReader,
      client as unknown as SmsGateClient,
      contacts as unknown as UserContactClient,
    );

    await manager.dispatchDue(new Date());

    expect(contacts.findContacts).toHaveBeenCalledWith(['u-off']);
    expect(repository.markCancelled).toHaveBeenCalledWith(optedOut, expect.any(String));
    expect(repository.markCancelled).toHaveBeenCalledWith(consentOff, expect.any(String));
    expect(repository.claim).toHaveBeenCalledWith(kept);
    expect(repository.claim).not.toHaveBeenCalledWith(optedOut);
  });
});
