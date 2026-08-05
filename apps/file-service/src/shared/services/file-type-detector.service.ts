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

  /**
   * **버퍼를 자르지 않는다.** 예전에는 앞 4100바이트만 넘겼는데, 그 4100 은 `file-type` 이
   * 요구하는 *최소* 바이트 수이지 상한이 아니다.
   *
   * zip 컨테이너(`.xlsx`·`.docx`·`.pptx`)는 판별 단서가 어디 있을지 정해져 있지 않다.
   * `file-type` 은 엔트리를 훑다가 `[Content_Types].xml` 을 만나야 일반 zip 이 아니라고
   * 확정하는데, **그 엔트리 위치는 파일을 만든 도구마다 다르다** — exceljs·Excel 은 맨 앞에,
   * **openpyxl 은 맨 뒤에** 쓴다. 그래서 앞부분만 보면 openpyxl 산출물이 전부
   * `application/zip` 으로 떨어져 업로드가 400 으로 거부됐다
   * (`skills/product-bulk-form` 의 `write_form.py` 가 openpyxl 을 쓴다).
   *
   * 자르는 것이 I/O 를 아껴주지도 않는다 — `buffer` 는 이미 메모리에 통째로 올라와 있다.
   * 회귀는 `file-type-detector.service.spec.ts` 가 잡는다.
   */
  async detectMimeType(buffer: Buffer): Promise<string | null> {
    try {
      const { fileTypeFromBuffer } = await import('file-type');
      const result: FileTypeResult | undefined = await fileTypeFromBuffer(buffer);

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
