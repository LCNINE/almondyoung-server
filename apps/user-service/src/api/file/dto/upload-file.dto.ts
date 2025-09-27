import { IsEnum } from 'class-validator';
import { S3_FOLDER_NAMES } from '../constants';

export class UploadFileDto {
  @IsEnum(S3_FOLDER_NAMES, { message: '올바른 폴더명이 아닙니다.' })
  folderName: keyof typeof S3_FOLDER_NAMES;
}
