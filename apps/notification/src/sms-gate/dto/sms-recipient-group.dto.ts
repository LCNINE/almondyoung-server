import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const GROUP_RECIPIENTS_BATCH_MAX = 5000;

export class CreateSmsRecipientGroupDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class SmsGroupRecipientInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ description: '010-1234-5678, 01012345678, +821012345678 모두 받는다' })
  @IsString()
  @MaxLength(40)
  phone: string;
}

export class AddSmsGroupRecipientsDto {
  @ApiProperty({ type: [SmsGroupRecipientInputDto] })
  @IsArray()
  @ArrayMaxSize(GROUP_RECIPIENTS_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => SmsGroupRecipientInputDto)
  recipients: SmsGroupRecipientInputDto[];
}

export class ImportSupabaseGroupDto extends CreateSmsRecipientGroupDto {
  @ApiProperty({ description: 'canonical_places.category (예: lash_shops)' })
  @IsString()
  @Matches(/^[a-z0-9_]+$/)
  category: string;
}
