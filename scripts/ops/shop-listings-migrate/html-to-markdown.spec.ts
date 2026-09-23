import { htmlToMarkdown, UnsupportedHtmlError } from './html-to-markdown';

describe('htmlToMarkdown', () => {
  it('문단은 빈 줄로 나눈다', () => {
    expect(htmlToMarkdown('<p>첫 문단</p><p>둘째 문단</p>')).toBe('첫 문단\n\n둘째 문단');
  });

  it('<br> 은 줄바꿈 하나 (렌더러가 remark-breaks 로 그린다)', () => {
    expect(htmlToMarkdown('<p>한 줄<br>두 줄<br/>세 줄<br />네 줄</p>')).toBe('한 줄\n두 줄\n세 줄\n네 줄');
  });

  it('속성 붙은 <br class="x"> 도 줄바꿈', () => {
    expect(htmlToMarkdown('<p>a<br class="x">b</p>')).toBe('a\nb');
  });

  it('닫는 </br> 도 줄바꿈', () => {
    expect(htmlToMarkdown('<p>a</br>b</p>')).toBe('a\nb');
  });

  it('대문자 <P>·<BR> 도 처리한다', () => {
    expect(htmlToMarkdown('<P>A<BR>B</P>')).toBe('A\nB');
  });

  it('빈 문단은 버린다', () => {
    expect(htmlToMarkdown('<p>a</p><p></p><p><br></p><p>b</p>')).toBe('a\n\nb');
  });

  it('속성이 붙은 <p> 도 문단이다', () => {
    expect(htmlToMarkdown('<p style="text-align: center">가운데</p>')).toBe('가운데');
  });

  it('엔티티를 푼다', () => {
    expect(htmlToMarkdown('<p>&lt;보증금&gt; 1,000 &amp; 월세 &quot;50&quot; &#39;협의&#39;&nbsp;끝 &#8361; &#x20A9;</p>')).toBe(
      '<보증금> 1,000 & 월세 "50" \'협의\' 끝 ₩ ₩',
    );
  });

  it('줄 머리의 # 과 > 는 이스케이프한다 — 제목·인용으로 바뀌지 않게', () => {
    expect(htmlToMarkdown('<p>#1 매물<br>> 참고</p>')).toBe('\\#1 매물\n\\> 참고');
  });

  it('허용 밖 태그를 만나면 태그 이름과 함께 실패한다 — 조용히 버리지 않는다', () => {
    expect(() => htmlToMarkdown('<p><strong>굵게</strong></p>')).toThrow(UnsupportedHtmlError);
    try {
      htmlToMarkdown('<p><a href="x">링크</a></p>');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedHtmlError);
      expect((e as UnsupportedHtmlError).tag).toBe('a');
    }
  });

  it('<p> 밖의 맨 텍스트도 받는다', () => {
    expect(htmlToMarkdown('그냥 텍스트')).toBe('그냥 텍스트');
  });
});
