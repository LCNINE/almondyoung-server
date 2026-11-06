import { type WowpressLineSpec } from './wowpress.types';

// 와우프레스 일반명함(40073) 50x90, 스노우지(무코팅) 250g, 합판옵셋. 색상 255 단면 칼라4도, 256 양면 칼라8도
const SINGLE = 255;
const DOUBLE = 256;

function card(productId: string, colorno: number): WowpressLineSpec {
  return {
    prodno: 40073,
    jobpresetno: '3110',
    prsjob: [{ covercd: 0, sizeno: 10732, paperno: 22904, colorno, jobno: 3110 }],
    awkjob: [],
    qtyPerUnit: 500,
    file: { format: 'pdf', dpi: 300 },
    design: { productId, widthMm: 90, heightMm: 50 },
    confirmed: false,
  };
}

const SEMI_PERMANENT = '6c2b7437-7c72-4685-a72c-0cd18f9d7bfb';
const LASH_EXTENSION = '803ec5ae-df99-4065-9af1-5fb096e105e7';
const LASH_PERM = 'f49c6f16-1522-42b9-a600-e0acf83fdf89';
const SKIN_PLANING = 'e81350cf-d972-4db7-9e54-ba8db80bdcb6';
const WAXING = '7811a1a6-9ab8-470d-9ac1-5c089fed6b68';
const PEDI_PLANING = '09a0e12a-18d1-452a-a9bc-9d133d1c34c6';

export const WOWPRESS_PRODUCTS: Readonly<Record<string, WowpressLineSpec>> = {
  // 반영구 시술 후 주의사항 500매
  '78b60afa-708a-4ba4-9987-93df5669f16c': card(SEMI_PERMANENT, SINGLE),
  '38416501-bfc3-41c2-9fce-6538a78ff62c': card(SEMI_PERMANENT, SINGLE),
  'f5273675-f386-43cb-8c1e-24188931b0c6': card(SEMI_PERMANENT, DOUBLE),

  // 속눈썹 연장 시술 후 주의사항 500매
  '252ae7e0-a1b5-4a66-8882-0faa4931aee2': card(LASH_EXTENSION, SINGLE),
  'e4e88bd8-1d85-4482-b449-8778b742f91d': card(LASH_EXTENSION, SINGLE),
  '841e7e69-dfc9-4b80-b841-dce32c891501': card(LASH_EXTENSION, DOUBLE),

  // 속눈썹펌 시술 후 주의사항 500매. 명함 템플릿도 이 상품에 붙어 있다
  'c44419e9-477c-4cb5-97a1-b82fa1f52d4c': card(LASH_PERM, SINGLE),
  '48207e40-e1d9-47b6-93b4-44bdc77c9061': card(LASH_PERM, SINGLE),
  '3187ab07-6e01-4b0c-87ed-bc0a48018172': card(LASH_PERM, DOUBLE),

  // 스킨플래닝 시술 후 주의사항 500매
  '0c1dd413-2087-457c-a51f-da8f15bf958f': card(SKIN_PLANING, SINGLE),
  '9dcc3450-fe60-4bf9-a17b-8f14c50919c1': card(SKIN_PLANING, SINGLE),
  '87b0a152-0b8f-4688-9dfc-7534ab13559a': card(SKIN_PLANING, DOUBLE),

  // 왁싱 시술 후 주의사항 500매
  'bada76c9-1439-49f8-808d-5cc7974d476a': card(WAXING, SINGLE),
  'ceb5a37c-19ff-4d9c-b4f2-b4c717b5798a': card(WAXING, SINGLE),
  '08a7f579-6f12-4342-9779-e0c97a0e3259': card(WAXING, SINGLE),
  '61f108b6-d0f6-462a-b01d-dffb9989645f': card(WAXING, SINGLE),
  '7cc67d82-4019-40bd-8f31-5994b22d56d6': card(WAXING, DOUBLE),
  '8f1018f2-9285-4d74-8e15-e70e74eb706f': card(WAXING, DOUBLE),
  'fe033003-408f-4748-93f1-7ab29472b2f7': card(WAXING, DOUBLE),

  // 패디플래닝 시술 후 주의사항 500매
  'ec4fba1a-fc43-4b2d-8cdf-492fe5ee4387': card(PEDI_PLANING, SINGLE),
  '02e13c88-6bc7-439f-a3cc-d73fc45b2855': card(PEDI_PLANING, SINGLE),
  '7f51f8ae-4031-44c5-bf18-6fee4ca96430': card(PEDI_PLANING, DOUBLE),
};
