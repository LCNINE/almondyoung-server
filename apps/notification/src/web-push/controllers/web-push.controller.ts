import { InternalOnly, RequirePermission } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import {
  BrowserSubscriptionDto,
  RemoveSubscriptionDto,
  SendBrowserPushDto,
  TestBrowserPushDto,
} from '../dto/web-push.dto';
import { WebPushService } from '../services/web-push.service';

@Controller('web-push')
export class WebPushController {
  constructor(private readonly service: WebPushService) {}

  @Get('config')
  @RequirePermission('attendance.own.write')
  config() {
    return this.service.config();
  }

  @Post('subscriptions')
  @RequirePermission('attendance.own.write')
  register(@CurrentUser() user: { userId: string }, @Body() input: BrowserSubscriptionDto) {
    return this.service.register(user.userId, input);
  }

  @Delete('subscriptions')
  @RequirePermission('attendance.own.write')
  remove(@CurrentUser() user: { userId: string }, @Body() input: RemoveSubscriptionDto) {
    return this.service.remove(user.userId, input.endpoint);
  }

  @Post('test')
  @RequirePermission('attendance.own.write')
  test(@CurrentUser() user: { userId: string }, @Body() input: TestBrowserPushDto) {
    return this.service.sendTest(user.userId, input.endpoint);
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
