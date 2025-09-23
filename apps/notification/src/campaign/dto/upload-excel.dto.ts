// apps/notification/src/campaign/dto/upload-excel.dto.ts
import { IsString, IsArray, IsNotEmpty, ArrayMaxSize } from 'class-validator';
import { NOTIFICATION_CONSTANTS } from '../../shared/constants';

export class UploadExcelDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsArray()
    @IsString({ each: true })
    @ArrayMaxSize(NOTIFICATION_CONSTANTS.MAX_BULK_RECIPIENTS)
    userIds: string[];
}