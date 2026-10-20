'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { Camera, ImageIcon, X } from 'lucide-react';
import {
  cameraFailure,
  cameraUnavailableReason,
  PHOTO_DECODE_FAILED,
  photoDecodeSize,
  isScanDebug,
  pickBackCamera,
  scanDebugLine,
  scannerConstraintsFor,
  scanInputValue,
  type ScanDebugInfo,
  type BarcodeFormatName,
} from '../field-capture-model';

// 디코더는 처음 쓸 때만 받는다 (SSR·첫 화면 번들에서 뺀다).
// TRY_HARDER 를 켜야 화면 가운데 몇 줄만이 아니라 더 넓게·기울어진 바코드까지 훑는다.
async function createReader(formats?: readonly BarcodeFormatName[]) {
  const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] =
    await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const reader = new BrowserMultiFormatReader(
    new Map([[DecodeHintType.TRY_HARDER, true]])
  );
  // DecodeHintType.POSSIBLE_FORMATS 를 reader 의 hints 에 넣는 setter
  if (formats) reader.possibleFormats = formats.map((f) => BarcodeFormat[f]);
  return reader;
}

// 한 번 고른 후면 메인 렌즈를 화면 사이에서 기억한다(같은 탭 안에서만).
let preferredLens: string | null = null;
// 고른 렌즈로 못 열었으면(기기가 바뀌었거나 그 렌즈를 못 쓰면) 이 탭에선 더 고르지 않고 facingMode 로 연다
let lensPickDisabled = false;

/** 렌즈 이름이 보이면(이미 권한을 줬으면) 메인 후면 렌즈를 고른다. 안 보이면 null. */
async function findBackLens(): Promise<string | null> {
  try {
    return pickBackCamera(await navigator.mediaDevices.enumerateDevices());
  } catch {
    return null;
  }
}

/** 폰 카메라 앱으로 찍은 정지 사진(자동 초점·원본 화소)에서 읽는다. 실시간 화면으로 안 읽힐 때의 길. */
async function decodePhoto(
  file: File,
  formats?: readonly BarcodeFormatName[]
): Promise<string | null> {
  const reader = await createReader(formats);
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = photoDecodeSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    return reader.decodeFromCanvas(canvas).getText();
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

type Props = {
  label: string;
  onScan: (value: string) => void;
  placeholder?: string;
  /** 블루투스 스캐너(키보드 입력)가 바로 들어오게 텍스트 칸에 포커스 */
  autoFocus?: boolean;
  /** 첫 화면처럼 카메라 버튼을 크게 */
  prominent?: boolean;
  /** 카메라가 읽을 형식. 없으면 전부 (텍스트 칸·블루투스 스캐너엔 적용되지 않는다) */
  formats?: readonly BarcodeFormatName[];
};

/**
 * 카메라 연속 디코드(첫 결과에서 멈춤) + 텍스트 칸(엔터=제출).
 * 텍스트 칸이 블루투스 스캐너·수동 입력·카메라 불가 환경의 대체 경로다.
 */
export function BarcodeScanInput({
  label,
  onScan,
  placeholder,
  autoFocus,
  prominent,
  formats,
}: Props) {
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  // undefined = 아직 확인 전(SSR), null = 쓸 수 있음, string = 못 쓰는 이유
  const [blocked, setBlocked] = useState<string | null | undefined>(undefined);
  const [hint, setHint] = useState<string | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  // ?scanDebug=1 일 때만 채운다 — 실기에서 실시간 스캔이 무엇을 받고 있는지 보려는 진단
  const [debug, setDebug] = useState<ScanDebugInfo | null>(null);
  // 메인 렌즈로 다시 열 때 올린다(처음엔 권한 전이라 렌즈 이름을 못 봐서 facingMode 로 연다)
  const [reopen, setReopen] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    setBlocked(
      cameraUnavailableReason({
        isSecureContext: window.isSecureContext,
        hasGetUserMedia:
          typeof navigator.mediaDevices?.getUserMedia === 'function',
      })
    );
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!scanning || !video) return;
    let controls: IScannerControls | null = null;
    let done = false;
    const debugOn = isScanDebug(window.location.search);
    let attempts = 0;
    let lastAt: number | null = null;
    const stopNow = () => {
      done = true;
      controls?.stop();
    };
    let lens: string | null = null;
    (async () => {
      lens = lensPickDisabled
        ? null
        : (preferredLens ?? (await findBackLens()));
      const reader = await createReader(formats);
      return reader.decodeFromConstraints(
        scannerConstraintsFor(lens),
        video,
        (result, err, c) => {
          if (debugOn) {
            attempts += 1;
            const now = performance.now();
            const track =
              video.srcObject instanceof MediaStream
                ? video.srcObject.getVideoTracks()[0]
                : undefined;
            const settings: Record<string, unknown> = {
              ...track?.getSettings(),
            };
            setDebug({
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              trackLabel: track?.label ?? '',
              focusMode:
                typeof settings.focusMode === 'string'
                  ? settings.focusMode
                  : undefined,
              attempts,
              lastError: err ? err.getKind() : null,
              lastDecodeMs: lastAt === null ? null : Math.round(now - lastAt),
            });
            lastAt = now;
          }
          if (!result || done) return;
          done = true;
          c.stop();
          setScanning(false);
          onScanRef.current(result.getText());
        }
      );
    })()
      .then(async (c) => {
        controls = c;
        if (done) {
          c.stop();
          return;
        }
        if (lens) {
          preferredLens = lens;
          return;
        }
        // 권한을 막 받아 이제 렌즈 이름이 보인다 — 연 렌즈가 메인이 아니면 메인으로 한 번 다시 연다
        const main = await findBackLens();
        const track =
          video.srcObject instanceof MediaStream
            ? video.srcObject.getVideoTracks()[0]
            : undefined;
        if (main && !done && !lensPickDisabled) {
          preferredLens = main;
          if (track?.getSettings().deviceId !== main) setReopen((n) => n + 1);
        }
      })
      .catch((e: unknown) => {
        if (done) return; // 이미 닫았다
        if (lens) {
          lensPickDisabled = true;
          preferredLens = null;
          setReopen((n) => n + 1);
          return;
        }
        const f = cameraFailure(e);
        setScanning(false);
        if (f.retryable) setHint(f.message);
        else setBlocked(f.message);
      });
    return stopNow;
  }, [scanning, formats, reopen]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = scanInputValue(text);
    if (value === null) return;
    setText('');
    onScan(value);
  };

  const cameraUsable = blocked === null;

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setHint(null);
    setScanning(false);
    setReadingPhoto(true);
    try {
      const value = await decodePhoto(file, formats);
      if (value) onScanRef.current(value);
      else setHint(PHOTO_DECODE_FAILED);
    } finally {
      setReadingPhoto(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      {cameraUsable && !scanning && (
        <button
          type="button"
          onClick={() => {
            setHint(null);
            setScanning(true);
          }}
          className={
            prominent
              ? 'flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 text-base font-bold text-white'
              : 'flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-800'
          }
        >
          <Camera className="h-5 w-5" />
          {label}
        </button>
      )}
      {scanning && (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
          />
          <button
            type="button"
            onClick={() => setScanning(false)}
            aria-label="카메라 닫기"
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      {typeof blocked === 'string' && (
        <p className="text-xs text-gray-500">{blocked}</p>
      )}
      <button
        type="button"
        onClick={() => photoRef.current?.click()}
        disabled={readingPhoto}
        className="flex w-full items-center justify-center gap-1.5 py-1 text-sm text-gray-600 disabled:opacity-50"
      >
        <ImageIcon className="h-4 w-4" />
        {readingPhoto ? '사진에서 찾는 중…' : '안 읽히면 사진으로 찍기'}
      </button>
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void readPhoto(e.target.files?.[0])}
      />
      {debug && (
        <p className="break-all font-mono text-[11px] text-gray-500">
          {scanDebugLine(debug)}
        </p>
      )}
      {hint && <p className="text-xs text-amber-700">{hint}</p>}
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? '직접 입력 후 엔터'}
          aria-label={label}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-base"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-lg bg-gray-800 px-4 text-sm font-medium text-white"
        >
          확인
        </button>
      </form>
    </div>
  );
}
