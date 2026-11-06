import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { createGlobalValidationPipe } from '../../../../../platform/http/validation-pipe';
import { CreateTopNoticeDto, TopNoticeListQueryDto, UpdateTopNoticeDto } from './index';

const pipe = createGlobalValidationPipe();

function meta(metatype: ArgumentMetadata['metatype'], type: ArgumentMetadata['type'] = 'body'): ArgumentMetadata {
  return { type, metatype, data: '' };
}

async function transform<T>(value: unknown, metatype: ArgumentMetadata['metatype'], type?: ArgumentMetadata['type']) {
  return (await pipe.transform(value, meta(metatype, type))) as T;
}

describe('CreateTopNoticeDto', () => {
  it('어드민 등록 폼이 보내는 모양을 그대로 받는다', async () => {
    const dto = await transform<CreateTopNoticeDto>(
      {
        text: ' 5만원 이상 무료배송 ',
        linkUrl: '/cs/notice/abc',
        displayStartAt: '2026-11-10T00:00:00.000Z',
        isActive: true,
        sortOrder: 1,
      },
      CreateTopNoticeDto,
    );

    expect(dto).toMatchObject({ text: '5만원 이상 무료배송', linkUrl: '/cs/notice/abc', sortOrder: 1 });
  });

  it('선언되지 않은 필드는 떨어뜨린다', async () => {
    const dto = await transform<CreateTopNoticeDto & { createdBy?: string }>(
      { text: '안내', createdBy: '위조된-관리자-id' },
      CreateTopNoticeDto,
    );

    expect(dto.createdBy).toBeUndefined();
  });

  it('빈 문구를 거부한다', async () => {
    await expect(transform({ text: '   ' }, CreateTopNoticeDto)).rejects.toThrow(BadRequestException);
  });

  it('한 줄을 넘는 긴 문구를 거부한다', async () => {
    await expect(transform({ text: '가'.repeat(121) }, CreateTopNoticeDto)).rejects.toThrow(BadRequestException);
  });
});

describe('UpdateTopNoticeDto', () => {
  it('값을 비우는 null 전송을 허용한다', async () => {
    const dto = await transform<UpdateTopNoticeDto>(
      { text: '안내', linkUrl: null, displayStartAt: null, displayEndAt: null, isActive: false, sortOrder: 0 },
      UpdateTopNoticeDto,
    );

    expect(dto).toMatchObject({ linkUrl: null, displayStartAt: null, displayEndAt: null, isActive: false });
  });

  it('문구는 null 로 비울 수 없다', async () => {
    await expect(transform({ text: null }, UpdateTopNoticeDto)).rejects.toThrow(BadRequestException);
  });
});

describe('TopNoticeListQueryDto', () => {
  it('쿼리스트링의 "true"/"false" 를 불리언으로 바꾼다', async () => {
    const dto = await transform<TopNoticeListQueryDto>(
      { includeInactive: 'true', isActive: 'false' },
      TopNoticeListQueryDto,
      'query',
    );

    expect(dto).toMatchObject({ includeInactive: true, isActive: false });
  });
});
