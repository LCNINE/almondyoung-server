import {
  EMPTY_POPUP_FORM,
  parsePaths,
  popupFormFromDto,
  popupFormToCreateDto,
  popupFormToUpdateDto,
  validatePopupForm,
  type SitePopupFormValue,
} from './form';
import type { SitePopupDto } from '@/lib/types/dto/products';

function makeForm(overrides: Partial<SitePopupFormValue> = {}): SitePopupFormValue {
  return {
    ...EMPTY_POPUP_FORM,
    title: '여름 휴무 안내',
    content: '<p>8월 15일 휴무입니다.</p>',
    ...overrides,
  };
}

function makeDto(overrides: Partial<SitePopupDto> = {}): SitePopupDto {
  return {
    id: 'popup-1',
    title: '여름 휴무 안내',
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
    placement: 'main',
    placementPaths: [],
    audience: 'all',
    dismissMode: 'today',
    dismissDays: null,
    dismissVersion: 1,
    displayStartAt: null,
    displayEndAt: null,
    isActive: true,
    sortOrder: 0,
    deletedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as SitePopupDto;
}

describe('validatePopupForm', () => {
  it('제목이 없으면 막는다', () => {
    expect(validatePopupForm(makeForm({ title: '   ' }))).toMatch(/제목/);
  });

  it('본문형인데 본문이 비면 막는다', () => {
    expect(validatePopupForm(makeForm({ content: '<p></p>' }))).toMatch(/본문/);
  });

  it('이미지만 넣은 본문은 통과시킨다', () => {
    expect(validatePopupForm(makeForm({ content: '<p><img src="x.png"></p>' }))).toBeNull();
  });

  it('이미지형인데 PC 이미지가 없으면 막는다', () => {
    expect(validatePopupForm(makeForm({ contentType: 'image', content: '' }))).toMatch(/PC 이미지/);
  });

  it('경로 지정인데 경로가 없으면 막는다', () => {
    expect(validatePopupForm(makeForm({ placement: 'paths', placementPathsText: '  ' }))).toMatch(
      /경로/,
    );
  });

  it('"/" 로 시작하지 않는 경로를 막는다', () => {
    expect(
      validatePopupForm(makeForm({ placement: 'paths', placementPathsText: 'products' })),
    ).toMatch(/"\/"/);
  });

  it('숨김 일수 방식인데 일수가 없으면 막는다', () => {
    expect(validatePopupForm(makeForm({ dismissMode: 'days', dismissDays: '' }))).toMatch(/숨김 일수/);
  });

  it('허용 범위를 벗어난 크기를 막는다', () => {
    expect(validatePopupForm(makeForm({ pcWidth: '50' }))).toMatch(/PC 너비/);
    expect(validatePopupForm(makeForm({ mobileHeight: '9000' }))).toMatch(/모바일 높이/);
  });

  it('크기를 비우는 것은 허용한다 (기본값으로 노출)', () => {
    expect(validatePopupForm(makeForm({ pcWidth: '', pcHeight: '' }))).toBeNull();
  });

  it('게시 종료가 시작보다 앞서면 막는다', () => {
    expect(
      validatePopupForm(
        makeForm({ displayStartAt: '2026-09-01T00:00', displayEndAt: '2026-08-01T00:00' }),
      ),
    ).toMatch(/종료/);
  });

  it('위험한 스킴의 링크를 막는다', () => {
    // eslint-disable-next-line no-script-url
    expect(validatePopupForm(makeForm({ linkUrl: 'javascript:alert(1)' }))).toMatch(/링크/);
    expect(validatePopupForm(makeForm({ linkUrl: '//evil.com' }))).toMatch(/링크/);
  });

  it('사이트 내 경로와 http(s) 링크는 통과시킨다', () => {
    expect(validatePopupForm(makeForm({ linkUrl: '/products' }))).toBeNull();
    expect(validatePopupForm(makeForm({ linkUrl: 'https://example.com' }))).toBeNull();
  });
});

describe('popupFormToCreateDto', () => {
  it('입력한 크기를 숫자로 보낸다', () => {
    const dto = popupFormToCreateDto(
      makeForm({ pcWidth: '700', pcHeight: '500', mobileWidth: '320', mobileHeight: '' }),
    );

    expect(dto).toMatchObject({ pcWidth: 700, pcHeight: 500, mobileWidth: 320 });
    expect(dto.mobileHeight).toBeUndefined();
  });

  it('이미지형이면 본문을 보내지 않는다', () => {
    const dto = popupFormToCreateDto(
      makeForm({ contentType: 'image', pcImageFileId: 'file-1', content: '<p>남은 본문</p>' }),
    );

    expect(dto.content).toBeUndefined();
    expect(dto.pcImageFileId).toBe('file-1');
  });

  it('경로 지정이 아니면 경로 목록을 비워 보낸다', () => {
    const dto = popupFormToCreateDto(makeForm({ placement: 'main', placementPathsText: '/products' }));

    expect(dto.placementPaths).toEqual([]);
  });

  it('숨김 일수는 해당 방식일 때만 보낸다', () => {
    expect(popupFormToCreateDto(makeForm({ dismissMode: 'today', dismissDays: '7' })).dismissDays).
      toBeUndefined();
    expect(
      popupFormToCreateDto(makeForm({ dismissMode: 'days', dismissDays: '7' })).dismissDays,
    ).toBe(7);
  });
});

describe('popupFormToUpdateDto', () => {
  it('이미지형에서 본문형으로 되돌리면 이미지 필드를 null 로 비운다', () => {
    const dto = popupFormToUpdateDto(
      makeForm({
        contentType: 'rich_text',
        pcImageFileId: 'file-1',
        mobileImageFileId: 'file-2',
        imageAlt: '이전 대체 텍스트',
      }),
    );

    expect(dto).toMatchObject({
      contentType: 'rich_text',
      pcImageFileId: null,
      mobileImageFileId: null,
      imageAlt: null,
    });
  });

  it('본문형에서 이미지형으로 바꾸면 본문을 null 로 비운다', () => {
    const dto = popupFormToUpdateDto(
      makeForm({ contentType: 'image', pcImageFileId: 'file-1', content: '<p>남은 본문</p>' }),
    );

    expect(dto.content).toBeNull();
    expect(dto.pcImageFileId).toBe('file-1');
  });

  it('비운 값은 생략이 아니라 null 로 보낸다', () => {
    const dto = popupFormToUpdateDto(
      makeForm({ linkUrl: '', pcWidth: '', pcHeight: '', displayStartAt: '', displayEndAt: '' }),
    );

    expect(dto).toMatchObject({
      linkUrl: null,
      pcWidth: null,
      pcHeight: null,
      displayStartAt: null,
      displayEndAt: null,
    });
  });

  it('숨김 방식을 바꾸면 남아있던 일수를 null 로 비운다', () => {
    const dto = popupFormToUpdateDto(makeForm({ dismissMode: 'today', dismissDays: '7' }));

    expect(dto.dismissDays).toBeNull();
  });
});

describe('popupFormFromDto', () => {
  it('불러온 뒤 그대로 저장하면 값이 유지된다', () => {
    const dto = makeDto({
      pcWidth: 700,
      pcHeight: 500,
      mobileWidth: 320,
      mobileHeight: 380,
      linkUrl: '/products',
      placement: 'paths',
      placementPaths: ['/products', '/store'],
      audience: 'member',
      dismissMode: 'days',
      dismissDays: 5,
      sortOrder: 2,
    });

    const roundTripped = popupFormToUpdateDto(popupFormFromDto(dto));

    expect(roundTripped).toMatchObject({
      title: dto.title,
      contentType: 'rich_text',
      pcWidth: 700,
      pcHeight: 500,
      mobileWidth: 320,
      mobileHeight: 380,
      linkUrl: '/products',
      placement: 'paths',
      placementPaths: ['/products', '/store'],
      audience: 'member',
      dismissMode: 'days',
      dismissDays: 5,
      sortOrder: 2,
    });
  });

  it('비어 있는 크기는 빈 입력으로 되돌린다', () => {
    const form = popupFormFromDto(makeDto({ pcWidth: null, pcHeight: null }));

    expect(form.pcWidth).toBe('');
    expect(form.pcHeight).toBe('');
  });
});

describe('parsePaths', () => {
  it('줄 단위로 자르고 공백·중복을 정리한다', () => {
    expect(parsePaths(' /products \n\n/products\n/store ')).toEqual(['/products', '/store']);
  });
});
