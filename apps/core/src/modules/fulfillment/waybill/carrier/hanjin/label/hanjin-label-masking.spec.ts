import { maskAddress, maskName, maskPhone } from './hanjin-label-masking';

// 예시는 전부 한진 포털 「운송장 마스킹 기준」 상세 기준 표(정본 §3.3)에서 그대로 옮겼다.
describe('maskName', () => {
  it.each([
    ['한진', '한*'],
    ['ab', 'a*'],
  ])('두 글자는 2번째 자리를 가린다: %s → %s', (input, expected) => {
    expect(maskName(input)).toBe(expected);
  });

  it.each([
    ['김한진', '김*진'],
    ['abc', 'a*c'],
  ])('세 글자는 2번째 자리를 가린다: %s → %s', (input, expected) => {
    expect(maskName(input)).toBe(expected);
  });

  it.each([
    ['박새로이', '박*로*'],
    ['abcd', 'a*c*'],
  ])('네 글자는 2·4번째 자리를 가린다: %s → %s', (input, expected) => {
    expect(maskName(input)).toBe(expected);
  });

  // 포털 예시는 `김한진택배 → 김*한***` 인데 이건 한진 쪽 오기다 — 5글자 입력이 6글자로 나오고 3번째
  // 자리에 원문 2번째 글자가 와 있어, 글자 수를 지키는 어떤 마스킹으로도 나올 수 없다. 규칙 문장
  // 「2번째, 4번째 자리 이후」를 따른다(「이후」가 그 자리를 포함한다는 건 같은 칸의 Barac Obama 예시가 보인다).
  it('다섯 글자 이상 국문은 2번째와 4번째 이후를 가린다', () => {
    expect(maskName('김한진택배')).toBe('김*진**');
  });

  it('다섯 글자 이상 국문 외는 5번째 이후를 가리고 공백은 세지도 가리지도 않는다', () => {
    expect(maskName('Barac Obama')).toBe('Bara* *****');
  });

  it('자리는 공백을 빼고 센다', () => {
    expect(maskName('김 한진')).toBe('김 *진');
  });

  it('한 글자는 가릴 자리가 없어 그대로 둔다', () => {
    expect(maskName('김')).toBe('김');
  });

  it('앞뒤 공백은 잘라낸다', () => {
    expect(maskName('  김한진 ')).toBe('김*진');
  });
});

// 안심번호는 쓰지 않는다 — 규칙이 허용하는 두 방법 중 「마지막 4자리」 쪽이다.
describe('maskPhone', () => {
  it.each([
    ['02-728-1234', '02-728-****'],
    ['010-1234-5678', '010-1234-****'],
  ])('마지막 4자리를 가린다: %s → %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it('구분자 없는 번호도 숫자 기준으로 마지막 4자리를 가린다', () => {
    expect(maskPhone('01012345678')).toBe('0101234****');
  });

  it('마지막 4자리 안에 끼인 구분자는 그대로 두고 숫자만 센다', () => {
    expect(maskPhone('010-123-45-67')).toBe('010-123-**-**');
  });

  it('숫자가 4자리 이하면 숫자 전부를 가린다', () => {
    expect(maskPhone('1234')).toBe('****');
  });

  it('앞뒤 공백은 잘라낸다', () => {
    expect(maskPhone(' 010-1234-5678 ')).toBe('010-1234-****');
  });
});

// 상세주소는 인자로 받지도 않는다 — 기본주소만 받아 「읍면동 / 건물번호 이후」를 가린다.
describe('maskAddress', () => {
  it.each([
    ['서울시 중구 남대문로63', '서울시 중구 남대문로63 ****'],
    ['서울특별시 중구 소공로 88', '서울특별시 중구 소공로 88 ****'],
  ])('도로명주소는 건물번호까지 남기고 뒤를 가린다: %s → %s', (input, expected) => {
    expect(maskAddress(input)).toBe(expected);
  });

  it('건물번호 뒤에 붙은 참고항목(동명·건물명)도 가린다', () => {
    expect(maskAddress('서울특별시 중구 남대문로 63 (소공동, 한진빌딩)')).toBe('서울특별시 중구 남대문로 63 ****');
  });

  it('기본주소에 상세주소가 섞여 들어와도 건물번호 뒤는 가린다', () => {
    expect(maskAddress('서울특별시 중구 소공로 88 테스트로 3층')).toBe('서울특별시 중구 소공로 88 ****');
  });

  it('부번이 있는 건물번호는 부번까지 남긴다', () => {
    expect(maskAddress('서울특별시 강남구 테헤란로 10-3')).toBe('서울특별시 강남구 테헤란로 10-3 ****');
  });

  it('「번길」의 번호를 건물번호로 오인하지 않는다', () => {
    expect(maskAddress('경기도 부천시 오정구 신흥로511번길 80')).toBe('경기도 부천시 오정구 신흥로511번길 80 ****');
  });

  it('지번주소는 읍면동까지 남기고 뒤를 가린다', () => {
    expect(maskAddress('서울시 중구 소공동 51-0')).toBe('서울시 중구 소공동 ****');
  });

  it('건물번호도 읍면동도 못 찾으면 앞 두 마디만 남긴다', () => {
    expect(maskAddress('서울특별시 중구 어딘가 모를 곳')).toBe('서울특별시 중구 ****');
  });
});
