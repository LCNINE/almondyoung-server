import { IsEnum } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';
import { matchingStrategyEnum } from '../../../schema/inventory.schema';

export class ChangeStrategyDto {
  @ApiProperty({
    description: '변경할 매칭 전략',
    enum: matchingStrategyEnum.enumValues,
  })
  @IsEnum(matchingStrategyEnum.enumValues)
  strategy: (typeof matchingStrategyEnum.enumValues)[number];
}
