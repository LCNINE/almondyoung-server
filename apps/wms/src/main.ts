// apps/wms/src/main.ts
import { NestFactory } from '@nestjs/core';
import { WmsModule } from './wms.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';

async function bootstrap() {
  const app = await NestFactory.create(WmsModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  app.enableShutdownHooks();

  const consumerOptions = EventsModule.forConsumer({
    streams: [PRODUCT_STREAM],
    groupId: 'wms-product-consumer',
  });

  app.connectMicroservice(consumerOptions);

  const config = new DocumentBuilder()
    .setTitle('WMS API')
    .setDescription('WMS Service API')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3010);
}
bootstrap();
