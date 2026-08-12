import {
  BANNER_GROUP_PRESETS,
  MOBILE_VIEWPORT,
  PC_VIEWPORT,
  matchPreset,
  renderedHeight,
} from './banner-group-presets';

describe('renderedHeight', () => {
  // 규격 숫자는 비율일 뿐이라, 실제 화면 높이는 뷰포트 폭을 그 비율로 나눈 값이다
  it('3:1 규격은 1440px 화면에서 480px', () => {
    expect(renderedHeight(1920, 640, PC_VIEWPORT)).toBe(480);
  });

  it('4:1 규격은 1440px 화면에서 360px', () => {
    expect(renderedHeight(1920, 480, PC_VIEWPORT)).toBe(360);
  });

  it('2:1 모바일 규격은 390px 화면에서 195px', () => {
    expect(renderedHeight(750, 375, MOBILE_VIEWPORT)).toBe(195);
  });

  it('규격이 비면 null', () => {
    expect(renderedHeight(null, 640, PC_VIEWPORT)).toBeNull();
    expect(renderedHeight(1920, undefined, PC_VIEWPORT)).toBeNull();
  });
});

describe('matchPreset', () => {
  it('네 값이 모두 같아야 일치로 본다', () => {
    const hero = BANNER_GROUP_PRESETS[0];
    expect(matchPreset(hero)?.label).toBe(hero.label);
  });

  it('하나라도 다르면 일치하지 않는다', () => {
    const hero = BANNER_GROUP_PRESETS[0];
    expect(matchPreset({ ...hero, pcHeight: 999 })).toBeNull();
  });

  it('빈 값이면 일치하지 않는다', () => {
    expect(matchPreset({})).toBeNull();
  });
});
