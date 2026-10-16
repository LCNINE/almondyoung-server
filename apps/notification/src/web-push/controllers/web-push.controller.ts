import { InternalOnly } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { BrowserSubscriptionDto, RemoveSubscriptionDto, SendBrowserPushDto } from '../dto/web-push.dto';
import { WebPushService } from '../services/web-push.service';

@Controller('web-push')
export class WebPushController {
  constructor(private readonly service: WebPushService) {}

  @Get('config')
  config() {
    return this.service.config();
  }

  @Post('subscriptions')
  register(@CurrentUser() user: { userId: string }, @Body() input: BrowserSubscriptionDto) {
    return this.service.register(user.userId, input);
  }

  @Delete('subscriptions')
  remove(@CurrentUser() user: { userId: string }, @Body() input: RemoveSubscriptionDto) {
    return this.service.remove(user.userId, input.endpoint);
  }
}

@Controller('internal/web-push')
@InternalOnly()
export class InternalWebPushController {
  constructor(private readonly service: WebPushService) {}

  @Post('send')
  send(@Body() input: SendBrowserPushDto) {
    return this.service.send(input);
  }
}
