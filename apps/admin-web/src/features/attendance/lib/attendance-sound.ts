export type AttendanceSoundKind = 'in' | 'out';

export const ATTENDANCE_VOICE_TEXT = {
  in: '출근하였습니다.',
  out: '퇴근하였습니다.',
} as const;

let activeUtterance: SpeechSynthesisUtterance | null = null;

function speech() {
  if (
    typeof window === 'undefined' ||
    !window.speechSynthesis ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    throw new Error('이 기기에서는 음성 안내를 지원하지 않아요.');
  }

  return window.speechSynthesis;
}

export function stopAttendanceVoice() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  activeUtterance = null;
}

export function prepareAttendanceVoice() {
  const synthesis = speech();
  const silent = new SpeechSynthesisUtterance('');

  silent.lang = 'ko-KR';
  silent.volume = 0;

  // iOS removes its speech gesture restriction on this original button tap.
  // Announce the actual confirmation only after the punch request succeeds.
  synthesis.cancel();
  synthesis.speak(silent);
  synthesis.cancel();
  synthesis.getVoices();
}

export async function playAttendanceVoice(kind: AttendanceSoundKind) {
  const synthesis = speech();
  const utterance = new SpeechSynthesisUtterance(ATTENDANCE_VOICE_TEXT[kind]);
  const voices = synthesis.getVoices();
  const korean = voices.filter((voice) => /^ko([-_]|$)/i.test(voice.lang));
  const voice = korean.find((item) => item.localService) ?? korean[0];

  utterance.lang = 'ko-KR';
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 0.8;

  if (voice) {
    utterance.voice = voice;
  }

  synthesis.cancel();
  activeUtterance = utterance;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (activeUtterance === utterance) {
        stopAttendanceVoice();
      }

      reject(new Error('음성 안내를 시작하지 못했어요. 다시 눌러 주세요.'));
    }, 8000);

    function finish(error?: string) {
      clearTimeout(timer);

      if (activeUtterance === utterance) {
        activeUtterance = null;
      }

      if (error) {
        reject(
          new Error(
            '음성을 재생하지 못했어요. 기기의 한국어 음성과 음량을 확인해 주세요.'
          )
        );
      } else {
        resolve();
      }
    }

    utterance.onend = () => finish();
    utterance.onerror = (event) => finish(event.error);

    try {
      synthesis.speak(utterance);
    } catch {
      finish('speech-failed');
    }
  });
}
