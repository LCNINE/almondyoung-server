/** @format */

'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Package, Printer, Search } from 'lucide-react';
import Image from 'next/image';

export default function InspectionTemplate() {
  const waitingList = [
    {
      id: 1,
      image: '/nomond.png',
      productName: '노르드 아이패치',
      link: '출고가능',
      note: '',
      stock: 28697,
      location: 'J-02-06',
      barcode: '11137220000',
      order: 300,
      scan: 0,
    },
    {
      id: 2,
      image: '/nomond.png',
      productName: '니차반 SG12 테이프',
      link: '출고가능',
      note: '★에어캡포장 필수',
      stock: 836,
      location: 'I-02-07',
      barcode: '10418920000',
      order: 24,
      scan: 0,
    },
    {
      id: 3,
      image: '/nomond.png',
      productName: '3M 스카치 매직테이프',
      link: '출고가능',
      note: '',
      stock: 1200,
      location: 'A-01-01',
      barcode: '10000030000',
      order: 15,
      scan: 0,
    },
    {
      id: 4,
      image: '/nomond.png',
      productName: '포스트잇 노트 654',
      link: '출고가능',
      note: '★수량 확인 필수',
      stock: 452,
      location: 'B-03-05',
      barcode: '10000040000',
      order: 40,
      scan: 0,
    },
    {
      id: 5,
      image: '/nomond.png',
      productName: '코쿠요 바인더 A4',
      link: '출고가능',
      note: '',
      stock: 320,
      location: 'C-04-02',
      barcode: '10000050000',
      order: 12,
      scan: 0,
    },
    {
      id: 6,
      image: '/nomond.png',
      productName: '제브라 사라사 클립 0.5',
      link: '출고가능',
      note: '★고객 요청: 파란색만',
      stock: 5000,
      location: 'D-01-08',
      barcode: '10000060000',
      order: 120,
      scan: 0,
    },
    {
      id: 7,
      image: '/nomond.png',
      productName: '모나미 153 볼펜',
      link: '출고가능',
      note: '',
      stock: 15000,
      location: 'E-03-04',
      barcode: '10000070000',
      order: 300,
      scan: 0,
    },
    {
      id: 8,
      image: '/nomond.png',
      productName: '제트스트림 0.7 펜',
      link: '출고가능',
      note: '',
      stock: 900,
      location: 'F-02-01',
      barcode: '10000080000',
      order: 50,
      scan: 0,
    },
    {
      id: 9,
      image: '/nomond.png',
      productName: '트위스트 노트',
      link: '출고가능',
      note: '',
      stock: 120,
      location: 'G-05-02',
      barcode: '10000090000',
      order: 10,
      scan: 0,
    },
    {
      id: 10,
      image: '/nomond.png',
      productName: '모닝글로리 연필 HB',
      link: '출고가능',
      note: '',
      stock: 2500,
      location: 'H-01-03',
      barcode: '10000100000',
      order: 200,
      scan: 0,
    },
    {
      id: 11,
      image: '/nomond.png',
      productName: '프린트용지 A4 80g',
      link: '출고가능',
      note: '★무거움 주의',
      stock: 10000,
      location: 'I-06-07',
      barcode: '10000110000',
      order: 500,
      scan: 0,
    },
    {
      id: 12,
      image: '/nomond.png',
      productName: '마스킹 테이프',
      link: '출고가능',
      note: '',
      stock: 600,
      location: 'J-02-08',
      barcode: '10000120000',
      order: 36,
      scan: 0,
    },
    {
      id: 13,
      image: '/nomond.png',
      productName: '화이트보드 마커',
      link: '출고가능',
      note: '★색상 혼합 불가',
      stock: 800,
      location: 'K-03-01',
      barcode: '10000130000',
      order: 60,
      scan: 0,
    },
    {
      id: 14,
      image: '/nomond.png',
      productName: '클립보드 A4',
      link: '출고가능',
      note: '',
      stock: 340,
      location: 'L-01-02',
      barcode: '10000140000',
      order: 20,
      scan: 0,
    },
    {
      id: 15,
      image: '/nomond.png',
      productName: '지우개',
      link: '출고가능',
      note: '',
      stock: 1200,
      location: 'M-04-03',
      barcode: '10000150000',
      order: 80,
      scan: 0,
    },
    {
      id: 16,
      image: '/nomond.png',
      productName: '칼라 제본표지',
      link: '출고가능',
      note: '',
      stock: 540,
      location: 'N-05-06',
      barcode: '10000160000',
      order: 25,
      scan: 0,
    },
    {
      id: 17,
      image: '/nomond.png',
      productName: '플라스틱 파일',
      link: '출고가능',
      note: '',
      stock: 860,
      location: 'O-02-02',
      barcode: '10000170000',
      order: 45,
      scan: 0,
    },
    {
      id: 18,
      image: '/nomond.png',
      productName: '스테이플러',
      link: '출고가능',
      note: '★호침 포함 여부 확인',
      stock: 330,
      location: 'P-03-05',
      barcode: '10000180000',
      order: 18,
      scan: 0,
    },
    {
      id: 19,
      image: '/nomond.png',
      productName: '커터칼',
      link: '출고가능',
      note: '',
      stock: 720,
      location: 'Q-01-04',
      barcode: '10000190000',
      order: 60,
      scan: 0,
    },
    {
      id: 20,
      image: '/nomond.png',
      productName: '바인더 클립 소형',
      link: '출고가능',
      note: '',
      stock: 1800,
      location: 'R-02-07',
      barcode: '10000200000',
      order: 90,
      scan: 0,
    },
    {
      id: 21,
      image: '/nomond.png',
      productName: '바인더 클립 중형',
      link: '출고가능',
      note: '',
      stock: 1500,
      location: 'S-03-06',
      barcode: '10000210000',
      order: 70,
      scan: 0,
    },
    {
      id: 22,
      image: '/nomond.png',
      productName: '바인더 클립 대형',
      link: '출고가능',
      note: '',
      stock: 1000,
      location: 'T-04-01',
      barcode: '10000220000',
      order: 60,
      scan: 0,
    },
    {
      id: 23,
      image: '/nomond.png',
      productName: '칼라 인덱스',
      link: '출고가능',
      note: '',
      stock: 240,
      location: 'U-01-05',
      barcode: '10000230000',
      order: 12,
      scan: 0,
    },
    {
      id: 24,
      image: '/nomond.png',
      productName: '도화지 A3',
      link: '출고가능',
      note: '★습기 주의',
      stock: 700,
      location: 'V-02-04',
      barcode: '10000240000',
      order: 35,
      scan: 0,
    },
    {
      id: 25,
      image: '/nomond.png',
      productName: '스케치북',
      link: '출고가능',
      note: '',
      stock: 640,
      location: 'W-03-08',
      barcode: '10000250000',
      order: 30,
      scan: 0,
    },
    {
      id: 26,
      image: '/nomond.png',
      productName: '유성매직',
      link: '출고가능',
      note: '',
      stock: 900,
      location: 'X-04-02',
      barcode: '10000260000',
      order: 50,
      scan: 0,
    },
    {
      id: 27,
      image: '/nomond.png',
      productName: '연습장',
      link: '출고가능',
      note: '',
      stock: 2100,
      location: 'Y-05-07',
      barcode: '10000270000',
      order: 100,
      scan: 0,
    },
    {
      id: 28,
      image: '/nomond.png',
      productName: '지퍼백 소형',
      link: '출고가능',
      note: '',
      stock: 3000,
      location: 'Z-01-01',
      barcode: '10000280000',
      order: 150,
      scan: 0,
    },
    {
      id: 29,
      image: '/nomond.png',
      productName: '지퍼백 대형',
      link: '출고가능',
      note: '',
      stock: 1800,
      location: 'AA-02-03',
      barcode: '10000290000',
      order: 80,
      scan: 0,
    },
    {
      id: 30,
      image: '/nomond.png',
      productName: '봉투 A4',
      link: '출고가능',
      note: '',
      stock: 2200,
      location: 'AB-03-06',
      barcode: '10000300000',
      order: 120,
      scan: 0,
    },
  ];

  return (
    <>
      <Card className="p-6">
        <div className="flex gap-4">
          <Card className="basis-1/4">
            <CardContent className="flex flex-col  gap-4">
              <Label className="text-sm font-bold" htmlFor="barcode-input">
                바코드/송장 스캔
              </Label>

              <div className="flex gap-2">
                <div className="w-full">
                  <Input
                    id="barcode-input"
                    type="text"
                    className="bg-[#FFFFCA] rounded-sm"
                  />
                </div>

                <Button className="bg-[#757575] text-white rounded-sm">
                  <Search className="w-4 h-4" />
                </Button>
              </div>

              <ScrollArea className="h-[600px]">
                {/* 송장번호 */}
                <div className="w-full h-[65px] border border-[#D9D9D9] rounded-sm px-[16px] py-3 mb-4">
                  <p className="text-sm font-medium text-[#757575]">송장번호</p>
                  <p className="text-base font-medium">1234567890</p>
                </div>

                {/* 상태 */}
                <div className="w-full border border-[#D9D9D9] rounded-sm px-[16px] py-3 mb-4">
                  <p className="text-sm font-medium text-[#757575]">상태</p>
                  {/* 준비 */}
                  <p className="text-xl font-medium text-[#007AFF]">준비</p>
                  {/* 완료 */}
                  {/* <p className="text-xl font-medium text-[#3BAA64]">완료</p> */}
                  {/* 에러 */}
                  {/* <p className="text-sm font-medium text-[#FF0000]">
                    잘못된 송장번호입니다.
                  </p> */}
                </div>

                {/* 피킹리스트 회차 */}
                <div className="w-full border border-[#D9D9D9] rounded-sm px-[16px] py-3 mb-4">
                  <p className="text-sm font-medium text-[#757575]">
                    뻐킹리스트 회차
                  </p>
                  <p className="text-xl font-bold">뻐킹 리스트 1회차 - 7</p>
                </div>

                {/* 주문 정보 */}
                <div className="w-full flex flex-col gap-1 border border-[#D9D9D9] rounded-sm px-[16px] py-3 mb-4">
                  <p className="text-sm font-medium text-[#757575]">
                    주문 정보
                  </p>
                  {/* 이름, 금액 */}
                  <p className="text-xl font-bold">강은혜 (금액 : 63700 원)</p>

                  {/* 주소 */}
                  <p className="text-base font-normal">
                    주소:서울특별시 광진구 뚝섬로54길 10-5 (자양동) 1층
                    터치브로우 (자양동 636-20)
                  </p>

                  {/* 핸드폰 */}
                  <p className="text-base font-normal">hp:010-4187-6544</p>

                  {/* 전화번호 */}
                  <p className="text-base font-normal">tel:010-4187-6544</p>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardContent className="flex-1">
              <Label className="text-sm font-bold mb-4 block">대기 목록</Label>
              <div className="border rounded-sm">
                <ScrollArea className="h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-center font-bold text-foreground border-r-2">
                          순번
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground border-r-2">
                          이미지
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground border-r-2">
                          상품명
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground border-r-2">
                          재고
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground border-r-2">
                          상품위치
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground border-r-2">
                          바코드
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground border-r-2">
                          주문
                        </TableHead>
                        <TableHead className="text-center font-bold text-foreground">
                          스캔
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {waitingList.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-center">
                            {item.id}
                          </TableCell>
                          <TableCell className="text-center flex justify-center items-center">
                            <div className="relative w-14 h-14">
                              <Image
                                src={item.image || '/placeholder.svg'}
                                alt={item.productName}
                                fill
                                className="object-cover"
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <div>
                                {item.productName}
                                <span className="text-blue-600 ml-1">
                                  ({item.link})
                                </span>
                              </div>
                              {item.note && (
                                <div className="text-red-600 text-sm">
                                  {item.note}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            {item.stock.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.location}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.barcode}
                          </TableCell>
                          <TableCell className="text-center text-red-600 font-medium">
                            {item.order}
                          </TableCell>
                          <TableCell className="text-center text-blue-600 font-medium">
                            {item.scan}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </div>
      </Card>

      <div className="flex gap-2 items-center my-4">
        <Button className="flex items-center gap-2" variant={'outline'}>
          <Printer className="w-4 h-4" />
          인쇄
        </Button>

        <div className="flex gap-2 ml-auto">
          <Button variant={'destructive'} className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            강제 출고
          </Button>

          <Button className="flex items-center gap-2" variant={'outline'}>
            <Package className="w-4 h-4" />
            출고 취소
          </Button>
        </div>
      </div>
    </>
  );
}
