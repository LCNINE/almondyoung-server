import { Type } from 'class-transformer';
import { IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

class PushKeysDto {
  @IsString()
  @MaxLength(200)
  auth: string;

  @IsString()
  @MaxLength(200)
  p256dh: string;
}

export class BrowserSubscriptionDto {
  @IsString()
  @MaxLength(4096)
  endpoint: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;
}

export class RemoveSubscriptionDto {
  @IsString()
  @MaxLength(4096)
  endpoint: string;
}

export class TestBrowserPushDto {
  @IsString()
  @MaxLength(4096)
  endpoint: string;
}

export class SendBrowserPushDto {
  @IsUUID()
  userId: string;

  @IsString()
  @MaxLength(200)
  key: string;

  @IsString()
  @MaxLength(100)
  title: string;

  @IsString()
  @MaxLength(500)
  body: string;

  @IsString()
  @MaxLength(100)
  url: string;
}
