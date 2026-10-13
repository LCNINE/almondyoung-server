import { Injectable } from '@nestjs/common';
import { UpstreamUnavailableError } from '@app/shared';
import { PrintFileClient } from '../clients/print-file.client';
import { type AlmondPrintFormat, type AlmondPrintLink } from '../types/almond-design.types';
import { AlmondDesignManager } from './almond-design.manager';
import { AlmondDesignPrinter } from './almond-design.printer';
import { AlmondDesignReader } from './almond-design.reader';

@Injectable()
export class AlmondPrintFileManager {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly reader: AlmondDesignReader,
    private readonly manager: AlmondDesignManager,
    private readonly printer: AlmondDesignPrinter,
    private readonly files: PrintFileClient,
  ) {}

  async link(id: string, format: AlmondPrintFormat, dpi: number, accessToken: string): Promise<AlmondPrintLink> {
    const key = format === 'jpg' ? `jpg@${dpi}` : format;
    const fileName = `almond-design-${id}${format === 'jpg' ? `-${dpi}dpi` : ''}.${format}`;
    const cached = (await this.reader.findPrintFiles(id))[key];
    const reused = cached ? await this.files.downloadUrl(cached, accessToken) : null;
    if (reused) return { ...reused, fileName };

    const fileId = await this.createOnce(`${id}:${key}`, async () => {
      const file = await this.printer.print(await this.reader.findPrintSource(id), format, dpi);
      const uploaded = await this.files.upload(file.body, fileName, file.contentType, accessToken);
      await this.manager.savePrintFile(id, key, uploaded);
      return uploaded;
    });
    const created = await this.files.downloadUrl(fileId, accessToken);
    if (!created) throw new UpstreamUnavailableError('방금 올린 인쇄 파일을 찾을 수 없습니다.');
    return { ...created, fileName };
  }

  // ponytail: 태스크 하나 안에서만 합친다. 태스크가 여럿이면 같은 파일을 한 번 더 만들 뿐 결과는 같다.
  private createOnce(key: string, create: () => Promise<string>): Promise<string> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const created = create().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, created);
    return created;
  }
}
