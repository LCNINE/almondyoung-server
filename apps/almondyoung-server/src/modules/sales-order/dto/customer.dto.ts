import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional } from 'class-validator';

export class CustomerDto {
  @ApiProperty({ description: '고객 이름', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: '고객 이메일', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: '고객 전화번호', required: false })
  @IsString()
  @IsOptional()
  phone?: string;
}
