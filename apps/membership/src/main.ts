import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { patchNestJsSwagger } from 'nestjs-zod';
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
  console.log('Platform:', isDev ? 'Express (Development)' : 'Fastify (Production)');

  // 개발환경: Express, 운영환경: Fastify
  const app = isDev 
    ? await NestFactory.create(AppModule)
    : await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  app.setGlobalPrefix('api');

  // Swagger는 개발 환경에서만 활성화
  if (isDev) {
    console.log('📝 Initializing Swagger documentation...');
    patchNestJsSwagger();

    const config = new DocumentBuilder()
      .setTitle('Membership API')
      .setDescription('멤버십 구독 관리 API')
      .setVersion('1.0')
      .addTag('policies', '정책 관리')
      .addTag('subscriptions', '구독 관리')
      .addTag('pause', '일시정지 관리')
      .addTag('plans', '플랜 관리')
      .addTag('rights', '권한 관리')
      .addTag('admin', '관리자 기능')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    console.log('📚 Swagger schemas generated:', Object.keys(document.components?.schemas || {}).length);

    SwaggerModule.setup('docs', app, document, {
      useGlobalPrefix: true,
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

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