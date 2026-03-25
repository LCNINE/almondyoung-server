import { Injectable, Logger } from '@nestjs/common';
import { FileTypeResult } from 'file-type';

@Injectable()
export class FileTypeDetector {
  private readonly logger = new Logger(FileTypeDetector.name);

  private normalizeMimeType(mimeType: string): string {
    const normalizations: Record<string, string> = {
      'image/jpg': 'image/jpeg',
      'image/jpe': 'image/jpeg',
      'image/svg': 'image/svg+xml',
      'text/plain; charset=utf-8': 'text/plain',
      'text/csv; charset=utf-8': 'text/csv',
      'application/x-pdf': 'application/pdf',
    };

    const normalized = normalizations[mimeType.toLowerCase()];
    if (normalized && normalized !== mimeType) {
      this.logger.debug(`Normalized MIME type: ${mimeType} → ${normalized}`);
      return normalized;
    }

    return mimeType;
  }

  async detectMimeType(buffer: Buffer): Promise<string | null> {
    try {
      const sample = buffer.length > 4100 ? buffer.subarray(0, 4100) : buffer;

      const { fileTypeFromBuffer } = await import('file-type');
      const result: FileTypeResult | undefined = await fileTypeFromBuffer(sample);

      if (result) {
        const normalized = this.normalizeMimeType(result.mime);
        this.logger.debug(`Detected MIME type: ${normalized}`);
        return normalized;
      }

      this.logger.debug('Could not detect MIME type from buffer (likely text-based file)');
      return null;
    } catch (error) {
      this.logger.error(`File type detection failed: ${error.message}`);
      return null;
    }
  }

  normalizeClientMimeType(mimeType: string): string {
    return this.normalizeMimeType(mimeType);
  }
}
