import { Exclude, Expose } from 'class-transformer';

export class CardMethodResponseDto {

  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  methodName: string;

  @Expose()
  institutionCode: string;

  @Expose()
  institutionName: string;

  @Expose()
  maskedCardNumber: string;

  @Expose()
  cardBrand: string;

  @Expose()
  cardType: string;

  @Expose()
  isDefault: boolean;

  @Expose()
  isActive: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  // 민감 정보는 제외
  @Exclude()
  billingKey: string;

  @Exclude()
  cardNumber: string;

  @Exclude()
  cvc: string;

  constructor(partial: Partial<CardMethodResponseDto>) {
    Object.assign(this, partial);
  }
}

export class CardMethodListResponseDto {
  @Expose()
  items: CardMethodResponseDto[];

  @Expose()
  total: number;

  constructor(items: CardMethodResponseDto[], total: number) {
    this.items = items;
    this.total = total;
  }
}