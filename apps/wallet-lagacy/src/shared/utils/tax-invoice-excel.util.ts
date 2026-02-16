// src/shared/utils/tax-invoice-excel.util.ts
import ExcelJS from 'exceljs';
// src/shared/dtos/invoice.dto.ts
export interface TaxInvoiceLine {
  // 공급자(우리) 정보
  supplierBusinessNumber: string; // 사업자등록번호
  supplierName: string;
  supplierCeoName: string;
  supplierAddress: string;
  supplierEmail?: string;

  // 공급받는자 정보
  customerBusinessNumber: string; // 사업자/개인 번호
  customerName: string;
  customerCeoName?: string;
  customerAddress?: string;
  customerEmail?: string;

  // 세금계산서 기본 정보
  issueDate: string; // YYYY-MM-DD
  itemName: string; // 품목명
  spec?: string; // 규격
  quantity?: number; // 수량
  unitPrice?: number; // 단가
  supplyAmount: number; // 공급가액
  taxAmount: number; // 세액
  totalAmount: number; // 합계금액
  remark?: string; // 비고
}

/**
 * 세금계산서 데이터를 엑셀 파일 Buffer로 변환
 * @param invoices 세금계산서 행 데이터
 */
export async function exportTaxInvoicesToExcel(
  invoices: TaxInvoiceLine[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('TaxInvoices');

  // 헤더 정의 (홈택스 일괄작성용과 유사)
  sheet.columns = [
    { header: '공급자사업자번호', key: 'supplierBusinessNumber', width: 15 },
    { header: '공급자상호', key: 'supplierName', width: 20 },
    { header: '공급자대표자', key: 'supplierCeoName', width: 15 },
    { header: '공급자주소', key: 'supplierAddress', width: 30 },
    { header: '공급자이메일', key: 'supplierEmail', width: 20 },

    {
      header: '공급받는자사업자번호',
      key: 'customerBusinessNumber',
      width: 15,
    },
    { header: '공급받는자상호', key: 'customerName', width: 20 },
    { header: '공급받는자대표자', key: 'customerCeoName', width: 15 },
    { header: '공급받는자주소', key: 'customerAddress', width: 30 },
    { header: '공급받는자이메일', key: 'customerEmail', width: 20 },

    { header: '작성일자', key: 'issueDate', width: 12 },
    { header: '품목명', key: 'itemName', width: 20 },
    { header: '규격', key: 'spec', width: 12 },
    { header: '수량', key: 'quantity', width: 10 },
    { header: '단가', key: 'unitPrice', width: 10 },
    { header: '공급가액', key: 'supplyAmount', width: 15 },
    { header: '세액', key: 'taxAmount', width: 15 },
    { header: '합계금액', key: 'totalAmount', width: 15 },
    { header: '비고', key: 'remark', width: 20 },
  ];

  // 데이터 행 추가
  invoices.forEach((inv) => {
    sheet.addRow(inv);
  });

  // 스타일 옵션 (필요하면 헤더 Bold)
  sheet.getRow(1).font = { bold: true };

  // 버퍼로 내보내기
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer);
}
