import * as cheerio from 'cheerio';

export class BusinessLicensesHelper {
  constructor() {}

  // 메타 태그 추출 헬퍼
  extractMetaContent(
    $: ReturnType<typeof cheerio.load>,
    property: string,
  ): string {
    return $(`meta[property="${property}"]`).attr('content') || '';
  }

  // 텍스트 추출 헬퍼
  extractText($: ReturnType<typeof cheerio.load>, selector: string): string {
    return $(selector).text().trim();
  }

  // 속성 추출 헬퍼
  extractAttribute(
    $: ReturnType<typeof cheerio.load>,
    selector: string,
    attribute: string,
  ): string {
    return $(selector).attr(attribute) || '';
  }

  // 테이블에서 th 텍스트로 td 값 찾기 헬퍼
  extractTableValue(
    $: ReturnType<typeof cheerio.load>,
    thText: string,
  ): string {
    const thElement = $('th')
      .filter((_, el) => $(el).text().trim() === thText)
      .first();

    if (thElement.length === 0) return '';

    const tdElement = thElement.next('td');
    return tdElement.text().trim();
  }
}
