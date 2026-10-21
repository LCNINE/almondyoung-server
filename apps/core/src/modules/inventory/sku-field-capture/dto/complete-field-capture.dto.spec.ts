import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteFieldCaptureDto } from './complete-field-capture.dto';

const base = {
  packageWidthMm: 120,
  packageLengthMm: 45,
  packageHeightMm: 30,
  packageWeightG: 250,
  barcodeStatus: 'none',
  allFacesConfirmed: true,
};

async function errorsOf(patch: Record<string, unknown> = {}) {
  return validate(plainToInstance(CompleteFieldCaptureDto, { ...base, ...patch }));
}

describe('CompleteFieldCaptureDto', () => {
  it('정상 입력은 오류 0', async () => {
    expect(await errorsOf()).toHaveLength(0);
  });
  it('소수 mm 는 거부', async () => {
    expect((await errorsOf({ packageWidthMm: 12.5 })).length).toBeGreaterThan(0);
  });
  it('0 과 5001 은 거부', async () => {
    expect((await errorsOf({ packageHeightMm: 0 })).length).toBeGreaterThan(0);
    expect((await errorsOf({ packageLengthMm: 5001 })).length).toBeGreaterThan(0);
  });
  it('무게는 필수 — 없거나 소수·0·100001g 이면 거부', async () => {
    expect((await errorsOf({ packageWeightG: undefined })).length).toBeGreaterThan(0);
    expect((await errorsOf({ packageWeightG: 12.5 })).length).toBeGreaterThan(0);
    expect((await errorsOf({ packageWeightG: 0 })).length).toBeGreaterThan(0);
    expect((await errorsOf({ packageWeightG: 100001 })).length).toBeGreaterThan(0);
    expect(await errorsOf({ packageWeightG: 100000 })).toHaveLength(0);
  });
  it('scanned 인데 바코드가 없으면 거부', async () => {
    expect((await errorsOf({ barcodeStatus: 'scanned' })).length).toBeGreaterThan(0);
    expect((await errorsOf({ barcodeStatus: 'scanned', scannedBarcode: '' })).length).toBeGreaterThan(0);
    expect((await errorsOf({ barcodeStatus: 'scanned', scannedBarcode: 'x'.repeat(65) })).length).toBeGreaterThan(0);
    expect(await errorsOf({ barcodeStatus: 'scanned', scannedBarcode: '880123' })).toHaveLength(0);
  });
  it('scanned 가 아니면 바코드 없어도 통과', async () => {
    expect(await errorsOf({ barcodeStatus: 'no_manufacturer' })).toHaveLength(0);
  });
  it('allFacesConfirmed false 는 거부', async () => {
    expect((await errorsOf({ allFacesConfirmed: false })).length).toBeGreaterThan(0);
  });
  it('모르는 barcodeStatus 는 거부', async () => {
    expect((await errorsOf({ barcodeStatus: 'unknown' })).length).toBeGreaterThan(0);
  });
});
