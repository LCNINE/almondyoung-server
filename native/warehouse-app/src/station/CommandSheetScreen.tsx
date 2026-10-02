import { Button } from '../core/design/Button';
import { Barcode } from './Barcode';
import { COMMAND_SHEET_SECTIONS, SHEET_DIGITS, digitEntry, keyEntry } from './commandSheet';

/**
 * 명령 바코드 시트(스펙 §5.3) — A4 를 OS 인쇄 대화상자로 뽑는다. 송장 프린터에는 송장 용지가 걸려 있어 쓰지 않는다.
 * 셸의 탭 바·기능키 바·상태바는 인쇄에서 빠진다(print:hidden).
 */
export function CommandSheetScreen() {
  return (
    <div className="mx-auto max-w-[210mm] space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold">명령 바코드</h1>
        <Button onClick={() => window.print()}>인쇄</Button>
      </div>
      <article className="space-y-6 bg-white p-8 text-[#15171C] print:p-0">
        {COMMAND_SHEET_SECTIONS.map((section) => (
          <section key={section.title} className="space-y-3 break-inside-avoid">
            <h2 className="border-b-2 border-[#15171C] pb-2 text-2xl font-bold">{section.title}</h2>
            <div className="grid grid-cols-2 gap-4">
              {section.actions.map((action) => {
                const entry = keyEntry(action);
                return (
                  <div
                    key={entry.code}
                    className="flex flex-col gap-2 rounded-lg border border-[#C3C8D2] px-4 py-3 break-inside-avoid"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-xl font-bold">{entry.label}</span>
                      <span className="font-mono text-sm font-semibold text-[#535968]">{entry.caption}</span>
                    </div>
                    <Barcode bits={entry.bits} label={entry.label} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <section className="space-y-3 break-inside-avoid">
          <h2 className="border-b-2 border-[#15171C] pb-2 text-2xl font-bold">수량</h2>
          <div className="grid grid-cols-4 gap-2.5">
            {SHEET_DIGITS.map((digit) => {
              const entry = digitEntry(digit);
              return (
                <div
                  key={entry.code}
                  className="flex flex-col items-center gap-2 rounded-lg border border-[#C3C8D2] px-2 py-3 break-inside-avoid"
                >
                  <span className="font-mono text-3xl font-semibold">{entry.label}</span>
                  <Barcode bits={entry.bits} label={`숫자 ${entry.label}`} moduleWidth={1.3} height={44} />
                </div>
              );
            })}
          </div>
        </section>
      </article>
    </div>
  );
}
