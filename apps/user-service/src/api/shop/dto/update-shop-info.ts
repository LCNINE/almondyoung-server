import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import { CreateShopInfoDto } from './create-shop-info.dto';

export class UpdateShopInfoDto extends PartialType(CreateShopInfoDto) {}
