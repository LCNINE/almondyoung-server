import { AlmondPrintFileManager } from './almond-print-file.manager';
import type { PrintFileClient } from '../clients/print-file.client';
import type { AlmondDesignManager } from './almond-design.manager';
import type { AlmondDesignPrinter } from './almond-design.printer';
import type { AlmondDesignReader } from './almond-design.reader';

const ID = '11111111-1111-4111-8111-111111111111';
const LINK = { url: 'https://s3.example/print', expiresAt: '2026-10-13T00:05:00Z' };

function setup(printFiles: Record<string, string>, cachedLink: typeof LINK | null) {
  const reader = {
    findPrintFiles: jest.fn().mockResolvedValue(printFiles),
    findPrintSource: jest.fn().mockResolvedValue({ id: ID, frontSvg: '<svg/>', backSvg: null }),
  };
  const manager = { savePrintFile: jest.fn().mockResolvedValue(undefined) };
  const printer = {
    print: jest.fn().mockResolvedValue({ fileName: 'x', contentType: 'image/jpeg', body: Buffer.from('jpg') }),
  };
  const files = {
    upload: jest.fn().mockResolvedValue('new-file'),
    downloadUrl: jest
      .fn()
      .mockImplementation((fileId: string) => Promise.resolve(fileId === 'new-file' ? LINK : cachedLink)),
  };
  const service = new AlmondPrintFileManager(
    reader as unknown as AlmondDesignReader,
    manager as unknown as AlmondDesignManager,
    printer as unknown as AlmondDesignPrinter,
    files as unknown as PrintFileClient,
  );
  return { service, printer, files, manager };
}

describe('AlmondPrintFileManager', () => {
  it('같은 형식·dpi 로 만든 파일이 있으면 다시 렌더하지 않고 링크만 준다', async () => {
    const { service, printer, files } = setup({ 'jpg@350': 'old-file' }, LINK);
    await expect(service.link(ID, 'jpg', 350, 'token')).resolves.toEqual({
      ...LINK,
      fileName: `almond-design-${ID}-350dpi.jpg`,
    });
    expect(printer.print).not.toHaveBeenCalled();
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('없거나 지워졌으면 렌더해서 올리고 키를 저장한다', async () => {
    const { service, printer, files, manager } = setup({ 'jpg@350': 'gone-file' }, null);
    await expect(service.link(ID, 'jpg', 300, 'token')).resolves.toMatchObject({ url: LINK.url });
    expect(printer.print).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), 'jpg', 300);
    expect(files.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      `almond-design-${ID}-300dpi.jpg`,
      'image/jpeg',
      'token',
    );
    expect(manager.savePrintFile).toHaveBeenCalledWith(ID, 'jpg@300', 'new-file');
  });

  it('만드는 중에 다시 누르면 새로 렌더하지 않고 진행 중인 것을 기다린다', async () => {
    const { service, printer } = setup({}, null);
    const [first, second] = await Promise.all([
      service.link(ID, 'pdf', 300, 'token'),
      service.link(ID, 'pdf', 300, 'token'),
    ]);
    expect(first.url).toBe(LINK.url);
    expect(second.url).toBe(LINK.url);
    expect(printer.print).toHaveBeenCalledTimes(1);

    await service.link(ID, 'pdf', 300, 'token');
    expect(printer.print).toHaveBeenCalledTimes(2);
  });
});
