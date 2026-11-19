#!/usr/bin/env python3
"""셀메이트 미발송 주문 export(비밀번호 걸린 .xls)에서 판매처·주문번호 두 열만 CSV 로 뽑는다 (#1251 런북 §3).

셀메이트는 개인정보가 든 주문 파일을 비밀번호를 걸어야만 내보낸다. 저녁 맞추기 init(`--sellmate-orders`)은
암호 파일을 못 읽고, 두 열(판매처·주문번호)만 쓴다. 원본을 암호 없이 풀어 두지 않도록 LibreOffice 를 화면 없이 띄워
메모리에서 열고, 두 열만 쓴다 — 이름·연락처·주소 열은 디스크에 남지 않는다.

    python3 scripts/sellmate/orders-two-columns.py <받은 ord_ordList_….xls> <나갈 CSV>
    # 비밀번호는 화면에 안 보이게 묻는다(파일을 받을 때 정한 값)

필요: LibreOffice + 파이썬 UNO(`python3 -c "import uno"`). 다른 LibreOffice 창이 떠 있어도 따로 프로필을 쓴다.
나갈 CSV 는 판매처·주문번호뿐이지만 커밋하지 않는다(apps/core/tmp/ 는 gitignore).
"""
import collections
import csv
import getpass
import os
import subprocess
import sys
import tempfile
import time

CHANNEL_COLUMNS = ['판매처', '판매처명']
ORDER_NO_COLUMNS = ['주문번호', '판매처주문번호']


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[3].strip(), file=sys.stderr)
        return 2
    src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    if not os.path.isfile(src):
        print(f'파일이 없다: {src}', file=sys.stderr)
        return 2
    try:
        import uno  # noqa: F401
        from com.sun.star.beans import PropertyValue
    except ImportError:
        print('파이썬 UNO 가 없다 — LibreOffice 와 python3-uno 를 설치한다', file=sys.stderr)
        return 2

    password = getpass.getpass('주문 파일 비밀번호(안 보인다): ')

    def prop(name, value):
        p = PropertyValue()
        p.Name, p.Value = name, value
        return p

    with tempfile.TemporaryDirectory(prefix='lo-orders-') as profile:
        pipe = f'lo{os.getpid()}'
        proc = subprocess.Popen(
            ['soffice', '--headless', '--invisible', '--norestore', f'-env:UserInstallation=file://{profile}',
             f'--accept=pipe,name={pipe};urp;'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            local = uno.getComponentContext()
            resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
            ctx = None
            for _ in range(60):
                try:
                    ctx = resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext')
                    break
                except Exception:
                    time.sleep(0.5)
            if ctx is None:
                print('LibreOffice 에 붙지 못했다', file=sys.stderr)
                return 1
            desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
            doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(src), '_blank', 0,
                                               (prop('Hidden', True), prop('Password', password), prop('ReadOnly', True)))
            if doc is None:
                print('파일을 열지 못했다 — 비밀번호를 확인한다', file=sys.stderr)
                return 1
            try:
                sheet = doc.Sheets.getByIndex(0)
                cursor = sheet.createCursor()
                cursor.gotoEndOfUsedArea(False)
                end = cursor.RangeAddress
                data = sheet.getCellRangeByPosition(0, 0, end.EndColumn, end.EndRow).DataArray
            finally:
                doc.close(True)
        finally:
            proc.terminate()

    header = [str(h).strip() for h in data[0]]
    ci = next((header.index(n) for n in CHANNEL_COLUMNS if n in header), -1)
    oi = next((header.index(n) for n in ORDER_NO_COLUMNS if n in header), -1)
    if ci < 0 or oi < 0:
        print(f'판매처/주문번호 열을 못 찾았다. 헤더: {" | ".join(header)}', file=sys.stderr)
        return 1
    rows = [(str(r[ci]).strip(), str(r[oi]).strip()) for r in data[1:]]
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['판매처', '주문번호'])
        w.writerows(rows)
    print(f'{len(rows)}행 → {out}')
    print('판매처별 행 수(많은 순 10):')
    for name, n in collections.Counter(c for c, _ in rows).most_common(10):
        print(f'   {n:>6}  {name}')
    print('init 의 --own-mall-channel 은 위 판매처 이름 중 자사몰 것을 그대로 쓴다')
    return 0


if __name__ == '__main__':
    sys.exit(main())
