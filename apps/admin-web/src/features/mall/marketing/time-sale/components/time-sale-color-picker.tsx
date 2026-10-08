'use client';

import { useReducer, useRef, useState, type PointerEvent } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  COLOR_PRESETS,
  colorDraftReducer,
  draftToValue,
  hsvToRgb,
  initColorDraft,
  parseColor,
  parseHexInput,
  rgbaToHex,
  type Rgba,
} from './time-sale-color';

const swatchStyle = (rgba: Rgba | null) =>
  rgba && rgba.a > 0
    ? {
        backgroundColor: `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a / 100})`,
      }
    : undefined;

function Swatch({
  rgba,
  className = '',
}: {
  rgba: Rgba | null;
  className?: string;
}) {
  return (
    <span
      className={`ts-color-checker inline-block shrink-0 rounded-sm border border-black/15 ${className}`}
    >
      <span
        className="block h-full w-full rounded-sm"
        style={swatchStyle(rgba)}
      />
    </span>
  );
}

function ColorPickerBody({
  value,
  transparentValue,
  onApply,
  onClose,
}: {
  value: string;
  transparentValue: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const [draft, dispatch] = useReducer(
    colorDraftReducer,
    value,
    initColorDraft
  );
  const [hexText, setHexText] = useState<string | null>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const { r, g, b, a } = draft.rgba;
  const rgbHex = rgbaToHex({ r, g, b, a: 100 });
  const hueRgb = hsvToRgb(draft.h, 1, 1);
  const hueColor = `rgb(${hueRgb.r}, ${hueRgb.g}, ${hueRgb.b})`;

  const pickSv = (e: PointerEvent<HTMLDivElement>) => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const v =
      1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    dispatch({ type: 'sv', s, v });
  };

  const channelInput = (channel: 'r' | 'g' | 'b' | 'a', label: string) => (
    <label className="flex flex-col items-center gap-1 text-xs text-gray-600">
      <input
        aria-label={label}
        inputMode="numeric"
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
        value={draft.rgba[channel]}
        onChange={(e) =>
          dispatch({
            type: 'channel',
            channel,
            value: Number(e.target.value.replace(/\D/g, '')),
          })
        }
      />
      {label}
    </label>
  );

  return (
    <>
      <DialogTitle className="text-lg font-medium">색상 선택</DialogTitle>
      <div className="flex items-center gap-2 text-sm">
        <Swatch rgba={draft.rgba} className="h-5 w-5" />
        <span>
          {draft.transparent ? '투명-transparent' : rgbaToHex(draft.rgba)}
        </span>
      </div>
      <div className="rounded border border-gray-200 p-3">
        <div
          ref={squareRef}
          role="slider"
          aria-label="채도/명도"
          aria-valuenow={Math.round(draft.s * 100)}
          tabIndex={0}
          className="relative h-56 cursor-pointer touch-none select-none"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pickSv(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) pickSv(e);
          }}
        >
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{
              left: `${draft.s * 100}%`,
              top: `${(1 - draft.v) * 100}%`,
            }}
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <input
              type="range"
              aria-label="색상"
              min={0}
              max={359}
              value={Math.round(draft.h)}
              className="ts-color-range ts-color-hue"
              onChange={(e) =>
                dispatch({ type: 'hue', h: Number(e.target.value) })
              }
            />
            <span className="ts-color-checker block rounded-sm">
              <input
                type="range"
                aria-label="투명도"
                min={0}
                max={100}
                value={a}
                className="ts-color-range"
                style={{
                  background: `linear-gradient(to right, transparent, ${rgbHex})`,
                }}
                onChange={(e) =>
                  dispatch({
                    type: 'channel',
                    channel: 'a',
                    value: Number(e.target.value),
                  })
                }
              />
            </span>
          </div>
          <Swatch rgba={draft.rgba} className="h-7 w-7" />
        </div>
        <div className="mt-2 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2">
          <label className="flex flex-col items-center gap-1 text-xs text-gray-600">
            <input
              aria-label="Hex"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
              value={hexText ?? rgbHex.slice(1).toUpperCase()}
              onChange={(e) => {
                setHexText(e.target.value);
                const rgba = parseHexInput(e.target.value, a);
                if (rgba) dispatch({ type: 'rgba', rgba });
              }}
              onBlur={() => setHexText(null)}
            />
            Hex
          </label>
          {channelInput('r', 'R')}
          {channelInput('g', 'G')}
          {channelInput('b', 'B')}
          {channelInput('a', 'A')}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-200 pt-3">
          {COLOR_PRESETS.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              aria-label={hex}
              className="h-4 w-4 cursor-pointer rounded-sm border border-black/15"
              style={{ backgroundColor: hex }}
              onClick={() => {
                setHexText(null);
                dispatch({ type: 'preset', hex });
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="mr-auto cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm"
          onClick={() => {
            setHexText(null);
            dispatch({ type: 'transparent' });
          }}
        >
          투명색
        </button>
        <button
          type="button"
          className="cursor-pointer rounded border border-[#1976d2] px-4 py-1.5 text-sm text-[#1976d2]"
          onClick={() => onApply(draftToValue(draft, transparentValue))}
        >
          적용
        </button>
        <button
          type="button"
          className="cursor-pointer rounded border border-gray-300 px-4 py-1.5 text-sm"
          onClick={onClose}
        >
          취소
        </button>
      </div>
    </>
  );
}

export function TimeSaleColorPicker({
  value,
  onChange,
  transparentValue = 'transparent',
}: {
  value: string;
  onChange: (value: string) => void;
  transparentValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const rgba = parseColor(value);
  const label = !rgba
    ? value || '투명-transparent'
    : rgba.a === 0
      ? '투명-transparent'
      : rgbaToHex(rgba);

  return (
    <>
      <button
        type="button"
        className="ts-color-trigger"
        onClick={() => setOpen(true)}
      >
        <Swatch rgba={rgba} className="h-4 w-4" />
        <span>{label}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="gap-3 sm:max-w-md [&_[data-slot=dialog-close]]:cursor-pointer"
        >
          {open && (
            <ColorPickerBody
              value={value}
              transparentValue={transparentValue}
              onApply={(next) => {
                onChange(next);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
