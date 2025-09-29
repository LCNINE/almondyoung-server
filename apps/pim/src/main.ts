import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { PimModule } from './pim.module';

async function bootstrap() {
  const app = await NestFactory.create(PimModule);

  // app.useGlobalPipes(
  //   new ValidationPipe({
  //     whitelist: true,
  //     transform: true,
  //     forbidNonWhitelisted: true,
  //     disableErrorMessages: false,
  //     validationError: { target: false, value: false },
  //   }),
  // );
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('PIM API')
    .setDescription(
      '상품 정보 관리 시스템 (Product Information Management) API',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
