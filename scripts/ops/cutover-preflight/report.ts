// 판정 출력. ✗ 는 반드시 «무엇이 고치는지»(이슈·명령)를 함께 적는다 — 판정자는 고치지 않는다.
export class Report {
  failures = 0;

  ok(msg: string): void {
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  }

  bad(msg: string, fix: string): void {
    this.failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${msg}\n      → ${fix}`);
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
}
