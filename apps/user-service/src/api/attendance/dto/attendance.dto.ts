import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class LocationDto {
  @IsNumber() latitude: number;
  @IsNumber() longitude: number;
  @IsNumber() accuracy: number;
  @IsNumber() timestamp: number;
}

export class PunchDto {
  @IsIn(['in', 'out']) kind: 'in' | 'out';
  @IsUUID() requestId: string;
  @IsUUID() siteId: string;
  @ValidateNested() @Type(() => LocationDto) location: LocationDto;
}

export class LeaveDayDto {
  @IsString() date: string;
  @IsIn(['full', 'am', 'pm']) type: 'full' | 'am' | 'pm';
  @IsOptional() @IsString() start?: string;
  @IsOptional() @IsString() end?: string;
}

export class LeaveBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(366)
  @ValidateNested({ each: true })
  @Type(() => LeaveDayDto)
  days: LeaveDayDto[];
}

export class AttendanceSettingsDto {
  @IsString() normalStart: string;
  @IsString() normalEnd: string;
  @IsBoolean() inEnabled: boolean;
  @IsBoolean() outEnabled: boolean;
  @IsString() inTime: string;
  @IsString() outTime: string;
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays: number[];
  @IsOptional() @IsString() skipDate: string | null;
  @IsBoolean() sound: boolean;
}

export class WorksiteDto {
  @IsString() @MaxLength(80) name: string;
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsInt() @Min(10) @Max(1000) radiusMeters: number;
  @IsInt() @Min(1) @Max(500) accuracyMeters: number;
}

export class CreateRequestDto {
  @IsString() workDate: string;
  @IsOptional() @IsString() checkIn?: string;
  @IsOptional() @IsString() checkOut?: string;
  @IsString() @MaxLength(5000) reason: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsUUID(undefined, { each: true }) fileIds?: string[];
}

export class DecisionDto {
  @IsInt() @Min(1) version: number;
  @IsIn(['approved', 'rejected', 'needs_information']) status: 'approved' | 'rejected' | 'needs_information';
  @IsString() @MaxLength(2000) reason: string;
}
