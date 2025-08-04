import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/**
 * 애플리케이션 부트스트랩 함수
 * 개발 환경에서는 Express, 운영 환경에서는 Fastify를 사용
 * Swagger는 개발 환경에서만 활성화
 */
async function bootstrap(): Promise<void> {
  const isDev = process.env.NODE_ENV !== 'production';

  console.log('🚀 Starting Membership API...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log(
    'Platform:',
    isDev ? 'Express (Development)' : 'Fastify (Production)',
  );

  // 개발환경: Express, 운영환경: Fastify
  const app = isDev
    ? await NestFactory.create(AppModule)
    : await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter(),
      );

  app.setGlobalPrefix('api');

  // Swagger는 개발 환경에서만 활성화

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application running: http://localhost:${port}/api`);

  if (isDev) {
    console.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
  }
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
