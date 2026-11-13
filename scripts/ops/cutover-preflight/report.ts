// 판정 출력. ✗ 는 반드시 «무엇이 고치는지»(이슈·명령)를 함께 적는다 — 판정자는 고치지 않는다.
//
// 「당일 처리」(◆)는 일부러 컷오버 당일에 고치는 항목이다(예: 마지막 셀메이트 sync 직후의 재고 이동).
// 컷오버 전(기본)에는 남아 있는 게 정상이라 실패로 세지 않고, `--after-cutover` 로 돌리면 ✗ 로 센다.
//
// 「2단계」(◇)는 마켓(네이버·쿠팡) 통합(#1306)의 선행조건이다. 1단계(자사몰·core 재고 정본) 판정에서는 보여 주기만 하고
// 실패로 세지 않는다 — 1단계가 끝났는데 마켓 항목 때문에 늘 빨갛게 남으면 판정을 아무도 믿지 않게 된다.
export type Phase = 'before' | 'after';

export class Report {
  failures = 0;
  dayOfPending = 0;
  laterPending = 0;

  /** `--after-cutover=<시각 T>` 로 준 컷오버 시각. 셀메이트 sync 가 그 뒤에 돌았는지 본다. */
  constructor(
    readonly phase: Phase = 'before',
    readonly cutoverAt: Date | null = null,
  ) {}

  ok(msg: string): void {
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  }

  bad(msg: string, fix: string): void {
    this.failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${msg}\n      → ${fix}`);
  }

  /** 컷오버 당일에 고치는 항목. 컷오버 뒤에 남아 있으면 그때부터 실패다. */
  dayOf(msg: string, fix: string): void {
    if (this.phase === 'after') {
      this.bad(`${msg} (당일 처리 항목인데 남아 있다)`, fix);
      return;
    }
    this.dayOfPending += 1;
    console.log(`  \x1b[36m◆\x1b[0m [당일 처리] ${msg}\n      → ${fix}`);
  }

  /** 2단계(마켓 통합) 항목. 1단계 판정에서는 실패로 세지 않는다. */
  later(msg: string, fix: string): void {
    this.laterPending += 1;
    console.log(`  \x1b[35m◇\x1b[0m [2단계] ${msg}\n      → ${fix}`);
  }

  info(msg: string): void {
    console.log(`  \x1b[33m·\x1b[0m ${msg}`);
  }

  section(title: string): void {
    console.log(`\n\x1b[1m${title}\x1b[0m`);
  }

  table(rows: readonly object[]): void {
    if (rows.length) console.table(rows);
    else this.info('(0행)');
  }

  summary(): string {
    const dayOf = this.dayOfPending ? ` · \x1b[36m◆ 당일 처리 ${this.dayOfPending}건\x1b[0m(실패로 세지 않음)` : '';
    const later = this.laterPending ? ` · \x1b[35m◇ 2단계 ${this.laterPending}건\x1b[0m(1단계 판정에서 빠짐)` : '';

    return this.failures
      ? `\n\x1b[31m✗ ${this.failures}건\x1b[0m${dayOf}${later}`
      : `\n\x1b[32m✓ 1단계 전부 통과\x1b[0m${dayOf}${later}`;
  }
}
