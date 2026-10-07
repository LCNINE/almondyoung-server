import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, Matches } from 'class-validator';

export class LinkAlimtalkAutoNoticeDto {
  @ApiProperty({ description: '카카오 승인된 알림톡 템플릿 코드' })
  @Matches(/^[A-Za-z0-9_]{1,20}$/)
  templateCode: string;

  @ApiPropertyOptional({ description: '켜진 알림의 템플릿을 바꾸는 것을 확인했다' })
  @IsOptional()
  @IsBoolean()
  replaceActive?: boolean;
}
