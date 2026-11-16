export type FeedbackKind = 'success' | 'error' | 'complete' | 'command' | 'attention';

export interface Tone {
  frequency: number;
  wave: OscillatorType;
  startMs: number;
  durationMs: number;
}

/**
 * 다섯 가지 소리(스펙 §5.4). 화면을 안 보고 구별할 수 있어야 한다:
 * 성공 = 짧고 높게, 오류 = 낮은 사각파 두 번, 완료 = 올라가는 두 음, 명령 = 아주 짧은 딸깍,
 * 주의 = 가운데 높이 삼각파 두 번(받긴 했지만 예상 밖 — 선적 상자의 «리스트에 없던 물건» 스캔).
 */
export const TONES: Record<FeedbackKind, readonly Tone[]> = {
  success: [{ frequency: 1760, wave: 'sine', startMs: 0, durationMs: 70 }],
  error: [
    { frequency: 220, wave: 'square', startMs: 0, durationMs: 160 },
    { frequency: 220, wave: 'square', startMs: 220, durationMs: 160 },
  ],
  complete: [
    { frequency: 1047, wave: 'sine', startMs: 0, durationMs: 110 },
    { frequency: 1568, wave: 'sine', startMs: 120, durationMs: 220 },
  ],
  command: [{ frequency: 2637, wave: 'triangle', startMs: 0, durationMs: 35 }],
  attention: [
    { frequency: 880, wave: 'triangle', startMs: 0, durationMs: 90 },
    { frequency: 880, wave: 'triangle', startMs: 140, durationMs: 90 },
  ],
};
