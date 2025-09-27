// apps/notification/src/template/dto/preview-template.dto.ts
import { IsEnum, IsObject, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Language, Channel } from '../../shared/enums';

export class PreviewTemplateDto {
  @ApiProperty({
    type: [String],
    enum: Channel,
    description: '미리보기할 채널들',
    example: [Channel.EMAIL, Channel.KAKAO],
  })
  @IsArray()
  @IsEnum(Channel, { each: true })
  channels: Channel[]; // 미리보기할 채널들

  @ApiProperty({
    enum: Language,
    description: '언어',
    example: Language.KO, // 실제 enum 값으로 교체
  })
  @IsEnum(Language)
  language: Language;

  @ApiProperty({
    type: 'object',
    description: '템플릿 변수 데이터',
    example: {
      userName: '홍길동',
      orderNumber: 'ORD-12345',
      totalAmount: '50,000원',
      productName: '아몬드 영 셔츠',
      deliveryDate: '2024-01-20',
    },
    additionalProperties: true,
  })
  @IsObject()
  payload: Record<string, any>;
}
