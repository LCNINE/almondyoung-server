import {
  completedByText,
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
