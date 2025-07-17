import { FileValidator } from '@nestjs/common/pipes/file/file-validator.interface';
import { FileTypeValidator, MaxFileSizeValidator } from '@nestjs/common';
import { MultipartOptions } from '../models/multipart-options.model';

export const getFileFromPart = async (part: any) => {
  const buffer = await part.toBuffer();
  return {
    buffer,
    size: buffer.byteLength,
    filename: part.filename,
    mimetype: part.mimetype,
    fieldname: part.fieldname,
  };
};

export const validateFile = (
  file: any,
  options: MultipartOptions,
): string | void => {
  const validators: FileValidator[] = [];
  if (options.maxFileSize)
    validators.push(new MaxFileSizeValidator({ maxSize: options.maxFileSize }));
  if (options.fileType)
    validators.push(new FileTypeValidator({ fileType: options.fileType }));
  for (const validator of validators) {
    if (validator.isValid(file)) continue;
    return validator.buildErrorMessage(file);
  }
};
