import { carrierEnum } from '../../../inventory/schema/inventory.schema';
import type { CarrierCode } from './carrier-gateway.interface';

// 빠짐없음은 type-check 가 본다 — carrier enum 에 값이 늘면 여기서 컴파일이 깨진다
export const CARRIER_NAME_BY_CODE: Record<CarrierCode, string> = {
  CJ: 'CJ대한통운',
  HANJIN: '한진택배',
  LOTTE: '롯데택배',
  LOGEN: '로젠택배',
  KDEXP: '경동택배',
  CJGLS: 'CJ GLS',
  EPOST: '우체국택배',
  DAESIN: '대신택배',
  ILYANG: '일양로지스',
  HDEXP: '합동택배',
  CVSNET: 'GS편의점택배',
  CUPOST: 'CU편의점택배',
  CHUNIL: '천일택배',
  KUNYOUNG: '건영택배',
};

// Invoice carrierCode 필드는 varchar라 실제 값이 다양할 수 있음 — canonical 코드로 정규화
export const CARRIER_CODE_ALIASES: Readonly<Record<string, CarrierCode>> = {
  CJ대한통운: 'CJ',
  'CJ 대한통운': 'CJ',
  cj: 'CJ',
  한진택배: 'HANJIN',
  한진: 'HANJIN',
  hanjin: 'HANJIN',
  롯데택배: 'LOTTE',
  롯데: 'LOTTE',
  롯데글로벌로지스: 'LOTTE',
  lotte: 'LOTTE',
  로젠택배: 'LOGEN',
  로젠: 'LOGEN',
  logen: 'LOGEN',
  경동택배: 'KDEXP',
  경동: 'KDEXP',
  kdexp: 'KDEXP',
  'CJ-GLS': 'CJGLS',
  'CJ GLS': 'CJGLS',
  cjgls: 'CJGLS',
  우체국택배: 'EPOST',
  우체국: 'EPOST',
  epost: 'EPOST',
  대신택배: 'DAESIN',
  대신: 'DAESIN',
  daesin: 'DAESIN',
  일양로지스: 'ILYANG',
  일양: 'ILYANG',
  ilyang: 'ILYANG',
  합동택배: 'HDEXP',
  합동: 'HDEXP',
  hdexp: 'HDEXP',
  GS편의점택배: 'CVSNET',
  'GS 편의점택배': 'CVSNET',
  cvsnet: 'CVSNET',
  CU편의점택배: 'CUPOST',
  'CU 편의점택배': 'CUPOST',
  cupost: 'CUPOST',
  천일택배: 'CHUNIL',
  천일: 'CHUNIL',
  chunil: 'CHUNIL',
  건영택배: 'KUNYOUNG',
  건영: 'KUNYOUNG',
  kunyoung: 'KUNYOUNG',
};

const compact = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

const LOOKUP: ReadonlyMap<string, CarrierCode> = (() => {
  const map = new Map<string, CarrierCode>();
  for (const [alias, code] of Object.entries(CARRIER_CODE_ALIASES)) map.set(compact(alias), code);
  for (const code of carrierEnum.enumValues) {
    map.set(compact(CARRIER_NAME_BY_CODE[code]), code);
    map.set(compact(code), code);
  }
  return map;
})();

/** 코드(대소문자 무시)·한글 이름·별칭을 받는다. 앞뒤·내부 공백은 무시하고, 모르면 null. */
export function parseCarrierName(raw: string): CarrierCode | null {
  const key = compact(raw);
  return key === '' ? null : (LOOKUP.get(key) ?? null);
}
