import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { LocalFileController } from './local-file.controller';

/** `res` 중 이 컨트롤러가 실제로 쓰는 세 가지만 기록하는 대역. */
function fakeResponse() {
  const headers: Record<string, string> = {};
  const sent: Buffer[] = [];
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    send: (body: Buffer) => {
      sent.push(body);
    },
  } as unknown as Response;
  return { res, headers, sent };
}

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('LocalFileController', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'local-file-ctrl-'));
    await fs.mkdir(path.join(baseDir, 'product-bulk-form', '2026', '08'), { recursive: true });
    await fs.writeFile(
      path.join(baseDir, 'product-bulk-form', '2026', '08', 'abc.xlsx'),
      Buffer.from('workbook-bytes'),
    );
    // 루트 **밖**에 두는 표적. 경로 탈출이 막히는지 확인할 때 쓴다.
    await fs.writeFile(path.join(baseDir, '..', 'outside.txt'), Buffer.from('secret'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(path.join(baseDir, '..', 'outside.txt'), { force: true });
  });

  function controller(storageProvider: string) {
    return new LocalFileController(config({ LOCAL_STORAGE_DIR: baseDir, STORAGE_PROVIDER: storageProvider }));
  }

  it('STORAGE_PROVIDER 가 LOCAL 이 아니면 파일이 있어도 404 다', async () => {
    const { res } = fakeResponse();
    await expect(
      controller('S3').serve(['product-bulk-form', '2026', '08', 'abc.xlsx'], res),
    ).rejects.toThrow(NotFoundException);
  });

  it('LOCAL 이면 바이트를 확장자에 맞는 Content-Type 으로 돌려준다', async () => {
    const { res, headers, sent } = fakeResponse();
    await controller('LOCAL').serve(['product-bulk-form', '2026', '08', 'abc.xlsx'], res);

    expect(sent[0].toString()).toBe('workbook-bytes');
    expect(headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    // disposition 을 안 주면 헤더도 안 붙는다 — S3 의 미지정 동작(inline)과 같다.
    expect(headers['Content-Disposition']).toBeUndefined();
  });

  it('disposition 쿼리를 그대로 Content-Disposition 으로 싣는다 (download=true 대응물)', async () => {
    const { res, headers } = fakeResponse();
    const disposition = "attachment; filename*=UTF-8''%EC%96%91%EC%8B%9D.xlsx";
    await controller('LOCAL').serve(['product-bulk-form', '2026', '08', 'abc.xlsx'], res, disposition);

    expect(headers['Content-Disposition']).toBe(disposition);
  });

  it('키가 세그먼트 문자열로 와도 배열과 똑같이 처리한다 (Express 4/5 차이 흡수)', async () => {
    const { res, sent } = fakeResponse();
    await controller('LOCAL').serve('product-bulk-form/2026/08/abc.xlsx', res);

    expect(sent[0].toString()).toBe('workbook-bytes');
  });

  it('`..` 로 루트를 벗어나는 키는 실제로 파일이 있어도 404 다', async () => {
    const { res } = fakeResponse();
    await expect(controller('LOCAL').serve(['..', 'outside.txt'], res)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('없는 파일은 404 다', async () => {
    const { res } = fakeResponse();
    await expect(controller('LOCAL').serve(['product-bulk-form', 'nope.xlsx'], res)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('모르는 확장자는 octet-stream 으로 떨어진다', async () => {
    await fs.writeFile(path.join(baseDir, 'thing.weird'), Buffer.from('x'));
    const { res, headers } = fakeResponse();
    await controller('LOCAL').serve(['thing.weird'], res);

    expect(headers['Content-Type']).toBe('application/octet-stream');
  });
});
