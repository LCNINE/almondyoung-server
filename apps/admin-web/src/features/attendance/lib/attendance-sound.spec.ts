import {
  playAttendanceVoice,
  prepareAttendanceVoice,
} from './attendance-sound';

class TestUtterance {
  lang = '';
  volume = 1;
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor(public text: string) {}
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalUtterance = Object.getOwnPropertyDescriptor(
  globalThis,
  'SpeechSynthesisUtterance'
);
const koreanVoice = { lang: 'ko-KR', name: 'Korean', localService: true };
let spoken: TestUtterance[];
let cancel: jest.Mock;

beforeEach(() => {
  spoken = [];
  cancel = jest.fn();

  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: TestUtterance,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      speechSynthesis: {
        cancel,
        getVoices: () => [{ lang: 'en-US' }, koreanVoice],
        speak: (utterance: TestUtterance) => {
          spoken.push(utterance);
          utterance.onend?.();
        },
      },
    },
  });
});

afterEach(() => {
  for (const [name, descriptor] of [
    ['window', originalWindow],
    ['SpeechSynthesisUtterance', originalUtterance],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

it.each([
  ['in', '출근하였습니다.'],
  ['out', '퇴근하였습니다.'],
] as const)('speaks the correct Korean %s confirmation', async (kind, text) => {
  await playAttendanceVoice(kind);

  expect(spoken).toHaveLength(1);
  expect(spoken[0].text).toBe(text);
  expect(spoken[0].lang).toBe('ko-KR');
  expect(spoken[0].voice).toBe(koreanVoice);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('unlocks speech on the original tap without announcing a successful punch early', () => {
  prepareAttendanceVoice();

  expect(
    spoken.every(
      (utterance) => !utterance.text.trim() && utterance.volume === 0
    )
  ).toBe(true);
  expect(spoken).toHaveLength(1);
});

it('reports unsupported speech rather than claiming to have played a voice', async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  await expect(playAttendanceVoice('in')).rejects.toThrow('음성');
});
