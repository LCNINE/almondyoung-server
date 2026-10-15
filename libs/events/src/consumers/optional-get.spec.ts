import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { optionalGet } from './consumer-interceptors';

@Injectable()
class Present {}

@Injectable()
class Missing {}

@Module({ providers: [Present] })
class AppModule {}

/**
 * `NestFactory` 가 만든 앱의 `get()` 은 ExceptionsZone 프록시를 거친다 — 기본(`abortOnError` 미지정)이면 못 찾았을 때
 * 예외를 로그로 남기고 **`process.exit(1)`** 한다. 호출자의 try/catch 는 닿지 않는다.
 * 2026-10-15 라이브: `EventFailuresModule` 을 import 하지 않은 앱 7개가 `optionalGet(app, DeadLetterRuntime)` 에서
 * 부팅하자마자 죽었다(membership·analytics·wallet 등, ECS 가 롤백). 테스트 모듈(`Test.createTestingModule`)은
 * 이 프록시가 없어서 단위 테스트로는 안 잡혔다. `createApplicationContext` 도 안 된다 — `init()` 이 프록시를 벗긴
 * 원본을 돌려준다. 운영 앱과 같은 `NestFactory.create`(HTTP 앱)로 만든다.
 */
describe('optionalGet — NestFactory 로 만든 앱', () => {
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) 호출됨`);
    }) as never);
  });

  afterEach(() => exitSpy.mockRestore());

  it('없는 provider 는 프로세스를 죽이지 않고 undefined', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      expect(optionalGet(app, Missing)).toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('있는 provider 는 그대로 돌려준다', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      expect(optionalGet(app, Present)).toBeInstanceOf(Present);
    } finally {
      await app.close();
    }
  });
});
