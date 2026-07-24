import { cn } from './cn';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * 장갑 낀 손으로 누르는 큰 숫자패드. 자릿수 누적 방식이라 스캔 흐름을
 * 끊지 않는다. 값은 항상 정수이고, 부호는 allowNegative 일 때만 뒤집힌다.
 */
export function NumberPad({
  value,
  onChange,
  allowNegative = false,
}: {
  value: number;
  onChange: (next: number) => void;
  allowNegative?: boolean;
}) {
  const negative = value < 0;
  const magnitude = Math.abs(value);

  function signed(n: number): number {
    return negative ? -n : n;
  }

  function pressDigit(d: string) {
    const next = Number(`${magnitude}${d}`);
    onChange(signed(Number.isFinite(next) ? next : magnitude));
  }

  function pressBackspace() {
    const text = String(magnitude);
    const next = text.length <= 1 ? 0 : Number(text.slice(0, -1));
    onChange(signed(next));
  }

  const keyClass = cn(
    'h-14 rounded-lg border border-gray-300 bg-white text-xl font-semibold',
    'text-gray-800 active:bg-gray-100'
  );

  return (
    <div className="grid grid-cols-3 gap-2">
      {DIGITS.map((d) => (
        <button key={d} type="button" className={keyClass} onClick={() => pressDigit(d)}>
          {d}
        </button>
      ))}
      {allowNegative ? (
        <button
          type="button"
          className={keyClass}
          aria-label="부호"
          onClick={() => {
            const toggled = -value;
            onChange(toggled === 0 ? 0 : toggled);
          }}
        >
          ±
        </button>
      ) : (
        <span />
      )}
      <button type="button" className={keyClass} onClick={() => pressDigit('0')}>
        0
      </button>
      <button type="button" className={keyClass} aria-label="지우기" onClick={pressBackspace}>
        ←
      </button>
    </div>
  );
}
