"""노션 export zip 을 안전하게 푼다.

셸 `unzip` 은 이 zip 의 UTF-8 파일명을 깨뜨리고(엔트리 플래그 0x800 이 서 있는데도),
한글 파일명 몇 개는 ext4 의 255바이트 한계를 넘어 «File name too long» 으로 실패한다.
python zipfile 로 풀면서 긴 이름만 줄이고 원본 매핑을 json 으로 남긴다.
"""
import zipfile, os, json, hashlib, sys

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'notion-export'

def shorten(comp):
    if len(comp.encode('utf-8')) <= 200:
        return comp
    root, ext = os.path.splitext(comp)
    h = hashlib.sha1(comp.encode()).hexdigest()[:8]
    rb = root.encode('utf-8')[:150]
    while True:
        try:
            r = rb.decode('utf-8'); break
        except UnicodeDecodeError:
            rb = rb[:-1]
    return f"{r}~{h}{ext}"

z = zipfile.ZipFile(SRC)
mapping = {}
for i in z.infolist():
    parts = [p for p in i.filename.split('/') if p]
    if not parts:
        continue
    newparts = [shorten(p) for p in parts]
    dst = os.path.join(OUT, *newparts)
    if i.filename.endswith('/'):
        os.makedirs(dst, exist_ok=True); continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with z.open(i) as f, open(dst, 'wb') as o:
        o.write(f.read())
    if newparts != parts:
        mapping[i.filename] = '/'.join(newparts)
json.dump(mapping, open(os.path.join(OUT, '..', 'notion-name-map.json'), 'w'),
          ensure_ascii=False, indent=1)
print('extracted; shortened:', len(mapping))
