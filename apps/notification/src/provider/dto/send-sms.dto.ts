import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiProperty({
    description:
      '발송 채널. 생략하면 SMS. KAKAO 는 고객이 「인증번호가 오지 않아요」로 카카오톡 발송을 고른 경우에 쓴다 — ' +
      '본문에서 인증번호를 꺼내 알림톡 템플릿으로 보낸다.',
    enum: ['SMS', 'KAKAO'],
    required: false,
    default: 'SMS',
  })
  @IsIn(['SMS', 'KAKAO'])
  @IsOptional()
  channel?: 'SMS' | 'KAKAO';
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
