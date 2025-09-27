import { IsString, IsArray, IsOptional, IsEnum, IsObject } from 'class-validator';

export class CreateEventDto {
    @IsString()
    eventKey: string;

    @IsString()
    name: string;

    @IsString()
    description: string;

    @IsString()
    templateKey: string;

    @IsEnum(['TRANSACTIONAL', 'MARKETING', 'SYSTEM', 'ADMIN', 'OPERATIONAL', 'CUSTOMER_SERVICE'])
    category: string;

    @IsArray()
    @IsString({ each: true })
    defaultChannels: string[];

    @IsEnum(['URGENT', 'HIGH', 'NORMAL', 'LOW'])
    @IsOptional()
    priority?: string;

    @IsObject()
    @IsOptional()
    conditions?: Record<string, any>;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
    @IsOptional()
    isActive?: boolean;
}

export class UpdateEventDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    templateKey?: string;

    @IsEnum(['TRANSACTIONAL', 'MARKETING', 'SYSTEM', 'ADMIN', 'OPERATIONAL', 'CUSTOMER_SERVICE'])
    @IsOptional()
    category?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    defaultChannels?: string[];

    @IsEnum(['URGENT', 'HIGH', 'NORMAL', 'LOW'])
    @IsOptional()
    priority?: string;

    @IsObject()
    @IsOptional()
    conditions?: Record<string, any>;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
    @IsOptional()
    isActive?: boolean;
}

export class TriggerEventDto {
    @IsString()
    eventKey: string;

    @IsString()
    userId: string;

    @IsObject()
    @IsOptional()
    payload?: Record<string, any>;
}
