import { IsObject, IsString } from 'class-validator';

export class TossWebhookBodyDto {
  @IsString()
  eventType: string;

  @IsString()
  createdAt: string;

  @IsObject()
  data: Record<string, unknown>;
}
