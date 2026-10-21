'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { pickBackCamera, scannerConstraintsFor } from '../field-capture-model';

type Props = {
  /** 이미 붙었거나 올리는 중인 사진 수 — 위에 n/최소 장수로 보인다 */
  count: number;
  min: number;
  onShot: (file: File) => void;
  /** 카메라를 못 열었다 — 부모가 폰 카메라 앱 경로로 돌린다 */
  onFail: () => void;
  onClose: () => void;
};

/**
 * 화면 안 카메라. 폰 카메라 앱으로 넘어가면 그동안 폰이 탭을 내려 찍은 사진이 사라졌다(2026-10-21 현장) —
 * 탭을 떠나지 않게 이 페이지에서 찍는다.
 */
export function PhotoCamera({ count, min, onShot, onFail, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let closed = false;
    (async () => {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const lens = pickBackCamera(devices);
      const s = await navigator.mediaDevices
        .getUserMedia(scannerConstraintsFor(lens))
        .catch((e: unknown) => (lens ? navigator.mediaDevices.getUserMedia(scannerConstraintsFor(null)) : Promise.reject(e)));
      if (closed) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = s;
      await video.play();
      setReady(true);
    })().catch(() => {
      if (!closed) onFailRef.current();
    });
    return () => {
      closed = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const shoot = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setShots((s) => [...s, URL.createObjectURL(file)]);
        onShot(file);
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex h-14 items-center justify-between px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="카메라 닫기"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-[15px] font-semibold">
          {count}/{min}장 이상
        </span>
        <span className="w-11" />
      </div>
      <video ref={videoRef} className="min-h-0 w-full flex-1 bg-gray-800 object-contain" muted playsInline />
      <div className="flex h-16 gap-2 overflow-x-auto px-4 pt-3">
        {shots.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element -- 방금 찍은 로컬 사진
          <img key={url} src={url} alt="" className="h-14 w-14 shrink-0 rounded-lg border-2 border-white object-cover" />
        ))}
      </div>
      <div className="flex h-28 items-center justify-between px-7 pb-[env(safe-area-inset-bottom)]">
        <span className="w-[72px]" />
        <button
          type="button"
          onClick={shoot}
          disabled={!ready}
          aria-label="찍기"
          className="h-[76px] w-[76px] rounded-full border-4 border-white bg-white shadow-[inset_0_0_0_4px_#000] active:scale-95 disabled:opacity-40"
        />
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-[72px] rounded-full bg-blue-600 text-[15px] font-bold"
        >
          완료
        </button>
      </div>
    </div>
  );
}
