import { bannerImageGuide, formatRatio, safeZonePercent } from './banner-image-guide';

describe('formatRatio', () => {
  it('정수로 떨어지면 소수점을 붙이지 않는다', () => {
    expect(formatRatio(1920, 640)).toBe('3:1');
    expect(formatRatio(750, 375)).toBe('2:1');
  });

  it('정수가 아니면 소수 한 자리로 줄인다', () => {
    expect(formatRatio(1920, 711)).toBe('2.7:1');
  });
});

describe('safeZonePercent', () => {
  // 3:2(1536x1024) 원본을 슬롯에 넣었을 때 살아남는 세로 비율
  it('슬롯이 가로로 길수록 안전 영역이 좁아진다', () => {
    expect(safeZonePercent(1920, 640)).toBe(50); // 3:1
    expect(safeZonePercent(750, 375)).toBe(75); // 2:1
    expect(safeZonePercent(1920, 480)).toBe(38); // 4:1
  });

  it('슬롯이 3:2 보다 세로로 길면 100% 이상이 된다 (잘리지 않음)', () => {
    expect(safeZonePercent(750, 938)).toBeGreaterThanOrEqual(100);
  });
});

describe('bannerImageGuide', () => {
  it('규격이 없으면 null', () => {
    expect(bannerImageGuide(null, 640)).toBeNull();
    expect(bannerImageGuide(1920, undefined)).toBeNull();
  });

  it('가로로 긴 슬롯은 안전 영역을 안내한다', () => {
    const guide = bannerImageGuide(1920, 640);
    expect(guide?.spec).toBe('권장 1920×640 (3:1)');
    expect(guide?.tip).toContain('세로 중앙 50%');
  });

  it('세로로 긴 슬롯은 잘리지 않는다고 안내한다', () => {
    expect(bannerImageGuide(750, 938)?.tip).toContain('잘리지 않습니다');
  });
});
