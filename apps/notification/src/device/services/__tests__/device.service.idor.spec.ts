import { eq } from 'drizzle-orm';
import { DeviceService } from '../device.service';
import { fcmTokens } from '../../../../database/schemas/notification-schema';

/**
 * onConflictDoUpdate 를 흉내내는 최소 mock. insert().values() 까지는 값을 그냥
 * 통과시키고, onConflictDoUpdate 호출 자체를 스파이로 잡아 서비스가 실제로
 * 무엇을 DB 레이어에 넘기는지(호출자 식별자가 조건절에 실렸는지) 검증한다.
 * 반환값(§resolve)만 맞추는 방식으로는 조건절 누락을 못 잡는다 — 이 감사가
 * 잡으려는 버그가 바로 "반환값은 그대로인데 조건절이 없는" 경우다.
 */
function makeDb(onConflictDoUpdate: jest.Mock) {
  return {
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoUpdate,
      })),
    })),
  };
}

describe('DeviceService.registerToken IDOR', () => {
  it('deviceId 없이 등록할 때 소유자 조건이 onConflictDoUpdate 의 setWhere 로 실려 간다', async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const db = makeDb(onConflictDoUpdate);
    const service = new DeviceService({ db } as never);

    // attacker 가 victim 소유일 수도 있는 token 문자열로, deviceId 없이 등록을 시도한다.
    await service.registerToken('attacker', {
      token: 'victim-token',
      platform: 'ios',
    });

    // target 은 여전히 전역 unique 인 token 컬럼이어야 한다 (스키마는 안 바꾼다).
    // 호출자(attacker)의 userId 가 DO UPDATE 의 조건절(setWhere)에 실제로 실려가야
    // 한다 — 반환값만 보면 이 조건절이 빠져도 통과하므로 반드시 여기서 못 박는다.
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: fcmTokens.token,
        setWhere: eq(fcmTokens.userId, 'attacker'),
      }),
    );
  });

  it('deviceId 가 있으면 여전히 [userId, deviceId] 로 스코프된다 (회귀 방지)', async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const db = makeDb(onConflictDoUpdate);
    const service = new DeviceService({ db } as never);

    await service.registerToken('owner', {
      token: 'some-token',
      platform: 'android',
      deviceId: 'device-1',
    });

    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [fcmTokens.userId, fcmTokens.deviceId],
      }),
    );
  });
});
