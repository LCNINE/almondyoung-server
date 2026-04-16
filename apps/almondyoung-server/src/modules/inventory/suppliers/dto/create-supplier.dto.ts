import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsBoolean, IsUUID, IsArray, MaxLength } from 'class-validator';

export class CreateSupplierDto {
  @ApiProperty({ description: 'Supplier name' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ description: 'Phone number', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiProperty({ description: 'Fax number', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fax?: string;

  @ApiProperty({ description: 'Email address', required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiProperty({ description: 'Zip code', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zipcode?: string;

  @ApiProperty({ description: 'Primary address', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address1?: string;

  @ApiProperty({ description: 'Detailed address', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address2?: string;

  @ApiProperty({ description: 'Business registration number', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  businessRegNo?: string;

  @ApiProperty({ description: 'Business type', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessType?: string;

  @ApiProperty({ description: 'CEO name', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ceoName?: string;

  @ApiProperty({ description: 'Direct delivery flag', required: false })
  @IsOptional()
  @IsBoolean()
  isDirectDelivery?: boolean;

  @ApiProperty({ description: 'Order cutoff time (e.g., "18:00")', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  orderCutoffTime?: string;

  @ApiProperty({ description: 'Bank name', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiProperty({ description: 'Bank account number', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccountNo?: string;

  @ApiProperty({ description: 'Bank account holder name', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccountHolder?: string;

  @ApiProperty({
    description: 'Payment method (e.g., prepaid, postpaid, monthly)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @ApiProperty({ description: 'Description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Internal memo', required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ description: 'Purchase manager user ID (from user-service)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  purchaseManagerId?: string;

  @ApiProperty({ description: 'Default warehouse ID', required: false })
  @IsOptional()
  @IsUUID()
  defaultWarehouseId?: string;

  @ApiProperty({
    description: 'Category IDs to associate with supplier',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];
}
