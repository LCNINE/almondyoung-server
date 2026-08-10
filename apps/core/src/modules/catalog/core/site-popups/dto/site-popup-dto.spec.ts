import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { createGlobalValidationPipe } from '../../../../../platform/http/validation-pipe';
import { CreateSitePopupDto, SitePopupListQueryDto, UpdateSitePopupDto } from './index';

const pipe = createGlobalValidationPipe();

function meta(metatype: ArgumentMetadata['metatype'], type: ArgumentMetadata['type'] = 'body'): ArgumentMetadata {
  return { type, metatype, data: '' };
}

async function transform<T>(value: unknown, metatype: ArgumentMetadata['metatype'], type?: ArgumentMetadata['type']) {
  return (await pipe.transform(value, meta(metatype, type))) as T;
}

describe('CreateSitePopupDto', () => {
  it('어드민 등록 폼이 보내는 모양을 그대로 받는다', async () => {
    const dto = await transform<CreateSitePopupDto>(
      {
        title: '여름 휴무 안내',
        contentType: 'rich_text',
        content: '<p>본문</p>',
        linkUrl: '/products',
        pcWidth: 460,
        mobileWidth: 340,
        placement: 'main',
        placementPaths: [],
        audience: 'all',
        dismissMode: 'today',
        displayStartAt: '2026-08-10T00:00:00.000Z',
        isActive: true,
        sortOrder: 0,
      },
      CreateSitePopupDto,
    );

    expect(dto).toMatchObject({ title: '여름 휴무 안내', pcWidth: 460, sortOrder: 0 });
  });

  it('선언되지 않은 필드는 떨어뜨린다', async () => {
    const dto = await transform<CreateSitePopupDto & { createdBy?: string }>(
      { title: '안내', content: '<p>본문</p>', createdBy: '위조된-관리자-id' },
      CreateSitePopupDto,
    );

    expect(dto.createdBy).toBeUndefined();
  });

  it('허용 범위를 벗어난 크기를 거부한다', async () => {
    await expect(
      transform({ title: '안내', content: '<p>본문</p>', pcWidth: 5000 }, CreateSitePopupDto),
    ).rejects.toThrow(BadRequestException);
  });

  it('정의되지 않은 노출 대상을 거부한다', async () => {
    await expect(
      transform({ title: '안내', content: '<p>본문</p>', audience: 'vip' }, CreateSitePopupDto),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('UpdateSitePopupDto', () => {
  /** 어드민 수정 화면은 비우는 필드를 생략하지 않고 null 로 보낸다. */
  it('값을 비우는 null 전송을 허용한다', async () => {
    const dto = await transform<UpdateSitePopupDto>(
      {
        title: '안내',
        contentType: 'rich_text',
        content: '<p>본문</p>',
        pcImageFileId: null,
        mobileImageFileId: null,
        imageAlt: null,
        linkUrl: null,
        noticeId: null,
        pcWidth: null,
        pcHeight: null,
        mobileWidth: null,
        mobileHeight: null,
        placementPaths: [],
        dismissDays: null,
        displayStartAt: null,
        displayEndAt: null,
        isActive: true,
        sortOrder: 0,
      },
      UpdateSitePopupDto,
    );

    expect(dto).toMatchObject({
      pcImageFileId: null,
      linkUrl: null,
      pcWidth: null,
      dismissDays: null,
      displayStartAt: null,
    });
  });

  it('null 이 아닌 잘못된 값은 여전히 거부한다', async () => {
    await expect(transform({ pcWidth: 5000 }, UpdateSitePopupDto)).rejects.toThrow(BadRequestException);
    await expect(transform({ dismissDays: 0 }, UpdateSitePopupDto)).rejects.toThrow(BadRequestException);
  });
});

describe('SitePopupListQueryDto', () => {
  it('쿼리스트링의 "true"/"false" 를 불리언으로 바꾼다', async () => {
    const dto = await transform<SitePopupListQueryDto>(
      { includeInactive: 'true', isActive: 'false' },
      SitePopupListQueryDto,
      'query',
    );

    expect(dto).toMatchObject({ includeInactive: true, isActive: false });
  });

  it('빈 값은 필터를 걸지 않은 것으로 본다', async () => {
    const dto = await transform<SitePopupListQueryDto>(
      { isActive: '', q: '   ' },
      SitePopupListQueryDto,
      'query',
    );

    expect(dto.isActive).toBeUndefined();
    expect(dto.q).toBe('');
  });
});
