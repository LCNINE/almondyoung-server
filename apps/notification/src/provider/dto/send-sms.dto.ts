import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendSmsDto {
  @ApiProperty({ description: '수신 번호. E.164(+8210…) 와 로컬 표기(01012345678) 둘 다 받는다.' })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({ description: '본문. 90바이트를 넘으면 장문(MMS)으로 발송된다.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class SendSmsResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ required: false, description: '프로바이더가 부여한 발송 식별자' })
  messageId?: string;

  @ApiProperty({ required: false })
  error?: string;

  @ApiProperty({ description: '실제로 발송한 프로바이더 이름' })
  provider: string;
}
