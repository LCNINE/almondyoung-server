/**
 * Swagger 설정
 * API 문서화를 위한 OpenAPI 설정
 */

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

/**
 * Swagger 문서 설정 및 초기화
 * @param app - NestJS 애플리케이션 인스턴스
 */
export function setupSwagger(app: INestApplication): void {
  // nestjs-zod와 Swagger 통합

  const config = new DocumentBuilder()
    .setTitle('Membership System API')
    .setDescription('멤버십 시스템 API 문서 - 구독, 플랜, 일시정지, 관리자 기능')
    .setVersion('1.0.0')
    .addTag('plans', '플랜 및 티어 관리')
    .addTag('subscriptions', '구독 관리')
    .addTag('pause', '구독 일시정지 관리')
    .addTag('billing', '결제 및 정기결제 관리')
    .addTag('admin', '관리자 운영 기능')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'JWT 토큰을 입력하세요',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-user-id',
        in: 'header',
        description: '개발용 사용자 ID (DevAuthGuard 사용 시)',
      },
      'dev-user-id',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    yamlDocumentUrl: '/api/docs.yaml',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
