import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateVisibilityDto {
  @ApiProperty({
    description: '표시 여부',
    type: Boolean,
    example: true,
  })
  @IsBoolean()
  visible: boolean;
}

