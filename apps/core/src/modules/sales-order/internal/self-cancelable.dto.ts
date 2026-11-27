import { ArrayMaxSize, IsArray, IsString, IsUUID, MaxLength } from 'class-validator';

export class SelfCancelableRequestDto {
  @IsUUID()
  customerId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  channelOrderIds!: string[];
}

export type SelfCancelableResponse = { channelOrderIds: string[] };
