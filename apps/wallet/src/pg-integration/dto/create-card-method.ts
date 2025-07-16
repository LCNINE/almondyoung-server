import { IsString, IsBoolean, IsOptional, Length, Matches, IsNotEmpty } from 'class-validator';


export class CreateCardMethodDto {

  @IsNotEmpty()
  userId: number;

  @IsString()
  @IsNotEmpty()
  methodName: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean = false;

  @IsString()
  @IsNotEmpty()
  institutionCode: string;

  @IsString()
  @Length(16, 16)
  @Matches(/^\d{16}$/, { message: '카드 번호는 16자리 숫자여야 합니다' })
  cardNumber: string;

  @IsString()
  @Matches(/^(0[1-9]|1[0-2])\/\d{2}$/, { message: '유효기간은 MM/YY 형식이어야 합니다' })
  expiryDate: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^\d{3}$/, { message: 'CVC는 3자리 숫자여야 합니다' })
  cvc: string;

  @IsString()
  @IsNotEmpty()
  holderName: string;

  @IsString()
  @Length(2, 2)
  @Matches(/^\d{2}$/, { message: '카드 비밀번호는 2자리 숫자여야 합니다' })
  @IsOptional()
  cardPassword?: string;
}