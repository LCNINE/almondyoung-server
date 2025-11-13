import { ApiProperty } from '@nestjs/swagger';

export class SupplierContactDto {
  @ApiProperty({ description: 'Phone number', required: false, nullable: true })
  phone: string | null;

  @ApiProperty({ description: 'Fax number', required: false, nullable: true })
  fax: string | null;

  @ApiProperty({ description: 'Email address', required: false, nullable: true })
  email: string | null;
}

export class SupplierAddressDto {
  @ApiProperty({ description: 'Zip code', required: false, nullable: true })
  zipcode: string | null;

  @ApiProperty({ description: 'Primary address', required: false, nullable: true })
  address1: string | null;

  @ApiProperty({ description: 'Detailed address', required: false, nullable: true })
  address2: string | null;
}

export class SupplierBusinessInfoDto {
  @ApiProperty({ description: 'Business registration number', required: false, nullable: true })
  businessRegNo: string | null;

  @ApiProperty({ description: 'Business type', required: false, nullable: true })
  businessType: string | null;

  @ApiProperty({ description: 'CEO name', required: false, nullable: true })
  ceoName: string | null;
}

export class SupplierPurchaseSettingsDto {
  @ApiProperty({ description: 'Direct delivery flag', required: false, nullable: true })
  isDirectDelivery: boolean | null;

  @ApiProperty({ description: 'Order cutoff time (e.g., "18:00")', required: false, nullable: true })
  orderCutoffTime: string | null;
}

export class SupplierPaymentInfoDto {
  @ApiProperty({ description: 'Bank name', required: false, nullable: true })
  bankName: string | null;

  @ApiProperty({ description: 'Bank account number', required: false, nullable: true })
  bankAccountNo: string | null;

  @ApiProperty({ description: 'Bank account holder name', required: false, nullable: true })
  bankAccountHolder: string | null;

  @ApiProperty({ 
    description: 'Payment method (e.g., prepaid, postpaid, monthly)', 
    required: false, 
    nullable: true 
  })
  paymentMethod: string | null;
}

export class SupplierCategoryInfoDto {
  @ApiProperty({ description: 'Category ID' })
  id: string;

  @ApiProperty({ description: 'Category name' })
  name: string;

  @ApiProperty({ description: 'Category description', required: false, nullable: true })
  description: string | null;
}

export class SupplierResponseDto {
  @ApiProperty({ description: 'Supplier ID' })
  id: string;

  @ApiProperty({ description: 'Supplier name' })
  name: string;

  @ApiProperty({ 
    description: 'Contact information', 
    type: SupplierContactDto,
    required: false,
    nullable: true
  })
  contact: SupplierContactDto | null;

  @ApiProperty({ 
    description: 'Address information', 
    type: SupplierAddressDto,
    required: false,
    nullable: true
  })
  address: SupplierAddressDto | null;

  @ApiProperty({ 
    description: 'Business information', 
    type: SupplierBusinessInfoDto,
    required: false,
    nullable: true
  })
  businessInfo: SupplierBusinessInfoDto | null;

  @ApiProperty({ 
    description: 'Purchase settings', 
    type: SupplierPurchaseSettingsDto,
    required: false,
    nullable: true
  })
  purchaseSettings: SupplierPurchaseSettingsDto | null;

  @ApiProperty({ 
    description: 'Payment information', 
    type: SupplierPaymentInfoDto,
    required: false,
    nullable: true
  })
  paymentInfo: SupplierPaymentInfoDto | null;

  @ApiProperty({ description: 'Description', required: false, nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Internal memo', required: false, nullable: true })
  memo: string | null;

  @ApiProperty({ description: 'Purchase manager user ID (from user-service)', required: false, nullable: true })
  purchaseManagerId: string | null;

  @ApiProperty({ description: 'Default warehouse ID', required: false, nullable: true })
  defaultWarehouseId: string | null;

  @ApiProperty({ 
    description: 'Supplier categories', 
    type: [SupplierCategoryInfoDto],
    required: false
  })
  categories: SupplierCategoryInfoDto[];

  @ApiProperty({ description: 'Created at' })
  createdAt: string;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: string;
}

