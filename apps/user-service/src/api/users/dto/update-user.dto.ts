import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AddressDto } from '../../../commons/dto/address.dto';

export class UpdateUserDto extends AddressDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(8)
  @IsOptional()
  username?: string;
}
