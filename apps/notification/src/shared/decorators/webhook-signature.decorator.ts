// apps/notification/src/shared/decorators/webhook-signature.decorator.ts
import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

export const WebhookSignature = createParamDecorator(
  (data: { secret: string; headerName: string }, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const signature = request.headers[data.headerName];
    const body = request.rawBody || JSON.stringify(request.body);

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const expectedSignature = crypto.createHmac('sha256', data.secret).update(body).digest('hex');

    if (signature !== expectedSignature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  },
);
