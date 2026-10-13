import {
  cssLength,
  cssBoxSides,
  changeCssSide,
  convertCssUnit,
  changeCssBorder,
  cssRadiusAxes,
  changeCssRadius,
} from './components/time-sale-css';

describe('스타일 숫자·단위 조절', () => {
  it('선택한 테두리에 두께와 색상을 적용하고 선택 해제한 선은 숨긴다', () => {
    expect(
      changeCssBorder(
        { border: '1px solid red', padding: '8px' },
        [true, false, true, false],
        '3px',
        'blue'
      )
    ).toEqual({
      padding: '8px',
      borderTop: '3px solid blue',
      borderRight: 'none',
      borderBottom: '3px solid blue',
      borderLeft: 'none',
    });
  });

  it('타원 모서리의 반대 축과 선택하지 않은 모서리를 유지한다', () => {
    expect(cssRadiusAxes('4px 8px / 2px 6px')).toEqual([
      ['4px', '8px', '4px', '8px'],
      ['2px', '6px', '2px', '6px'],
    ]);
    expect(
      changeCssRadius(
        { borderRadius: '4px 8px / 2px 6px' },
        [true, true, false, false],
        0,
        '12px'
      ).borderRadius
    ).toBe('12px 12px 4px 8px / 2px 6px 2px 6px');
  });
  it('소수, 음수, 상대 단위를 읽고 계산식은 직접 입력으로 보존한다', () => {
    expect(cssLength('33.3pt')).toEqual({ amount: 33.3, unit: 'pt' });
    expect(cssLength('-0.5%')).toEqual({ amount: -0.5, unit: '%' });
    expect(cssLength('calc(100% - 40px)')).toBeNull();
    expect(cssLength('auto')).toBeNull();
  });

  it('px와 pt를 바꿔도 폰트의 실제 크기를 유지한다', () => {
    expect(convertCssUnit(32, 'px', 'pt')).toBe(24);
    expect(convertCssUnit(24, 'pt', 'px')).toBe(32);
  });

  it('CSS 여백 축약형의 네 방향을 유지한다', () => {
    expect(cssBoxSides('32px 16px')).toEqual(['32px', '16px', '32px', '16px']);
    expect(cssBoxSides('1% auto 3%')).toEqual(['1%', 'auto', '3%', 'auto']);
    expect(cssBoxSides('calc(100% - 40px) 8px')).toEqual([
      'calc(100% - 40px)',
      '8px',
      'calc(100% - 40px)',
      '8px',
    ]);
  });

  it('한쪽 여백을 조절할 때 다른 방향과 사용자 스타일을 지우지 않는다', () => {
    expect(
      changeCssSide(
        { padding: '32px 16px', color: 'red' },
        'padding',
        'Top',
        '10%'
      )
    ).toEqual({
      paddingTop: '10%',
      paddingRight: '16px',
      paddingBottom: '32px',
      paddingLeft: '16px',
      color: 'red',
    });
    expect(
      changeCssSide(
        { margin: '0 auto', marginTop: '5px' },
        'margin',
        'Bottom',
        '8px'
      )
    ).toEqual({
      marginTop: '5px',
      marginRight: 'auto',
      marginBottom: '8px',
      marginLeft: 'auto',
    });
  });
});
