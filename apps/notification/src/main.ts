// apps/notification/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NotificationModule } from './notification.module';
import { AllExceptionsFilter } from './shared/filters/exception.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import * as bodyParser from 'body-parser';

async function bootstrap() {
    const app = await NestFactory.create(NotificationModule, {
        bodyParser: false, // 기본 body parser 비활성화
    });

    // Raw body를 저장하는 미들웨어 (웹훅용)
    const rawBodyBuffer = (req: any, res: any, buffer: Buffer, encoding: BufferEncoding) => {
        if (buffer && buffer.length) {
            req.rawBody = buffer.toString(encoding as BufferEncoding || 'utf8');
        }
    };

    // 웹훅 경로에는 raw body 파서 적용
    app.use('/api/v1/webhooks/resend', bodyParser.json({
        verify: rawBodyBuffer
    }));

    // 나머지 경로에는 일반 JSON 파서 적용
    app.use(bodyParser.json({ verify: rawBodyBuffer }));
    app.use(bodyParser.urlencoded({ extended: true }));

    // Global pipes
    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));

    // Global filters
    app.useGlobalFilters(new AllExceptionsFilter());

    // Global interceptors
    app.useGlobalInterceptors(new LoggingInterceptor());

    // CORS
    app.enableCors({
        origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
        credentials: true,
    });

    const port = process.env.NOTIFICATION_PORT ?? 5001;
    await app.listen(port);

    console.log(`Notification service is running on port ${port}`);
}
bootstrap();