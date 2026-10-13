'use client';

import { useId, useState } from 'react';
import {
  validateSaleCss,
  type SaleCss,
} from '@packages/domain-types/time-sale';
import { TimeSaleColorPicker } from './time-sale-color-picker';
import {
  cssLength,
  cssSides,
  cssBoxSides,
  changeCssSide,
  convertCssUnit,
  changeCssBorder,
  cssRadiusAxes,
  changeCssRadius,
} from './time-sale-css';
import { toast } from 'sonner';
import { TimeSaleImageField } from './time-sale-image-field';

function LengthControl({
  label,
  value,
  onChange,
  fallbackUnit = 'px',
  max = 200,
  min = 0,
  inline = false,
  displayLabel,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  fallbackUnit?: string;
  max?: number;
  min?: number;
  inline?: boolean;
  displayLabel?: string;
}) {
  const parsed = cssLength(value);
  const amount = parsed?.amount ?? 0;
  const unit = parsed?.unit ?? fallbackUnit;
  const limit = Math.max(amount, unit === '%' ? 100 : max);

  return (
    <div className={`ts-size-control${inline ? ' ts-size-inline' : ''}`}>
      <label className="ts-size-label">{displayLabel ?? label}</label>
      <div className="ts-size-inputs">
        <input
          aria-label={label}
          type="text"
          inputMode="decimal"
          value={parsed ? amount : (value ?? '')}
          placeholder="기본값"
          onChange={(event) => {
            const raw = event.target.value;
            onChange(
              raw === ''
                ? ''
                : /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)
                  ? `${raw}${unit}`
                  : raw
            );
          }}
        />
        <select
          aria-label={`${label} 단위`}
          value={unit}
          onChange={(event) =>
            onChange(
              `${convertCssUnit(amount, unit, event.target.value)}${event.target.value}`
            )
          }
        >
          {['px', 'pt', '%', 'em', 'rem', 'vw', 'vh'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <input
          type="range"
          aria-label={`${label} 슬라이더`}
          min={Math.min(min, amount)}
          max={limit}
          step="0.1"
          value={amount}
          disabled={value !== undefined && value !== '' && !parsed}
          onChange={(event) => onChange(`${event.target.value}${unit}`)}
        />
      </div>
    </div>
  );
}

const sideLabels = ['위', '오른쪽', '아래', '왼쪽'];

function DirectionSelection({
  kind,
  selected,
  onChange,
}: {
  kind: 'border' | 'radius';
  selected: boolean[];
  onChange: (selected: boolean[]) => void;
}) {
  const title = kind === 'border' ? '테두리' : '모서리';
  const labels =
    kind === 'border'
      ? sideLabels
      : ['왼쪽 위', '오른쪽 위', '오른쪽 아래', '왼쪽 아래'];
  const presets =
    kind === 'border'
      ? [
          [true, true, true, true],
          [true, false, true, false],
          [false, true, false, true],
          [false, false, false, false],
        ]
      : [
          [true, true, true, true],
          [true, true, false, false],
          [false, false, true, true],
          [false, false, false, false],
        ];
  const names = [
    '전체 선택',
    kind === 'border' ? '위/아래 선택' : '위 선택',
    kind === 'border' ? '왼쪽/오른쪽 선택' : '아래 선택',
    '전체 취소',
  ];

  return (
    <div className="ts-direction-selection">
      <div className="ts-direction-presets">
        {presets.map((preset, index) => (
          <button
            key={names[index]}
            type="button"
            title={names[index]}
            aria-label={`${title} ${names[index]}`}
            onClick={() => onChange(preset)}
          >
            <span
              className={`ts-direction-icon ts-direction-${kind}`}
              style={
                kind === 'border'
                  ? {
                      borderTopStyle: preset[0] ? 'solid' : 'dashed',
                      borderRightStyle: preset[1] ? 'solid' : 'dashed',
                      borderBottomStyle: preset[2] ? 'solid' : 'dashed',
                      borderLeftStyle: preset[3] ? 'solid' : 'dashed',
                      borderTopColor: preset[0] ? '#212121' : '#ddd',
                      borderRightColor: preset[1] ? '#212121' : '#ddd',
                      borderBottomColor: preset[2] ? '#212121' : '#ddd',
                      borderLeftColor: preset[3] ? '#212121' : '#ddd',
                    }
                  : {
                      borderTopLeftRadius: preset[0] ? '12px' : '0',
                      borderTopRightRadius: preset[1] ? '12px' : '0',
                      borderBottomRightRadius: preset[2] ? '12px' : '0',
                      borderBottomLeftRadius: preset[3] ? '12px' : '0',
                    }
              }
            />
          </button>
        ))}
      </div>
      <div className={`ts-direction-diagram ts-direction-diagram-${kind}`}>
        <span />
        {labels.map((label, index) => (
          <input
            key={label}
            type="checkbox"
            aria-label={`${label} ${title} 선택`}
            checked={selected[index]}
            onChange={(event) =>
              onChange(
                selected.map((current, i) =>
                  i === index ? event.target.checked : current
                )
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

export function CssEditor({
  value,
  onChange,
  accordionName,
  containerOnly = false,
  showFont = true,
  jsonOnly = false,
}: {
  value: SaleCss;
  accordionName?: string;
  containerOnly?: boolean;
  showFont?: boolean;
  jsonOnly?: boolean;
  onChange: (css: SaleCss) => void;
}) {
  const [borderSelection, setBorderSelection] = useState(() =>
    cssSides.map((side) => value[`border${side}`] !== 'none')
  );
  const [cornerSelection, setCornerSelection] = useState([
    true,
    true,
    true,
    true,
  ]);
  const border = String(
    value.border ??
      cssSides
        .map((side) => value[`border${side}`])
        .find((side) => side && side !== 'none') ??
      '0px solid #000000'
  );
  const borderWidth = String(
    value.borderWidth ??
      border.match(/(?:^|\s)([\d.]+(?:px|pt|em|rem)?)(?:\s|$)/)?.[1] ??
      '0px'
  );
  const borderColor = String(
    (value.borderColor ??
      border
        .replace(/^[\d.]+(?:px|pt|em|rem)?\s*/, '')
        .replace(/^(solid|dashed|dotted|double|none)\s*/, '')) ||
      '#000000'
  );
  const radiusAxes = cssRadiusAxes(value.borderRadius);
  const [json, setJson] = useState<string | null>(null);
  const defaultAccordion = useId();
  const accordion = accordionName ?? defaultAccordion;

  const set = (key: string, next: string | number) => {
    const css = { ...value };
    if (next === '') delete css[key];
    else css[key] = next;

    if ((key === 'alignItems' || key === 'justifyContent') && next !== '') {
      css.display = 'flex';
      css.flexDirection ??= 'column';
    }

    onChange(css);
  };

  const length = (
    key: string,
    label: string,
    max = 200,
    fallbackUnit = 'px'
  ) => (
    <LengthControl
      label={label}
      value={value[key]}
      max={max}
      fallbackUnit={fallbackUnit}
      onChange={(next) => set(key, next)}
    />
  );

  const color = (key: string, label: string) => (
    <label className="ts-field">
      <span>{label}</span>
      <TimeSaleColorPicker
        value={String(
          value[key] ?? (key === 'color' ? '#000000' : 'transparent')
        )}
        onChange={(next) => set(key, next)}
      />
    </label>
  );

  const select = (key: string, label: string, choices: [string, string][]) => (
    <label className="ts-field">
      <span>{label}</span>
      <select
        value={String(value[key] ?? '')}
        onChange={(event) => set(key, event.target.value)}
      >
        <option value="">기본값</option>
        {choices.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );

  const styleEditor = (
    <fieldset>
      <legend>Style</legend>
      <textarea
        aria-label="사용자 정의 CSS / JSON"
        value={json ?? JSON.stringify(value, null, 2)}
        placeholder={JSON.stringify(value, null, 2)}
        onChange={(e) => setJson(e.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          try {
            const input = json ?? JSON.stringify(value);
            const parsed: unknown = input.trim().startsWith('{')
              ? JSON.parse(input)
              : (() => {
                  const style = document.createElement('div').style;
                  style.cssText = input;

                  if (input.trim() && !style.length) throw new Error('CSS');

                  // 브라우저가 확장한 paddingTop 대신 입력한 shorthand를 보존한다.
                  return Object.fromEntries(
                    Array.from(
                      input.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g),
                      (match) => match[1]
                    )
                      .map((key) => [
                        key.replace(/-([a-z])/g, (_, letter: string) =>
                          letter.toUpperCase()
                        ),
                        style.getPropertyValue(key),
                      ])
                      .filter(([, value]) => value !== '')
                  );
                })();
            validateSaleCss(parsed);
            onChange(parsed);
            setJson(null);
            toast.success('적용을 완료하였습니다.');
          } catch (error) {
            toast.error(
              `허용된 CSS 선언 또는 올바른 JSON 객체를 입력하세요. ${error instanceof Error ? error.message : ''}`
            );
          }
        }}
      >
        적용
      </button>
    </fieldset>
  );

  if (jsonOnly) return styleEditor;

  return (
    <div
      className={`ts-css-editor${containerOnly ? ' ts-css-container-only' : ''}`}
    >
      {!containerOnly && showFont && (
        <details name={accordion}>
          <summary>폰트</summary>
          <div className="ts-css-body">
            {length('fontSize', '글자 크기', 100, 'pt')}
            <label className="ts-bold-toggle">
              <input
                type="checkbox"
                checked={
                  value.fontWeight === 'bold' || Number(value.fontWeight) >= 600
                }
                onChange={(event) =>
                  set('fontWeight', event.target.checked ? 'bold' : 'normal')
                }
              />
              진하게
            </label>
            {color('color', '글자 색상')}
            <details>
              <summary>추가 폰트 설정</summary>
              {select('fontStyle', '글자 기울임', [
                ['normal', '보통'],
                ['italic', '기울임'],
              ])}
              {select('textDecoration', '글자 꾸미기', [
                ['none', '없음'],
                ['underline', '밑줄'],
                ['line-through', '취소선'],
              ])}
              <label className="ts-field">
                <span>줄 높이</span>
                <input
                  aria-label="줄 높이"
                  value={value.lineHeight ?? ''}
                  onChange={(event) => set('lineHeight', event.target.value)}
                />
              </label>
              {length('letterSpacing', '글자 간격', 30)}
            </details>
          </div>
        </details>
      )}
      <details name={accordion} open={containerOnly || undefined}>
        <summary>컨테이너</summary>
        <div className="ts-css-body">
          {(['margin', 'padding'] as const).map((kind) => (
            <fieldset key={kind}>
              <legend>
                {kind === 'margin' ? '바깥 여백(margin)' : '안쪽 여백(padding)'}
              </legend>
              {cssSides.map((side, index) => (
                <LengthControl
                  key={side}
                  label={`${kind === 'margin' ? '바깥' : '안쪽'} 여백 ${sideLabels[index]}`}
                  value={
                    value[`${kind}${side}`] ??
                    (value[kind] === undefined
                      ? '0%'
                      : cssBoxSides(value[kind])[index])
                  }
                  fallbackUnit="%"
                  inline
                  displayLabel={`${sideLabels[index]}:`}
                  onChange={(next) =>
                    onChange(changeCssSide(value, kind, side, next || '0'))
                  }
                />
              ))}
              {kind === 'padding' && (
                <label className="ts-field">
                  <span>padding</span>
                  <input
                    aria-label="안쪽 여백 직접 입력"
                    value={value[kind] ?? ''}
                    placeholder="위 오른쪽 아래 왼쪽"
                    onChange={(event) => {
                      const next = { ...value };
                      cssSides.forEach((side) => delete next[`${kind}${side}`]);
                      if (event.target.value) next[kind] = event.target.value;
                      else delete next[kind];
                      onChange(next);
                    }}
                  />
                  <small>└ 직접 입력할 수 있습니다.</small>
                </label>
              )}
            </fieldset>
          ))}
          <fieldset>
            <legend>테두리</legend>
            <DirectionSelection
              kind="border"
              selected={borderSelection}
              onChange={(selected) => {
                setBorderSelection(selected);
                onChange(
                  changeCssBorder(value, selected, borderWidth, borderColor)
                );
              }}
            />
            <LengthControl
              label="두께"
              value={borderWidth}
              max={20}
              inline
              onChange={(next) =>
                onChange(
                  changeCssBorder(
                    value,
                    borderSelection,
                    next || '0px',
                    borderColor
                  )
                )
              }
            />
            <label className="ts-field">
              <span>색상</span>
              <TimeSaleColorPicker
                value={borderColor}
                onChange={(next) =>
                  onChange(
                    changeCssBorder(value, borderSelection, borderWidth, next)
                  )
                }
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>둥근 모서리</legend>
            <DirectionSelection
              kind="radius"
              selected={cornerSelection}
              onChange={setCornerSelection}
            />
            {['수평', '수직'].map((label, axis) => (
              <LengthControl
                key={label}
                label={`모서리 ${label}`}
                value={
                  radiusAxes[axis][cornerSelection.findIndex(Boolean)] ?? '0px'
                }
                max={200}
                inline
                onChange={(next) =>
                  onChange(
                    changeCssRadius(value, cornerSelection, axis, next || '0px')
                  )
                }
              />
            ))}
          </fieldset>
          <fieldset>
            <legend>배경색</legend>
            {color('backgroundColor', '배경 색상')}
          </fieldset>
          <fieldset>
            <legend>배경 이미지</legend>
            <TimeSaleImageField
              background
              value={String(value.backgroundImage ?? '')}
              onChange={(next) => set('backgroundImage', next)}
            />
            {select('backgroundSize', '배경 이미지 크기', [
              ['cover', '꽉 채우기'],
              ['contain', '전체 보기'],
              ['auto', '원본 크기'],
            ])}
            {select('backgroundRepeat', '배경 이미지 반복', [
              ['no-repeat', '반복 안 함'],
              ['repeat', '반복'],
              ['repeat-x', '가로 반복'],
              ['repeat-y', '세로 반복'],
            ])}
            <label className="ts-field">
              <span>배경 이미지 위치</span>
              <input
                aria-label="배경 이미지 위치"
                value={value.backgroundPosition ?? ''}
                onChange={(event) =>
                  set('backgroundPosition', event.target.value)
                }
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>내용 정렬</legend>
            {select('textAlign', '수평 정렬', [
              ['left', '왼쪽'],
              ['center', '가운데'],
              ['right', '오른쪽'],
            ])}
            {select('display', '컨테이너 배치', [
              ['block', '기본'],
              ['flex', '플렉스'],
              ['grid', '그리드'],
            ])}
            {select('alignItems', '수직 정렬', [
              ['start', '위'],
              ['center', '가운데'],
              ['end', '아래'],
              ['stretch', '채우기'],
            ])}
            {select('justifyContent', '요소 수평 정렬', [
              ['start', '왼쪽'],
              ['center', '가운데'],
              ['end', '오른쪽'],
              ['space-between', '간격 맞춤'],
            ])}
            {select('flexDirection', '배치 방향', [
              ['row', '가로'],
              ['column', '세로'],
            ])}
            {length('gap', '요소 간격', 100)}
          </fieldset>
          <details>
            <summary>규격</summary>
            <legend>규격</legend>
            {length('width', '폭', 2000, '%')}
            {length('maxWidth', '최대 폭', 2000)}
            {length('height', '높이', 1200)}
            {length('minHeight', '최소 높이', 1200)}
          </details>
          {styleEditor}
        </div>
      </details>
    </div>
  );
}
