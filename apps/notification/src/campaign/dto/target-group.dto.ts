// apps/notification/src/campaign/dto/target-group.dto.ts
import { IsString, IsEnum, IsObject, IsOptional, IsArray } from 'class-validator';

export class TargetGroupDto {
    @IsString()
    name: string;

    @IsEnum(['all', 'filter', 'excel', 'search'])
    type: 'all' | 'filter' | 'excel' | 'search';

    @IsObject()
    @IsOptional()
    criteria?: {
        membershipTypes?: string[];
        shopCategories?: string[];
        email?: string;
        phoneNumber?: string;
        limit?: number;
    };

    @IsArray()
    @IsOptional()
    userList?: string[];
}