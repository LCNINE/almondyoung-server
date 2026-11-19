#!/usr/bin/env python3
"""
전날 init dry-run 용: 재고 현황 파일에서 «짝 못 지은 품목» 행을 뺀 사본을 만든다 (런북 #1251 §1).

init 은 짝 못 지은 품목이 하나라도 있으면 그 뒤 검사(부천 ON_HAND, 넘긴 주문 ↔ Medusa)를 돌지 않는다.
전날에는 그날 새로 생긴 품목(T 의 import-products 가 푼다)이 늘 남으므로, 그 행을 뺀 사본으로 뒤 검사까지 본다.
사본은 dry-run 에만 쓴다 — 당일 4-4 는 원본 파일로 돌린다.

사용:
  bash scripts/sellmate/run.sh live evening-reconcile pair <재고 CSV> > pair.txt   # 종료 1 이어도 된다
  python3 scripts/sellmate/without-unpaired.py pair.txt <재고 CSV> <다른 폴더>

- 짝 못 지은 품목 목록은 pair 출력의 «짝 못 지은 품목 N:» 아래 줄의 첫 칸(옵션정보일련번호)에서 읽는다.
- 사본은 <다른 폴더>/<원본과 같은 파일 이름> — init 이 이름에서 스냅샷 시각을 읽으므로 이름을 바꾸지 않는다.
- 셀메이트 «개발팀 데이터 내보내기용» 파일(.xls 이지만 실제로는 cp949 HTML 표)만 다룬다.
"""
import os
import re
import sys

ANSI = re.compile(r'\x1b\[[0-9;]*m')
CELL = re.compile(rb'<td[^>]*>(.*?)</td>', re.S)
TAG = re.compile(rb'<[^>]+>')


def unpaired_serials(pair_output: str) -> set:
    serials, inside = set(), False
    for line in open(pair_output, encoding='utf-8', errors='replace'):
        line = ANSI.sub('', line).rstrip('\n')
        if re.match(r'^짝 못 지은 품목 \d+:', line):
            inside = True
            continue
        if inside:
            m = re.match(r'^\s+(\S+)\s{2,}\S', line)
            if not m:
                break
            serials.add(m.group(1))
    return serials


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    pair_output, src, out_dir = sys.argv[1:]
    serials = unpaired_serials(pair_output)
    if not serials:
        print('pair 출력에 «짝 못 지은 품목» 이 없다 — 사본이 필요 없다(원본으로 init dry-run)')
        return 1

    src_abs, out = os.path.abspath(src), os.path.abspath(os.path.join(out_dir, os.path.basename(src)))
    if os.path.dirname(out) == os.path.dirname(src_abs):
        print('출력 폴더가 원본과 같다 — 원본을 덮지 않게 다른 폴더를 준다')
        return 2

    data = open(src_abs, 'rb').read()
    parts = re.split(rb'(?=<tr)', data)
    header = [TAG.sub(b'', c).strip() for c in CELL.findall(parts[1])]
    idx = header.index('옵션정보일련번호'.encode('cp949'))

    kept, dropped = [], set()
    for i, part in enumerate(parts):
        if i >= 2:
            cells = CELL.findall(part)
            if len(cells) > idx:
                serial = TAG.sub(b'', cells[idx]).strip().decode('cp949', 'replace')
                if serial in serials:
                    dropped.add(serial)
                    continue
        kept.append(part)

    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'wb').write(b''.join(kept))
    print(f'짝 못 지은 품목 {len(serials)} 중 {len(dropped)} 행을 뺐다 → {out}')
    missing = serials - dropped
    if missing:
        print(f'⚠️ 파일에서 못 찾은 품목: {", ".join(sorted(missing))}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
