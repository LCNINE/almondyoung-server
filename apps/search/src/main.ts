import './tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mountEventChainContext, EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { Logger as PinoLogger } from 'nestjs-pino';
import { SearchModule } from './search.module';

async function bootstrap() {
  const logger = new Logger('SearchBootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(SearchModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  // HTTP 요청 하나 = 사슬 하나 (#612). CLS 컨텍스트가 없으면 한 요청 안의 두 발행이 서로
  // 다른 chainId 를 받는다. 다른 미들웨어·전역 파이프보다 앞이어야 한다.
  mountEventChainContext(app);
  app.useLogger(app.get(PinoLogger));

  // admin-web 프록시는 인증을 Authorization 헤더가 아니라 accessToken 쿠키로 넘긴다.
  // 이 등록이 없으면 req.cookies 가 undefined 라 JwtAccessStrategy 의 쿠키 추출이
  // 조용히 실패해 관리자 라우트가 전부 401 이 된다 (analytics main.ts 와 같은 배선).
  await app.register(fastifyCookie);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const kafkaConfig = createKafkaConfigFromEnv();
  if (kafkaConfig) {
    // 구독 목록 인자가 없다 — 소비 집합은 컨트롤러의 `@On` 에서 도출된다 (ADR-0029 §3).
    // 도출된 토픽은 startConsumer 가 로그로 찍으므로 여기서 손으로 나열하지 않는다.
    await EventsModule.startConsumer(app, {
      groupId: process.env.KAFKA_GROUP_ID || 'search-indexer',
      kafka: kafkaConfig,
    });
  } else {
    logger.warn('Kafka consumer disabled: KAFKA_BROKERS not set.');
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`Search service listening on 0.0.0.0:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start Search application', error);
  process.exit(1);
});
