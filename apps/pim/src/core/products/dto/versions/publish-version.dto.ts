import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class PublishVersionDto {
  @ApiProperty({
    description: '버전 상태',
    enum: ['active', 'inactive'],
    example: 'active',
  })
  @IsEnum(['active', 'inactive'])
  targetStatus: 'active' | 'inactive';
}

