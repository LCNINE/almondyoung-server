import {
  colorDraftReducer,
  draftToValue,
  initColorDraft,
  parseColor,
  parseHexInput,
  rgbaToHex,
} from './components/time-sale-color';

describe('parseColor', () => {
  it('6자리 hex 를 RGBA(A 0–100)로 바꾼다', () => {
    expect(parseColor('#4A90E2')).toEqual({ r: 74, g: 144, b: 226, a: 100 });
  });

  it('3자리·8자리 hex 를 읽는다', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 100 });
    expect(parseColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 50 });
  });

  it('rgba() 와 transparent 를 읽는다', () => {
    expect(parseColor('rgba(10, 20, 30, 0.25)')).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 25,
    });
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('읽을 수 없는 값은 null', () => {
    expect(parseColor('red')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
  });
});

describe('rgbaToHex', () => {
  it('불투명이면 #rrggbb 소문자', () => {
    expect(rgbaToHex({ r: 74, g: 144, b: 226, a: 100 })).toBe('#4a90e2');
  });

  it('반투명이면 #rrggbbaa', () => {
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 50 })).toBe('#00000080');
  });
});

describe('parseHexInput', () => {
  it('# 없이 입력한 hex 를 RGB 로 바꾸고 알파는 유지한다', () => {
    expect(parseHexInput('4A90E2', 40)).toEqual({
      r: 74,
      g: 144,
      b: 226,
      a: 40,
    });
  });

  it('입력 중인 불완전한 값은 null', () => {
    expect(parseHexInput('4A9', 100)).toEqual({
      r: 68,
      g: 170,
      b: 153,
      a: 100,
    });
    expect(parseHexInput('4A90', 100)).toBeNull();
    expect(parseHexInput('zz0000', 100)).toBeNull();
  });
});

describe('colorDraftReducer', () => {
  it('열 때 현재 값으로 임시값을 만든다', () => {
    const draft = initColorDraft('#4a90e2');
    expect(draft.rgba).toEqual({ r: 74, g: 144, b: 226, a: 100 });
    expect(draftToValue(draft)).toBe('#4a90e2');
  });

  it('읽을 수 없는 값으로 열면 검정 불투명', () => {
    expect(initColorDraft('').rgba).toEqual({ r: 0, g: 0, b: 0, a: 100 });
  });

  it('채널·알파를 바꿔도 임시값만 바뀐다', () => {
    let draft = initColorDraft('#000000');
    draft = colorDraftReducer(draft, {
      type: 'channel',
      channel: 'r',
      value: 255,
    });
    draft = colorDraftReducer(draft, {
      type: 'channel',
      channel: 'a',
      value: 50,
    });
    expect(draftToValue(draft)).toBe('#ff000080');
  });

  it('채널 값은 범위 안으로 자른다', () => {
    let draft = initColorDraft('#000000');
    draft = colorDraftReducer(draft, {
      type: 'channel',
      channel: 'g',
      value: 999,
    });
    draft = colorDraftReducer(draft, {
      type: 'channel',
      channel: 'a',
      value: -5,
    });
    expect(draft.rgba).toEqual({ r: 0, g: 255, b: 0, a: 0 });
  });

  it('프리셋은 RGB 만 바꾸고 알파를 유지한다', () => {
    let draft = initColorDraft('#00000080');
    draft = colorDraftReducer(draft, { type: 'preset', hex: '#D0021B' });
    expect(draftToValue(draft)).toBe('#d0021b80');
  });

  it('채도/명도·색상 조작은 HSV 로 계산한다', () => {
    let draft = initColorDraft('#000000');
    draft = colorDraftReducer(draft, { type: 'hue', h: 120 });
    draft = colorDraftReducer(draft, { type: 'sv', s: 1, v: 1 });
    expect(draftToValue(draft)).toBe('#00ff00');
  });

  it('회색으로 내려가도 고른 hue 를 기억한다', () => {
    let draft = initColorDraft('#000000');
    draft = colorDraftReducer(draft, { type: 'hue', h: 240 });
    draft = colorDraftReducer(draft, { type: 'sv', s: 0, v: 0.5 });
    draft = colorDraftReducer(draft, { type: 'sv', s: 1, v: 1 });
    expect(draftToValue(draft)).toBe('#0000ff');
  });

  it('투명색은 transparent 로 내보낸다', () => {
    const draft = colorDraftReducer(initColorDraft('#4a90e2'), {
      type: 'transparent',
    });
    expect(draftToValue(draft)).toBe('transparent');
  });
});
