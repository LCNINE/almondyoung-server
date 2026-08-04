import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { readWorkbookUpload } from './bulk-upload.multipart';
import { MAX_UPLOAD_BYTES } from './bulk-upload.parser';

type FilePart = {
  type: 'file';
  fieldname: string;
  filename: string;
  buffer: Buffer;
  truncated?: boolean;
};
type FieldPart = { type: 'field'; fieldname: string; value: unknown };

/**
 * `@fastify/multipart` 의 `request.parts()` 대역.
 *
 * `toBuffer()` 호출 여부를 기록한다 — "모든 part 를 소비해야 스트림이 안 막힌다"는 규약이
 * 이 스펙의 검사 대상 중 하나라서, 대역이 그걸 관측할 수 있어야 한다.
 */
function fakeRequest(parts: Array<FilePart | FieldPart>, isMultipart = true) {
  const consumed: string[] = [];
  const request = {
    isMultipart: () => isMultipart,
    parts: async function* () {
      for (const part of parts) {
        if (part.type === 'file') {
          yield {
            type: 'file' as const,
            fieldname: part.fieldname,
            filename: part.filename,
            file: { truncated: part.truncated ?? false },
            toBuffer: async () => {
              consumed.push(part.fieldname);
              return part.buffer;
            },
          };
        } else {
          yield { type: 'field' as const, fieldname: part.fieldname, value: part.value };
        }
      }
    },
  } as unknown as FastifyRequest;
  return { request, consumed };
}

function filePart(over: Partial<FilePart> = {}): FilePart {
  return {
    type: 'file',
    fieldname: 'file',
    filename: '양식.xlsx',
    buffer: Buffer.from('workbook'),
    ...over,
  };
}

describe('readWorkbookUpload', () => {
  it('파일 바이트와 파일명, name 필드를 읽는다', async () => {
    const { request } = fakeRequest([
      filePart(),
      { type: 'field', fieldname: 'name', value: '8월 개편' },
    ]);

    await expect(readWorkbookUpload(request)).resolves.toEqual({
      buffer: Buffer.from('workbook'),
      fileName: '양식.xlsx',
      name: '8월 개편',
    });
  });

  it('필드 순서가 반대여도 (name 이 파일보다 먼저) 똑같이 읽는다', async () => {
    const { request } = fakeRequest([
      { type: 'field', fieldname: 'name', value: '8월 개편' },
      filePart(),
    ]);

    await expect(readWorkbookUpload(request)).resolves.toMatchObject({ name: '8월 개편' });
  });

  it('name 이 없으면 undefined 다 (서비스가 파일명으로 채운다)', async () => {
    const { request } = fakeRequest([filePart()]);

    await expect(readWorkbookUpload(request)).resolves.toMatchObject({ name: undefined });
  });

  it('공백뿐인 name 은 undefined 로 접는다', async () => {
    const { request } = fakeRequest([filePart(), { type: 'field', fieldname: 'name', value: '   ' }]);

    await expect(readWorkbookUpload(request)).resolves.toMatchObject({ name: undefined });
  });

  it('200자를 넘는 name 은 400 이다 (CreateBulkSessionDto 와 같은 상한)', async () => {
    const { request } = fakeRequest([
      filePart(),
      { type: 'field', fieldname: 'name', value: 'x'.repeat(201) },
    ]);

    await expect(readWorkbookUpload(request)).rejects.toThrow(BadRequestException);
  });

  it('multipart 가 아니면 400 이다', async () => {
    const { request } = fakeRequest([], false);

    await expect(readWorkbookUpload(request)).rejects.toThrow(BadRequestException);
  });

  it('file 필드가 없으면 400 이다', async () => {
    const { request } = fakeRequest([{ type: 'field', fieldname: 'name', value: 'x' }]);

    await expect(readWorkbookUpload(request)).rejects.toThrow(BadRequestException);
  });

  it('플러그인 상한에 잘린 파일은 400 이다 — 잘린 채로 검증 레인에 넘기지 않는다', async () => {
    const { request } = fakeRequest([filePart({ truncated: true })]);

    await expect(readWorkbookUpload(request)).rejects.toThrow(/10MB/);
  });

  it('상한을 넘는 버퍼는 잘리지 않았어도 400 이다', async () => {
    const { request } = fakeRequest([filePart({ buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1) })]);

    await expect(readWorkbookUpload(request)).rejects.toThrow(/10MB/);
  });

  it('관심 없는 파일 part 도 끝까지 소비한다 — 남기면 busboy 스트림이 매달린다', async () => {
    const { request, consumed } = fakeRequest([
      filePart({ fieldname: 'thumbnail', filename: 'x.png' }),
      filePart(),
      filePart({ fieldname: 'file', filename: '두번째.xlsx', buffer: Buffer.from('second') }),
    ]);

    const result = await readWorkbookUpload(request);

    // 첫 번째 `file` 만 취한다.
    expect(result.fileName).toBe('양식.xlsx');
    // 그래도 세 part 모두 읽혔다.
    expect(consumed).toEqual(['thumbnail', 'file', 'file']);
  });
});
