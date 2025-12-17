import { Injectable, BadRequestException } from '@nestjs/common';
import { FileContext } from '../types/file.types';

@Injectable()
export class FileContextValidator {
  getPublicAccessPolicy(context: FileContext): {
    required: boolean;
    default?: boolean;
  } {
    const { allowPublic, allowPrivate } = context;

    if (!allowPublic && !allowPrivate) {
      throw new BadRequestException(
        `${context.name} does not allow any uploads`,
      );
    }

    if (allowPublic && !allowPrivate) {
      return { required: false, default: true };
    }

    if (!allowPublic && allowPrivate) {
      return { required: false, default: false };
    }

    return { required: true };
  }

  resolveIsPublic(
    context: FileContext,
    requestedIsPublic?: boolean,
  ): boolean {
    const policy = this.getPublicAccessPolicy(context);

    if (policy.required && requestedIsPublic === undefined) {
      throw new BadRequestException(
        `${context.name} requires explicit isPublic value`,
      );
    }

    const isPublic = requestedIsPublic ?? policy.default!;

    if (isPublic && !context.allowPublic) {
      throw new BadRequestException(
        `${context.name} does not allow public uploads`,
      );
    }

    if (!isPublic && !context.allowPrivate) {
      throw new BadRequestException(
        `${context.name} does not allow private uploads`,
      );
    }

    return isPublic;
  }

  validateMimeType(context: FileContext, mimeType: string): void {
    if (
      context.allowedMimeTypes &&
      !context.allowedMimeTypes.includes(mimeType)
    ) {
      throw new BadRequestException(
        `Invalid file type for ${context.name}. ` +
          `Allowed: ${context.allowedMimeTypes.join(', ')}`,
      );
    }
  }

  validateFileSize(context: FileContext, size: number): void {
    if (size > context.maxFileSize) {
      throw new BadRequestException(
        `File too large for ${context.name}. ` +
          `Max: ${(context.maxFileSize / 1024 / 1024).toFixed(1)}MB`,
      );
    }
  }
}

