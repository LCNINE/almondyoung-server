const SIDO: Readonly<Record<string, string>> = {
  서울특별시: '서울',
  부산광역시: '부산',
  대구광역시: '대구',
  인천광역시: '인천',
  광주광역시: '광주',
  대전광역시: '대전',
  울산광역시: '울산',
  세종특별자치시: '세종',
  경기도: '경기',
  강원특별자치도: '강원',
  강원도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  전북특별자치도: '전북',
  전라북도: '전북',
  전라남도: '전남',
  경상북도: '경북',
  경상남도: '경남',
  제주특별자치도: '제주',
};
const SIDO_SHORT: ReadonlySet<string> = new Set(Object.values(SIDO));

function toSido(token: string): string {
  const short = SIDO[token] ?? (SIDO_SHORT.has(token) ? token : undefined);
  if (!short) throw new Error(`unrecognized 시·도 in address: ${token}`);
  return short;
}

// ponytail: 도로명 주소엔 읍·면·동이 없어 umd 에 도로명을 넣는다. 첫 실주문에서 와우프레스가 거절하면 우편번호→법정동 조회로 교체
export function splitKoreanAddress(roadAddress: string): { sd: string; sgg: string; umd: string } {
  const tokens = roadAddress.trim().split(/\s+/);
  const sd = toSido(tokens[0] ?? '');
  let i = 1;
  let sgg: string;
  if (sd === '세종') {
    sgg = '세종시';
  } else {
    sgg = tokens[i] ?? '';
    i += 1;
    const next = tokens[i];
    if (sgg.endsWith('시') && next && /[구군]$/.test(next)) {
      sgg = `${sgg} ${next}`;
      i += 1;
    }
  }
  const umd = tokens[i];
  if (!sgg || !umd) throw new Error(`cannot split address: ${roadAddress}`);
  return { sd, sgg, umd };
}
