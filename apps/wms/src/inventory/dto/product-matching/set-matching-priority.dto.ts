import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { matchingPriorityEnum } from 'apps/wms/database/schemas/wms-schema';

export class SetMatchingPriorityDto {
    @ApiProperty({ description: '매칭 우선순위', enum: matchingPriorityEnum.enumValues })
    @IsEnum(matchingPriorityEnum.enumValues)
    priority: typeof matchingPriorityEnum.enumValues[number];
}