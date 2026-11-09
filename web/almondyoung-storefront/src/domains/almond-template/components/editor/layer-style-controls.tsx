import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { SHAPE_TEXT_TYPES, type Layer } from "../../lib/document"
import {
  BLEND_MODES,
  COLORED_FILTERS,
  COLOR_FILTERS,
  DEFAULT_DOT_SIZE,
  DEFAULT_FILTER_COLOR,
  DEFAULT_GRADIENT,
  type BlendMode,
  type ColorFilter,
  type ColorFilterKind,
  type Gradient,
} from "../../lib/layer-style"
import { PrintColorPicker } from "../color-picker"
import { PropSection, PropSlider, SettingBox, Toggle } from "./prop-sections"

const selectClass =
  "mt-2 w-full rounded-md border border-[#dce0e5] bg-white p-2 text-sm"

export function LayerStyleControls({
  editor,
  selected,
  gradient = false,
}: {
  editor: AlmondEditor
  selected: Layer
  gradient?: boolean
}) {
  const disabled = !editor.editable
  const patch = (value: Partial<Layer>) => editor.patch(selected.id, value)
  const filter = selected.colorFilter

  return (
    <PropSection className="space-y-[15px] py-5">
      <label className="block text-[15px] text-[#3F4250]">
        혼합 모드
        <select
          aria-label="혼합 모드"
          className={selectClass}
          value={selected.blendMode ?? "normal"}
          disabled={disabled}
          onChange={(event) => {
            const blendMode = event.target.value as BlendMode

            patch({ blendMode: blendMode === "normal" ? undefined : blendMode })
          }}
        >
          {BLEND_MODES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <ColorFilterFields
        value={filter}
        disabled={disabled}
        onChange={(colorFilter) => patch({ colorFilter })}
      />
      <PropSlider
        label="블러"
        min={0}
        max={100}
        value={selected.blur ?? 0}
        disabled={disabled}
        onValue={(blur) => patch({ blur: blur || undefined })}
      />
      {(filter || (selected.blur ?? 0) > 0) &&
        SHAPE_TEXT_TYPES.has(selected.type) &&
        !selected.filterBypass && (
          <p className="text-[13px] leading-[19px] text-[#70777F]">
            도형 색 대신 이 모양 안의 배경 사진과 아래 레이어에 필터가 걸립니다.
          </p>
        )}
      {gradient && (
        <GradientControls
          value={selected.gradient}
          startColor={selected.fill === "none" ? undefined : selected.fill}
          disabled={disabled}
          onChange={(gradient) => patch({ gradient })}
        />
      )}
      {selected.type === "text" && (
        <>
          <Toggle
            label="글자로 뚫기"
            checked={!!selected.knockout}
            disabled={disabled}
            onChange={(knockout) => patch({ knockout: knockout || undefined })}
          />
          {selected.knockout && (
            <p className="text-[13px] leading-[19px] text-[#70777F]">
              글자 모양대로 아래 도형·사진을 모두 뚫어 배경이 보입니다.
            </p>
          )}
        </>
      )}
      {selected.type !== "image" && (
        <>
          <Toggle
            label="필터 무효화"
            checked={!!selected.filterBypass}
            disabled={disabled}
            onChange={(on) => patch({ filterBypass: on || undefined })}
          />
          {selected.filterBypass && (
            <p className="text-[13px] leading-[19px] text-[#70777F]">
              이 모양 안에서는 배경 사진과 아래 레이어가 필터 없이 원래 색으로
              보입니다.
            </p>
          )}
        </>
      )}
      <PropSlider
        label="가장자리 흐림"
        min={0}
        max={100}
        value={selected.edgeBlur ?? 0}
        disabled={disabled}
        onValue={(edgeBlur) => patch({ edgeBlur: edgeBlur || undefined })}
      />
    </PropSection>
  )
}

export function GradientControls({
  value,
  startColor,
  disabled,
  onChange,
}: {
  value: Gradient | undefined
  startColor?: string
  disabled: boolean
  onChange: (value: Gradient | undefined) => void
}) {
  const set = (change: Partial<Gradient>) =>
    value && onChange({ ...value, ...change })

  return (
    <>
      <Toggle
        label="그라데이션"
        checked={!!value}
        disabled={disabled}
        onChange={(on) =>
          onChange(
            on
              ? {
                  ...DEFAULT_GRADIENT,
                  from: startColor ?? DEFAULT_GRADIENT.from,
                }
              : undefined
          )
        }
      />
      {value && (
        <SettingBox
          title="그라데이션 설정"
          disabled={disabled}
          onClear={() => onChange(undefined)}
        >
          <label className="block text-[15px] text-[#3F4250]">
            방식
            <select
              aria-label="그라데이션 방식"
              className={selectClass}
              value={value.type}
              disabled={disabled}
              onChange={(event) =>
                set({ type: event.target.value as Gradient["type"] })
              }
            >
              <option value="linear">직선</option>
              <option value="radial">원형</option>
            </select>
          </label>
          <PrintColorPicker
            label="시작 색상"
            value={value.from}
            disabled={disabled}
            onApply={(from) => set({ from })}
          />
          <PropSlider
            label="시작 불투명도"
            min={0}
            max={100}
            value={Math.round(value.fromOpacity * 100)}
            disabled={disabled}
            onValue={(percent) => set({ fromOpacity: percent / 100 })}
          />
          <PrintColorPicker
            label="끝 색상"
            value={value.to}
            disabled={disabled}
            onApply={(to) => set({ to })}
          />
          <PropSlider
            label="끝 불투명도"
            min={0}
            max={100}
            value={Math.round(value.toOpacity * 100)}
            disabled={disabled}
            onValue={(percent) => set({ toOpacity: percent / 100 })}
          />
          {value.type === "linear" && (
            <PropSlider
              label="각도"
              min={-180}
              max={180}
              step={15}
              value={value.angle}
              disabled={disabled}
              onValue={(angle) => set({ angle })}
            />
          )}
        </SettingBox>
      )}
    </>
  )
}

export function ColorFilterFields({
  value,
  disabled,
  onChange,
}: {
  value: ColorFilter | undefined
  disabled: boolean
  onChange: (value: ColorFilter | undefined) => void
}) {
  return (
    <>
      <label className="block text-[15px] text-[#3F4250]">
        필터
        <select
          aria-label="필터"
          className={selectClass}
          value={value?.kind ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const kind = event.target.value as ColorFilterKind | ""

            onChange(
              kind
                ? {
                    kind,
                    amount: value?.amount ?? 70,
                    color: COLORED_FILTERS.has(kind)
                      ? DEFAULT_FILTER_COLOR[kind]
                      : undefined,
                  }
                : undefined
            )
          }}
        >
          <option value="">없음</option>
          {COLOR_FILTERS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <SettingBox
          title="필터 설정"
          disabled={disabled}
          onClear={() => onChange(undefined)}
        >
          <PropSlider
            label="강도"
            min={0}
            max={100}
            value={value.amount}
            disabled={disabled}
            onValue={(amount) => onChange({ ...value, amount })}
          />
          {value.kind === "tone" && (
            <PropSlider
              label="망점 크기"
              min={1}
              max={100}
              value={value.dotSize ?? DEFAULT_DOT_SIZE}
              disabled={disabled}
              onValue={(dotSize) => onChange({ ...value, dotSize })}
            />
          )}
          {COLORED_FILTERS.has(value.kind) && (
            <PrintColorPicker
              label="필터 색상"
              value={value.color ?? DEFAULT_FILTER_COLOR[value.kind]}
              disabled={disabled}
              onApply={(color) => onChange({ ...value, color })}
            />
          )}
        </SettingBox>
      )}
    </>
  )
}
