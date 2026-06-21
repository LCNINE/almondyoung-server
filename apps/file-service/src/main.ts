import './tracing';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from '@app/shared';
import { Logger } from 'nestjs-pino';
import { FileServiceModule } from './file-service.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(FileServiceModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.use(cookieParser());

  const config = new DocumentBuilder()
    .setTitle('File Service API')
    .setDescription(
      '파일 업로드, 다운로드, 생명주기 관리 API\n\n' +
        '파일 업로드(단일/일괄), 다운로드(Signed URL), 활성화/삭제 등 파일 관리 기능을 제공합니다.',
    )
    .setVersion('1.0.0')
    .addTag('Health', '서비스 헬스체크')
    .addTag('Upload', '파일 업로드 (단일/일괄)')
    .addTag('Download', '파일 다운로드 및 메타데이터 조회')
    .addTag('Lifecycle', '파일 생명주기 관리 (활성화/삭제)')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'accessToken',
        in: 'cookie',
        description: 'JWT 토큰 쿠키 (accessToken)',
      },
      'cookie',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`🚀 File Service가 포트 ${port}에서 실행 중입니다.`);
  console.log(`📚 Swagger 문서: http://localhost:${port}/docs`);
}
bootstrap();
