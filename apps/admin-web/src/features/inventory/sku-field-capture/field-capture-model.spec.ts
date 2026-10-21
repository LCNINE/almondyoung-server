import { CustomError } from '@/lib/api/customError';
import type { FieldCaptureDetailDto } from '@/lib/types/dto/inventory';
import {
  barcodeConflictWarning,
  cameraFailure,
  cameraUnavailableReason,
  completedByText,
  draftFromDetail,
  DRAFT_TTL_MS,
  restoreDraft,
  kstDateOf,
  periodRange,
  shiftDate,
  myItemLine,
  savedDraftJson,
  errorMessageOf,
  fieldCaptureKeys,
  MANUFACTURER_BARCODE_FORMATS,
  SCANNER_VIDEO_CONSTRAINTS,
  scanDebugLine,
  pickBackCamera,
  scannerConstraintsFor,
  isScanDebug,
  photoDecodeSize,
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

describe('MANUFACTURER_BARCODE_FORMATS', () => {
  it('소매 1D 형식만 — QR·2D 는 읽지 않는다', () => {
    expect([...MANUFACTURER_BARCODE_FORMATS].sort()).toEqual([
      'CODE_128',
      'EAN_13',
      'EAN_8',
      'ITF',
      'UPC_A',
      'UPC_E',
    ]);
    for (const twoD of [
      'QR_CODE',
      'DATA_MATRIX',
      'PDF_417',
      'AZTEC',
    ] as const) {
      expect(MANUFACTURER_BARCODE_FORMATS).not.toContain(twoD);
    }
  });
});

describe('parseMm', () => {
  it('정수만 받는다', () => {
    expect(parseMm('120')).toBe(120);
    expect(parseMm(' 45 ')).toBe(45);
    for (const bad of ['12.5', '12cm', '0', '5001', ''])
      expect(parseMm(bad)).toBeNull();
  });
});

describe('photoRejectionReason', () => {
  it('허용 형식·크기', () => {
    expect(photoRejectionReason({ type: 'image/jpeg', size: 8e6 })).toBeNull();
    expect(photoRejectionReason({ type: 'image/heic', size: 1 })).toContain(
      'HEIC'
    );
    expect(
      photoRejectionReason({ type: 'image/jpeg', size: 26214401 })
    ).not.toBeNull();
  });
});

describe('missingRequirements', () => {
  it('다 찼으면 빈 배열', () => expect(missingRequirements(full)).toEqual([]));
  it('사진 부족', () =>
    expect(missingRequirements({ ...full, photoCount: 2 })).toContain(
      '사진을 1장 더 찍어 주세요'
    ));
  it('바코드 미선택', () =>
    expect(missingRequirements({ ...full, barcodeStatus: null })).toContain(
      '바코드 칸에서 하나를 골라 주세요'
    ));
  it('scanned 인데 값 없음', () =>
    expect(
      missingRequirements({
        ...full,
        barcodeStatus: 'scanned',
        scannedBarcode: '',
      })
    ).toContain('바코드 칸에서 하나를 골라 주세요'));
  it('찍은 바코드가 64자를 넘으면(QR·URL 등) 제조사 바코드를 다시 찍게 한다', () => {
    const tooLong = 'https://example.com/' + 'a'.repeat(45); // 65자
    expect(
      missingRequirements({
        ...full,
        barcodeStatus: 'scanned',
        scannedBarcode: tooLong,
      })
    ).toContain(
      '바코드가 너무 길어요. 포장의 제조사 바코드(막대 모양)를 찍어 주세요'
    );
    expect(
      missingRequirements({
        ...full,
        barcodeStatus: 'scanned',
        scannedBarcode: ` ${'8'.repeat(64)} `,
      })
    ).toEqual([]);
  });
  it('여섯 면 미확인', () =>
    expect(
      missingRequirements({ ...full, allFacesConfirmed: false })
    ).toContain('여섯 면이 다 나왔는지 확인해 주세요'));
  it('가로 오입력', () =>
    expect(missingRequirements({ ...full, widthMm: 'abc' })).toContain(
      '가로를 mm 정수로 입력해 주세요'
    ));
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
    expect(
      toCompleteRequest({
        ...full,
        barcodeStatus: 'scanned',
        scannedBarcode: ' 880 ',
      }).scannedBarcode
    ).toBe('880');
  });
  it('미충족이면 던진다', () => {
    expect(() => toCompleteRequest({ ...full, photoCount: 0 })).toThrow();
  });
});

describe('completedByText', () => {
  it('KST 로 표기한다', () => {
    expect(
      completedByText({
        lastWorkerLabel: 'worker01',
        lastCompletedAt: '2026-10-21T05:05:00.000Z',
      })
    ).toBe('worker01 님이 10-21 14:05 에 완료함');
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
    expect(
      cameraUnavailableReason({ isSecureContext: false, hasGetUserMedia: true })
    ).toContain('https'));
  it('getUserMedia 가 없으면 쓸 수 없다', () =>
    expect(
      cameraUnavailableReason({ isSecureContext: true, hasGetUserMedia: false })
    ).not.toBeNull());
  it('둘 다 되면 null', () =>
    expect(
      cameraUnavailableReason({ isSecureContext: true, hasGetUserMedia: true })
    ).toBeNull());
});

describe('cameraFailure', () => {
  it('권한 거부는 다시 시도해도 소용없다', () => {
    const f = cameraFailure({ name: 'NotAllowedError' });
    expect(f.retryable).toBe(false);
    expect(f.message).toContain('권한');
  });
  it('카메라 없음도 재시도 불가', () =>
    expect(cameraFailure({ name: 'NotFoundError' }).retryable).toBe(false));
  it('다른 앱이 쓰는 중이면 다시 시도할 수 있다', () =>
    expect(cameraFailure({ name: 'NotReadableError' }).retryable).toBe(true));
  it('모르는 오류도 문구는 있다', () => {
    const f = cameraFailure('boom');
    expect(f.retryable).toBe(true);
    expect(f.message.length).toBeGreaterThan(0);
  });
});

describe('reworkNotice', () => {
  it('미완료면 확인 없이 들어간다', () =>
    expect(reworkNotice({ completion: null })).toBeNull());
  it('완료면 누가·언제를 보여 준다', () =>
    expect(
      reworkNotice({
        completion: {
          lastWorkerLabel: 'worker01',
          lastCompletedAt: '2026-10-21T05:05:00.000Z',
        },
      })
    ).toBe('worker01 님이 10-21 14:05 에 완료함'));
});

describe('barcodeConflictWarning', () => {
  const owner = { skuId: 'other', code: '13192920007', name: 'OO 염색약 8N' };
  it('주인이 없으면 경고 없음', () =>
    expect(barcodeConflictWarning(null, 'me')).toBeNull());
  it('이 상품 것이면 경고 없음', () =>
    expect(barcodeConflictWarning({ ...owner, skuId: 'me' }, 'me')).toBeNull());
  it('남의 것이면 이름(코드)와 함께 경고', () =>
    expect(barcodeConflictWarning(owner, 'me')).toBe(
      '이 바코드는 OO 염색약 8N(13192920007) 상품에 이미 붙어 있어요. 이 상품엔 붙이지 않고 기록만 남겨요'
    ));
});

describe('errorMessageOf', () => {
  const ctx = '사진을 상품에 연결하지 못했어요. 다시 찍어 주세요';
  it('네트워크 실패(응답 없음)엔 상황 문장만', () =>
    expect(
      errorMessageOf(
        new CustomError({ message: 'Network Error', statusCode: 500 }),
        ctx
      )
    ).toBe(ctx));
  it('서버가 준 message 는 상황 문장 뒤에 붙인다', () =>
    expect(
      errorMessageOf(
        new CustomError({
          message: '사진이 3장 미만입니다',
          statusCode: 400,
          response: { message: '사진이 3장 미만입니다' },
        }),
        ctx
      )
    ).toBe(`${ctx} (사진이 3장 미만입니다)`));
  it('5xx 라도 서버 본문이 있으면 붙인다', () =>
    expect(
      errorMessageOf(
        new CustomError({
          message: 'Internal server error',
          statusCode: 500,
          response: {},
        }),
        ctx
      )
    ).toBe(`${ctx} (Internal server error)`));
  it('인증 만료(본문 없는 401)는 붙인다', () =>
    expect(
      errorMessageOf(
        new CustomError({ message: '인증이 만료되었습니다.', statusCode: 401 }),
        ctx
      )
    ).toBe(`${ctx} (인증이 만료되었습니다.)`));
  it('서버가 거부한 업로드(UploadRejectedError)는 그 사유를 붙인다', () => {
    const rejected = Object.assign(
      new Error('파일 업로드가 거부되었습니다. (File size too large)'),
      {
        name: 'UploadRejectedError',
      }
    );
    expect(errorMessageOf(rejected, ctx)).toBe(
      `${ctx} (파일 업로드가 거부되었습니다. (File size too large))`
    );
  });
  it('fetch 업로드 오류·모르는 값엔 상황 문장만', () => {
    expect(errorMessageOf(new TypeError('Failed to fetch'), ctx)).toBe(ctx);
    expect(errorMessageOf(undefined, ctx)).toBe(ctx);
  });
});

describe('fieldCaptureKeys', () => {
  it('브리프가 정한 모양', () => {
    expect(fieldCaptureKeys.position('T-01-20')).toEqual([
      'sku-field-capture',
      'position',
      'T-01-20',
    ]);
    expect(fieldCaptureKeys.detail('sku-1')).toEqual([
      'sku-field-capture',
      'detail',
      'sku-1',
    ]);
  });
  it('위치 전체 무효화 키는 위치 키의 접두사이고 undefined 가 없다', () => {
    expect(fieldCaptureKeys.position('X').slice(0, 2)).toEqual([
      ...fieldCaptureKeys.positions,
    ]);
    expect(fieldCaptureKeys.positions).not.toContain(undefined);
  });
  it('myToday 키는 정해진 모양이고 undefined 가 없다', () => {
    expect(fieldCaptureKeys.myToday).toEqual([
      'sku-field-capture',
      'me',
      'today',
    ]);
    expect(fieldCaptureKeys.myToday).not.toContain(undefined);
  });
  it('progress 키는 정해진 모양이고 undefined 가 없다', () => {
    expect(fieldCaptureKeys.progress).toEqual([
      'sku-field-capture',
      'progress',
    ]);
    expect(fieldCaptureKeys.progress).not.toContain(undefined);
  });
  it('바코드 주인 무효화 키는 주인 키의 접두사', () =>
    expect(fieldCaptureKeys.barcodeOwner('880').slice(0, 2)).toEqual([
      ...fieldCaptureKeys.barcodeOwners,
    ]));
});

describe('draftFromDetail', () => {
  const base: FieldCaptureDetailDto = {
    skuId: 'sku-1',
    code: 'C1',
    name: 'N',
    imageUrl: null,
    positionCode: 'T-01-20',
    packageWidthMm: null,
    packageLengthMm: null,
    packageHeightMm: null,
    barcodes: [],
    photos: [],
    completion: null,
  };
  const photo = (id: string) => ({
    id,
    fileId: `f-${id}`,
    sortOrder: 0,
    takenByLabel: 'w',
    createdAt: '2026-10-21T00:00:00.000Z',
  });
  const completion = {
    barcodeStatus: 'scanned' as const,
    lastWorkerLabel: 'worker01',
    lastCompletedAt: '2026-10-21T05:05:00.000Z',
    scannedBarcode: '8801234567890',
    barcodeConflict: null,
    allFacesConfirmed: true,
  };

  it('완료·치수 없는 SKU 는 빈 초안', () =>
    expect(draftFromDetail(base)).toEqual({
      widthMm: '',
      lengthMm: '',
      heightMm: '',
      barcodeStatus: null,
      scannedBarcode: '',
      photoCount: 0,
      allFacesConfirmed: false,
    }));

  it('재작업(수정)은 치수·바코드·여섯 면 확인을 채운다', () =>
    expect(
      draftFromDetail({
        ...base,
        packageWidthMm: 120,
        packageLengthMm: 45,
        packageHeightMm: 30,
        photos: [photo('a'), photo('b'), photo('c')],
        completion,
      })
    ).toEqual({
      widthMm: '120',
      lengthMm: '45',
      heightMm: '30',
      barcodeStatus: 'scanned',
      scannedBarcode: '8801234567890',
      photoCount: 3,
      allFacesConfirmed: true,
    }));

  it('스캔이 아닌 완료는 바코드 값을 비운다', () => {
    const d = draftFromDetail({
      ...base,
      completion: {
        ...completion,
        barcodeStatus: 'none',
        scannedBarcode: null,
      },
    });
    expect(d.barcodeStatus).toBe('none');
    expect(d.scannedBarcode).toBe('');
  });

  it('재작업(수정) 초안은 그대로 저장할 수 있다', () =>
    expect(
      missingRequirements(
        draftFromDetail({
          ...base,
          packageWidthMm: 120,
          packageLengthMm: 45,
          packageHeightMm: 30,
          photos: [photo('a'), photo('b'), photo('c')],
          completion,
        })
      )
    ).toEqual([]));
});

describe('scanner settings', () => {
  it('asks the camera for a high resolution (default 640×480 blurs 1D bars)', () => {
    const video = SCANNER_VIDEO_CONSTRAINTS.video;
    expect(video).toMatchObject({
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
  });

  it('shrinks a photo to at most 2000px on the long side and never enlarges', () => {
    expect(photoDecodeSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(photoDecodeSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(photoDecodeSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });
});

describe('scanDebugLine', () => {
  it('summarises what the live scanner actually got', () => {
    expect(
      scanDebugLine({
        videoWidth: 1080,
        videoHeight: 1920,
        trackLabel: 'camera2 2, facing back',
        focusMode: 'continuous',
        attempts: 37,
        lastError: 'NotFoundException',
        lastDecodeMs: 412,
      })
    ).toBe(
      '1080×1920 · camera2 2, facing back · focus=continuous · 시도 37 · NotFoundException · 412ms'
    );
  });

  it('marks unknown fields instead of hiding them', () => {
    expect(
      scanDebugLine({
        videoWidth: 0,
        videoHeight: 0,
        trackLabel: '',
        focusMode: undefined,
        attempts: 0,
        lastError: null,
        lastDecodeMs: null,
      })
    ).toBe('0×0 · (label 없음) · focus=? · 시도 0 · - · -');
  });

  it('is on only with ?scanDebug=1', () => {
    expect(isScanDebug('?scanDebug=1')).toBe(true);
    expect(isScanDebug('?position=T-01-20&scanDebug=1')).toBe(true);
    expect(isScanDebug('?scanDebug=0')).toBe(false);
    expect(isScanDebug('')).toBe(false);
  });
});

describe('pickBackCamera', () => {
  const cam = (deviceId: string, label: string) => ({
    deviceId,
    label,
    kind: 'videoinput' as const,
  });

  it('picks the lowest-numbered back lens (Samsung lists ultra-wide/tele as higher numbers)', () => {
    expect(
      pickBackCamera([
        cam('a', 'camera2 1, facing front'),
        cam('b', 'camera2 2, facing back'),
        cam('c', 'camera2 0, facing back'),
        cam('d', 'camera2 3, facing back'),
      ])
    ).toBe('c');
  });

  it('understands generic and Korean labels', () => {
    expect(
      pickBackCamera([cam('x', 'Front Camera'), cam('y', 'Back Camera')])
    ).toBe('y');
    expect(
      pickBackCamera([cam('k', '후면 카메라 2'), cam('m', '후면 카메라')])
    ).toBe('m');
  });

  it('gives up when labels are hidden (no permission yet) or there is no back lens', () => {
    expect(pickBackCamera([cam('a', ''), cam('b', '')])).toBeNull();
    expect(pickBackCamera([cam('w', 'HD Webcam')])).toBeNull();
  });
});

describe('scannerConstraintsFor', () => {
  it('opens the chosen lens exactly, keeping the resolution request', () => {
    expect(scannerConstraintsFor('c')).toEqual({
      video: {
        deviceId: { exact: 'c' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  });
  it('falls back to facingMode without a chosen lens', () => {
    expect(scannerConstraintsFor(null)).toBe(SCANNER_VIDEO_CONSTRAINTS);
  });
});

describe('restoreDraft', () => {
  const draft = {
    widthMm: '120',
    lengthMm: '80',
    heightMm: '',
    barcodeStatus: 'scanned' as const,
    scannedBarcode: '8801234567890',
    photoCount: 2,
    allFacesConfirmed: true,
  };
  it('되돌아오면 적어 둔 입력을 그대로 돌려준다', () => {
    expect(restoreDraft(savedDraftJson(draft, 1000), 2000)).toEqual(draft);
  });
  it('오래됐거나 깨졌거나 없으면 버린다', () => {
    expect(restoreDraft(savedDraftJson(draft, 0), DRAFT_TTL_MS + 1)).toBeNull();
    expect(restoreDraft('{oops', 0)).toBeNull();
    expect(restoreDraft(null, 0)).toBeNull();
  });
});

describe('kstDateOf', () => {
  it('UTC 전날 밤도 KST 날짜로 묶는다', () => {
    expect(kstDateOf('2026-10-20T16:30:00.000Z')).toBe('2026-10-21');
  });
});

describe('myItemLine', () => {
  it('KST 시각·치수·바코드 상태를 한 줄로', () => {
    expect(
      myItemLine({
        completedAt: '2026-10-21T05:05:00.000Z',
        packageWidthMm: 120,
        packageLengthMm: 80,
        packageHeightMm: 50,
        barcodeStatus: 'scanned',
      })
    ).toBe('14:05 · 120×80×50mm · 바코드 스캔');
  });
  it('치수가 비면 치수를 뺀다', () => {
    expect(
      myItemLine({
        completedAt: '2026-10-21T05:05:00.000Z',
        packageWidthMm: null,
        packageLengthMm: 80,
        packageHeightMm: 50,
        barcodeStatus: 'none',
      })
    ).toBe('14:05 · 바코드 없음');
  });
});

describe('shiftDate', () => {
  it('달·해를 넘긴다', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('periodRange', () => {
  const today = '2026-10-21';
  it('오늘·어제·7일(오늘 포함)·전체·날짜', () => {
    expect(periodRange('today', today, null)).toEqual({ from: today, to: today });
    expect(periodRange('yesterday', today, null)).toEqual({ from: '2026-10-20', to: '2026-10-20' });
    expect(periodRange('week', today, null)).toEqual({ from: '2026-10-15', to: today });
    expect(periodRange('all', today, null)).toEqual({});
    expect(periodRange('date', today, '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(periodRange('date', today, null)).toEqual({});
  });
});
