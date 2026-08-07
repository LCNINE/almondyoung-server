import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DeviceService } from '../device.service';
import { fcmTokens } from '../../../../database/schemas/notification-schema';

/**
 * deviceId 없는 등록이 거치는 insert().values().onConflictDoUpdate().returning()
 * 체인을 흉내내는 mock. returning() 이 resolve 하는 배열이 "실제로 뭔가 썼는지"의
 * 신호다 — 비어있으면 setWhere 가 막아 DO UPDATE 가 스킵된 것이고, 서비스는 이걸
 * 경고 로그로 남겨야 한다(§task-7 round1 리뷰). onConflictDoUpdate 호출 인자
 * (target/setWhere) 는 별도로 캡처해 조건절이 실제로 실렸는지도 검증한다.
 */
function makeDbNoDeviceId(returningResult: Array<{ userId: string }>) {
  const returning = jest.fn().mockResolvedValue(returningResult);
  const onConflictDoUpdate = jest.fn(() => ({ returning }));
  const db = {
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ onConflictDoUpdate })),
    })),
  };
  return { db, onConflictDoUpdate, returning };
}

/** deviceId 가 있는 분기는 .returning() 을 타지 않고 onConflictDoUpdate 를 바로 await 한다. */
function makeDbWithDeviceId() {
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const db = {
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ onConflictDoUpdate })),
    })),
  };
  return { db, onConflictDoUpdate };
}

describe('DeviceService.registerToken IDOR', () => {
  it('deviceId 없이 등록할 때 소유자 조건이 onConflictDoUpdate 의 setWhere 로 실려 간다', async () => {
    // 이 테스트는 조건절 배선만 본다 — returning() 은 "쓰기가 일어났다"로 맞춰
    // 스킵-로그 경로(별도 테스트)와 섞이지 않게 한다.
    const { db, onConflictDoUpdate } = makeDbNoDeviceId([{ userId: 'attacker' }]);
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
    const { db, onConflictDoUpdate } = makeDbWithDeviceId();
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

  it('충돌 대상이 남의 토큰이라 쓰기가 스킵되면 경고 로그를 남기고, 성공 로그는 남기지 않는다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      // setWhere 가 막아 DO UPDATE 가 스킵됐다는 뜻 — returning() 이 빈 배열을 낸다.
      // 이 no-op 은 클라이언트에게는 여전히 안 보여야 하지만(오라클 방지), 서버
      // 로그에는 신호가 남아야 한다는 게 이번 라운드의 요구사항이다.
      const { db } = makeDbNoDeviceId([]);
      const service = new DeviceService({ db } as never);

      await service.registerToken('attacker', {
        token: 'victim-token',
        platform: 'ios',
      });

      // 메시지에 스킵 신호가 있어야 하고, 두 번째 인자(구조화 컨텍스트)는
      // 정확히 { userId } 뿐이어야 한다 — toHaveBeenCalledWith 의 두 번째 인자를
      // 리터럴 객체로 주면 엄격한 동등비교라, 토큰 문자열이 몰래 같이 실리면
      // (자격증명 로깅) 이 테스트가 잡는다.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipped'), { userId: 'attacker' });

      // 아무것도 안 썼는데 "등록됨" 성공 로그가 같이 나가면 신호가 뭉개진다.
      expect(logSpy).not.toHaveBeenCalledWith('FCM token registered', expect.anything());
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('충돌이 없거나 자기 소유라 정상 등록되면 스킵 경고를 남기지 않는다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { db } = makeDbNoDeviceId([{ userId: 'owner' }]);
      const service = new DeviceService({ db } as never);

      await service.registerToken('owner', {
        token: 'own-token',
        platform: 'ios',
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
