import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateCardMethodDto {
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @IsString()
  @IsNotEmpty()
  cardNumber: string;

  @IsString()
  @IsOptional()
  cardType?: string;

  @IsString()
  @IsOptional()
  cardName?: string;

  @IsOptional()
  isDefault?: boolean;

  // HMS 카드 등록에 필요한 필드
  @IsString()
  @IsNotEmpty()
  memberName: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  validMonth: string;

  @IsString()
  @IsNotEmpty()
  validYear: string;

  @IsString()
  @IsNotEmpty()
  cardPassword: string;

  @IsString()
  @IsNotEmpty()
  identityNumber: string;

  @IsString()
  @IsNotEmpty()
  customerEmail: string;

  @IsString()
  @IsNotEmpty()
  payerName: string;
}
