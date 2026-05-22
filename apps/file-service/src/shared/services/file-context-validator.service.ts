import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { FileContext } from '../types/file.types';

@Injectable()
export class FileContextValidator {
  getPublicAccessPolicy(context: FileContext): {
    required: boolean;
    default?: boolean;
  } {
    const { allowPublic, allowPrivate } = context;

    if (!allowPublic && !allowPrivate) {
      throw new BadRequestError(`${context.name} does not allow any uploads`);
    }

    if (allowPublic && !allowPrivate) {
      return { required: false, default: true };
    }

    if (!allowPublic && allowPrivate) {
      return { required: false, default: false };
    }

    return { required: true };
  }

  resolveIsPublic(context: FileContext, requestedIsPublic?: boolean): boolean {
    const policy = this.getPublicAccessPolicy(context);

    if (policy.required && requestedIsPublic === undefined) {
      throw new BadRequestError(`${context.name} requires explicit isPublic value`);
    }

    const isPublic = requestedIsPublic ?? policy.default!;

    if (isPublic && !context.allowPublic) {
      throw new BadRequestError(`${context.name} does not allow public uploads`);
    }

    if (!isPublic && !context.allowPrivate) {
      throw new BadRequestError(`${context.name} does not allow private uploads`);
    }

    return isPublic;
  }

  /**
   * Check if actual MIME type matches the pattern
   * Supports:
   * - Exact match: "image/jpeg"
   * - Type wildcard: "image/*" (matches all image types including image/svg+xml)
   * - Full wildcard: (matches all types)
   */
  private matchesMimeType(actual: string, pattern: string): boolean {
    if (actual === pattern) {
      return true;
    }

    if (pattern === '*/*') {
      return true;
    }

    if (pattern.endsWith('/*')) {
      const [patternType] = pattern.split('/');
      const [actualType] = actual.split('/');
      return patternType === actualType;
    }

    return false;
  }

  /**
   * Validate MIME type against whitelist (throws exception)
   */
  validateMimeType(context: FileContext, mimeType: string): void {
    if (!context.allowedMimeTypes || context.allowedMimeTypes.length === 0) {
      return;
    }

    const isAllowed = context.allowedMimeTypes.some((pattern) => this.matchesMimeType(mimeType, pattern));

    if (!isAllowed) {
      throw new BadRequestError(
        `Invalid file type for ${context.name}. ` +
          `Allowed: ${context.allowedMimeTypes.join(', ')}. ` +
          `Got: ${mimeType}`,
      );
    }
  }

  /**
   * Check if MIME type is valid (returns boolean, no exception)
   */
  isValidMimeType(context: FileContext, mimeType: string): boolean {
    if (!context.allowedMimeTypes || context.allowedMimeTypes.length === 0) {
      return true;
    }

    return context.allowedMimeTypes.some((pattern) => this.matchesMimeType(mimeType, pattern));
  }

  validateFileSize(context: FileContext, size: number): void {
    if (size > context.maxFileSize) {
      throw new BadRequestError(
        `File size too large for ${context.name}. ` + `Max: ${(context.maxFileSize / 1024 / 1024).toFixed(1)}MB`,
      );
    }
  }
}
