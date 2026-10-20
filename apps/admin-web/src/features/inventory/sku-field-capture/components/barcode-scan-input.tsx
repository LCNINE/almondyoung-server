'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { Camera, X } from 'lucide-react';
import { cameraFailure, cameraUnavailableReason, scanInputValue, type BarcodeFormatName } from '../field-capture-model';

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
export function BarcodeScanInput({ label, onScan, placeholder, autoFocus, prominent, formats }: Props) {
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  // undefined = 아직 확인 전(SSR), null = 쓸 수 있음, string = 못 쓰는 이유
  const [blocked, setBlocked] = useState<string | null | undefined>(undefined);
  const [hint, setHint] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    setBlocked(
      cameraUnavailableReason({
        isSecureContext: window.isSecureContext,
        hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
      }),
    );
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!scanning || !video) return;
    let controls: IScannerControls | null = null;
    let done = false;
    const stopNow = () => {
      done = true;
      controls?.stop();
    };
    // 디코더는 카메라를 처음 켤 때만 받는다 (SSR·첫 화면 번들에서 뺀다)
    import('@zxing/browser')
      .then(({ BrowserMultiFormatReader, BarcodeFormat }) => {
        const reader = new BrowserMultiFormatReader();
        // DecodeHintType.POSSIBLE_FORMATS 를 reader 의 hints 에 넣는 setter
        if (formats) reader.possibleFormats = formats.map((f) => BarcodeFormat[f]);
        return reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          video,
          (result, _err, c) => {
            if (!result || done) return;
            done = true;
            c.stop();
            setScanning(false);
            onScanRef.current(result.getText());
          },
        );
      })
      .then((c) => {
        controls = c;
        if (done) c.stop();
      })
      .catch((e: unknown) => {
        if (done) return; // 이미 닫았다
        const f = cameraFailure(e);
        setScanning(false);
        if (f.retryable) setHint(f.message);
        else setBlocked(f.message);
      });
    return stopNow;
  }, [scanning, formats]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = scanInputValue(text);
    if (value === null) return;
    setText('');
    onScan(value);
  };

  const cameraUsable = blocked === null;

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
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
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
      {typeof blocked === 'string' && <p className="text-xs text-gray-500">{blocked}</p>}
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
        <button type="submit" className="h-11 shrink-0 rounded-lg bg-gray-800 px-4 text-sm font-medium text-white">
          확인
        </button>
      </form>
    </div>
  );
}
