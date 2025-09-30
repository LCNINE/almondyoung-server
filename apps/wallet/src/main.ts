// apps/wallet/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // ZodValidationPipe와 충돌하므로 글로벌 ValidationPipe 비활성화
  // app.useGlobalPipes(new ValidationPipe());

  await app.register(require('@fastify/multipart'), {
    attachFieldsToBody: true,
    limits: {
      fileSize: 1024 * 1024 * 10,
      files: 1,
    },
  });

  app.enableCors({
    origin: [
      'http://127.0.0.1:5500',
      'http://localhost:5000',
      'http://localhost:8080',
      'http://localhost:9000',
      'http://localhost:8000',
    ],
    credentials: true,
  });

  // 정적 파일 서빙 설정 (HTML 파일들)
  const htmlPath = join(process.cwd(), 'html');

  await app.register(require('@fastify/static'), {
    root: htmlPath,
    prefix: '/html/',
  });

  console.log(`정적 파일 서빙 경로: ${htmlPath}`);

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('Wallet Payment Server')
    .setDescription('MVP payment server for Medusa integration')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Swagger JSON apps/wallet/swagger-spec.json에 저장 (개발 환경만)
  // if (process.env.NODE_ENV !== 'production') {
  //   const swaggerJsonPath = join(
  //     process.cwd(),
  //     'apps',
  //     'wallet',
  //     'swagger-spec.json',
  //   );
  //   mkdirSync(join(process.cwd(), 'apps', 'wallet'), { recursive: true });
  //   writeFileSync(swaggerJsonPath, JSON.stringify(document, null, 2));
  //   console.log(`Swagger JSON 생성됨: ${swaggerJsonPath}`);
  // }

  // Swagger UI (서버에서 확인)
  SwaggerModule.setup('/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = process.env.PORT || 5000;
  await app.listen(port);
  console.log(`🚀 Wallet server is running on port ${port}`);
}
bootstrap();
