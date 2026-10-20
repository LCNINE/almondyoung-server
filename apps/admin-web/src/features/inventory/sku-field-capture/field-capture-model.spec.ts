import {
  barcodeConflictWarning,
  cameraFailure,
  cameraUnavailableReason,
  completedByText,
  errorMessageOf,
  fieldCaptureKeys,
  reworkNotice,
  scanInputValue,
  missingRequirements,
  parseMm,
  photoRejectionReason,
  toCompleteRequest,
  type CaptureDraft,
} from './field-capture-model';

const full: CaptureDraft = {
  widthMm: '120',
  lengthMm: '45',
  heightMm: '30',
  barcodeStatus: 'none',
  scannedBarcode: '',
  photoCount: 3,
  allFacesConfirmed: true,
};

describe('parseMm', () => {
  it('정수만 받는다', () => {
    expect(parseMm('120')).toBe(120);
    expect(parseMm(' 45 ')).toBe(45);
    for (const bad of ['12.5', '12cm', '0', '5001', '']) expect(parseMm(bad)).toBeNull();
  });
});

describe('photoRejectionReason', () => {
  it('허용 형식·크기', () => {
    expect(photoRejectionReason({ type: 'image/jpeg', size: 8e6 })).toBeNull();
    expect(photoRejectionReason({ type: 'image/heic', size: 1 })).toContain('HEIC');
    expect(photoRejectionReason({ type: 'image/jpeg', size: 26214401 })).not.toBeNull();
  });
});

describe('missingRequirements', () => {
  it('다 찼으면 빈 배열', () => expect(missingRequirements(full)).toEqual([]));
  it('사진 부족', () =>
    expect(missingRequirements({ ...full, photoCount: 2 })).toContain('사진을 1장 더 찍어 주세요'));
  it('바코드 미선택', () =>
    expect(missingRequirements({ ...full, barcodeStatus: null })).toContain('바코드 칸에서 하나를 골라 주세요'));
  it('scanned 인데 값 없음', () =>
    expect(missingRequirements({ ...full, barcodeStatus: 'scanned', scannedBarcode: '' })).toContain(
      '바코드 칸에서 하나를 골라 주세요',
    ));
  it('여섯 면 미확인', () =>
    expect(missingRequirements({ ...full, allFacesConfirmed: false })).toContain('여섯 면이 다 나왔는지 확인해 주세요'));
  it('가로 오입력', () =>
    expect(missingRequirements({ ...full, widthMm: 'abc' })).toContain('가로를 mm 정수로 입력해 주세요'));
});

describe('toCompleteRequest', () => {
  it('none 이면 scannedBarcode 키가 없다', () => {
    expect(toCompleteRequest(full)).toEqual({
      packageWidthMm: 120,
      packageLengthMm: 45,
      packageHeightMm: 30,
      barcodeStatus: 'none',
      allFacesConfirmed: true,
    });
  });
  it('scanned 는 trim 된 값을 싣는다', () => {
    expect(toCompleteRequest({ ...full, barcodeStatus: 'scanned', scannedBarcode: ' 880 ' }).scannedBarcode).toBe('880');
  });
  it('미충족이면 던진다', () => {
    expect(() => toCompleteRequest({ ...full, photoCount: 0 })).toThrow();
  });
});

describe('completedByText', () => {
  it('KST 로 표기한다', () => {
    expect(completedByText({ lastWorkerLabel: 'worker01', lastCompletedAt: '2026-10-21T05:05:00.000Z' })).toBe(
      'worker01 님이 10-21 14:05 에 완료함',
    );
  });
});

describe('scanInputValue', () => {
  it('빈칸·공백만이면 제출하지 않는다', () => {
    expect(scanInputValue('')).toBeNull();
    expect(scanInputValue('   ')).toBeNull();
  });
  it('값은 손대지 않고 넘긴다 (정규화는 서버)', () => {
    expect(scanInputValue(' t-01-20 ')).toBe(' t-01-20 ');
  });
});

describe('cameraUnavailableReason', () => {
  it('https 가 아니면 쓸 수 없다', () =>
    expect(cameraUnavailableReason({ isSecureContext: false, hasGetUserMedia: true })).toContain('https'));
  it('getUserMedia 가 없으면 쓸 수 없다', () =>
    expect(cameraUnavailableReason({ isSecureContext: true, hasGetUserMedia: false })).not.toBeNull());
  it('둘 다 되면 null', () =>
    expect(cameraUnavailableReason({ isSecureContext: true, hasGetUserMedia: true })).toBeNull());
});

describe('cameraFailure', () => {
  it('권한 거부는 다시 시도해도 소용없다', () => {
    const f = cameraFailure({ name: 'NotAllowedError' });
    expect(f.retryable).toBe(false);
    expect(f.message).toContain('권한');
  });
  it('카메라 없음도 재시도 불가', () => expect(cameraFailure({ name: 'NotFoundError' }).retryable).toBe(false));
  it('다른 앱이 쓰는 중이면 다시 시도할 수 있다', () =>
    expect(cameraFailure({ name: 'NotReadableError' }).retryable).toBe(true));
  it('모르는 오류도 문구는 있다', () => {
    const f = cameraFailure('boom');
    expect(f.retryable).toBe(true);
    expect(f.message.length).toBeGreaterThan(0);
  });
});

describe('reworkNotice', () => {
  it('미완료면 확인 없이 들어간다', () => expect(reworkNotice({ completion: null })).toBeNull());
  it('완료면 누가·언제를 보여 준다', () =>
    expect(
      reworkNotice({ completion: { lastWorkerLabel: 'worker01', lastCompletedAt: '2026-10-21T05:05:00.000Z' } }),
    ).toBe('worker01 님이 10-21 14:05 에 완료함'));
});

describe('barcodeConflictWarning', () => {
  const owner = { skuId: 'other', code: '13192920007', name: 'OO 염색약 8N' };
  it('주인이 없으면 경고 없음', () => expect(barcodeConflictWarning(null, 'me')).toBeNull());
  it('이 상품 것이면 경고 없음', () =>
    expect(barcodeConflictWarning({ ...owner, skuId: 'me' }, 'me')).toBeNull());
  it('남의 것이면 이름(코드)와 함께 경고', () =>
    expect(barcodeConflictWarning(owner, 'me')).toBe(
      '이 바코드는 OO 염색약 8N(13192920007) 상품에 이미 붙어 있어요. 이 상품엔 붙이지 않고 기록만 남겨요',
    ));
});

describe('errorMessageOf', () => {
  it('서버 message 를 쓴다', () =>
    expect(errorMessageOf({ response: { data: { message: '사진이 3장 미만입니다' } } }, '실패')).toBe(
      '사진이 3장 미만입니다',
    ));
  it('검증 오류 배열은 이어 붙인다', () =>
    expect(errorMessageOf({ response: { data: { message: ['a', 'b'] } } }, '실패')).toBe('a, b'));
  it('Error 면 그 message', () => expect(errorMessageOf(new Error('네트워크'), '실패')).toBe('네트워크'));
  it('모르면 기본 문구', () => expect(errorMessageOf(undefined, '실패')).toBe('실패'));
});

describe('fieldCaptureKeys', () => {
  it('브리프가 정한 모양', () => {
    expect(fieldCaptureKeys.position('T-01-20')).toEqual(['sku-field-capture', 'position', 'T-01-20']);
    expect(fieldCaptureKeys.detail('sku-1')).toEqual(['sku-field-capture', 'detail', 'sku-1']);
  });
  it('위치 전체 무효화 키는 위치 키의 접두사이고 undefined 가 없다', () => {
    expect(fieldCaptureKeys.position('X').slice(0, 2)).toEqual([...fieldCaptureKeys.positions]);
    expect(fieldCaptureKeys.positions).not.toContain(undefined);
  });
});
