import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { OrderContactOutcome } from '../schema/customer-service.schema';

export const ORDER_CONTACT_OUTCOMES = [
  'reached',
  'no_answer',
  'messaged',
] as const satisfies readonly OrderContactOutcome[];

export class CreateOrderContactDto {
  @ApiProperty({ description: '화면이 정한 요청 id. 같은 값으로 다시 보내면 한 번만 남는다' })
  @IsUUID()
  id!: string;

  @ApiProperty()
  @IsUUID()
  salesOrderId!: string;

  @ApiProperty({ enum: ORDER_CONTACT_OUTCOMES })
  @IsIn(ORDER_CONTACT_OUTCOMES)
  outcome!: OrderContactOutcome;

  @ApiProperty({ description: '한 줄 내용. 비울 수 있다', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @ApiProperty({ description: '다시 연락할 날(YYYY-MM-DD, 한국 날짜)', required: false, nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  followUpOn?: string | null;
}

export class OrderContactCreatedDto {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: string;
}

export class OrderContactDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ORDER_CONTACT_OUTCOMES }) outcome!: OrderContactOutcome;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true, type: String }) followUpOn!: string | null;
  @ApiProperty() authorId!: string;
  @ApiProperty() createdAt!: string;
}

export class OrderContactListDto {
  @ApiProperty({ type: [OrderContactDto], description: '최근 것부터' }) items!: OrderContactDto[];
}
