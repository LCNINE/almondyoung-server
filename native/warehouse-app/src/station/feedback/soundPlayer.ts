import type { SoundPrefs } from './soundPrefs';
import { TONES, type FeedbackKind } from './tones';

export interface Beep {
  frequency: number;
  wave: OscillatorType;
  /** 초(AudioContext.currentTime 기준) */
  at: number;
  /** 초 */
  duration: number;
  gain: number;
}

/** 소리를 내는 바닥. Web Audio 구현과 테스트 기록기가 같은 모양을 쓴다. */
export interface ToneSink {
  now(): number;
  beep(beep: Beep): void;
}

/** 음량 100 일 때의 이득. 사각파(오류음)는 같은 이득에서 훨씬 크게 들리고, 1 에 가까우면 찢어진다. */
const MAX_GAIN = 0.3;

export function createSoundPlayer(deps: { sink: ToneSink | null; readPrefs: () => SoundPrefs }) {
  return {
    play(kind: FeedbackKind): void {
      const sink = deps.sink;
      if (!sink) return;
      const { volume, muted } = deps.readPrefs();
      if (muted || volume <= 0) return;
      const start = sink.now();
      for (const tone of TONES[kind])
        sink.beep({
          frequency: tone.frequency,
          wave: tone.wave,
          at: start + tone.startMs / 1000,
          duration: tone.durationMs / 1000,
          gain: (volume / 100) * MAX_GAIN,
        });
    },
  };
}

/** WebView2(Chromium) 의 Web Audio. AudioContext 가 없으면(jsdom) null — 소리 없이 동작한다. */
export function createWebAudioSink(): ToneSink | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  const Ctor = window.AudioContext;
  let context: AudioContext | null = null;
  const get = () => (context ??= new Ctor());
  return {
    now: () => get().currentTime,
    beep({ frequency, wave, at, duration, gain }) {
      const ctx = get();
      // 자동재생 정책: 첫 사용자 입력 전에는 suspended 다. 스캐너 키 입력도 사용자 입력이다(실기 확인 §10.3-3).
      if (ctx.state === 'suspended') void ctx.resume();
      const oscillator = ctx.createOscillator();
      const amp = ctx.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      amp.gain.setValueAtTime(gain, at);
      // 0 으로 끊으면 «틱» 잡음이 난다 — 지수 감쇠로 닫는다(0 은 지수 램프의 목표가 될 수 없다).
      amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(amp).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + duration);
    },
  };
}

let shared: ToneSink | null | undefined;
/** 앱 전체에 AudioContext 하나 — 셸이 다시 붙어도(재로그인) 새로 만들지 않는다. */
export function defaultToneSink(): ToneSink | null {
  if (shared === undefined) shared = createWebAudioSink();
  return shared;
}
