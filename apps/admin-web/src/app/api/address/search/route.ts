// app/api/address/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fetch from 'node-fetch';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;

        // 필수 파라미터 체크
        const searchSe = searchParams.get('searchSe') || 'road';
        const srchwrd = searchParams.get('srchwrd');
        const countPerPage = searchParams.get('countPerPage') || '10';
        const currentPage = searchParams.get('currentPage') || '1';

        console.log('검색 파라미터:', { searchSe, srchwrd, countPerPage, currentPage });

        if (!srchwrd) {
            return NextResponse.json(
                { error: '검색어를 입력해주세요.' },
                { status: 400 }
            );
        }

        // 환경변수에서 API 설정 가져오기
        const serviceKey = process.env.KOREA_POST_API_KEY;
        const apiBaseUrl = process.env.KOREA_POST_API_URL;

        if (!serviceKey || !apiBaseUrl) {
            console.error('환경변수 누락:', { serviceKey: !!serviceKey, apiBaseUrl: !!apiBaseUrl });
            return NextResponse.json(
                { error: 'API 설정이 올바르지 않습니다. 환경변수를 확인해주세요.' },
                { status: 500 }
            );
        }

        // 우정사업본부 API 호출
        const params = new URLSearchParams({
            serviceKey: serviceKey,
            searchSe: searchSe,
            srchwrd: srchwrd,
            countPerPage: countPerPage,
            currentPage: currentPage
        });

        const fullUrl = `${apiBaseUrl}?${params.toString()}`;
        console.log('API 호출 URL:', fullUrl);

        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/xml',
            }
        });

        const xmlText = await response.text();
        console.log('API 응답 상태:', response.status);
        console.log('API 응답 (처음 500자):', xmlText.substring(0, 500));

        if (!response.ok) {
            console.error('API 응답 오류:', response.status, xmlText);
            throw new Error(`API 호출 실패: ${response.status}`);
        }

        // XML 파싱 함수
        const getTagValue = (xml: string, tag: string): string[] => {
            const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
            const matches: string[] = [];
            let match;

            while ((match = regex.exec(xml)) !== null) {
                matches.push(match[1]);
            }

            return matches;
        };

        // 에러 체크
        const returnCode = getTagValue(xmlText, 'returnCode')[0];
        console.log('Return Code:', returnCode);

        if (returnCode !== '00') {
            const errMsg = getTagValue(xmlText, 'errMsg')[0] || '알 수 없는 오류';
            console.error('API 에러:', errMsg);

            // 검색 결과가 없는 경우
            if (returnCode === '03') {
                return NextResponse.json({
                    totalCount: 0,
                    addresses: [],
                    currentPage: parseInt(currentPage),
                    countPerPage: parseInt(countPerPage)
                });
            }

            // 인증 실패인 경우 더 자세한 메시지
            if (returnCode === '99' || errMsg.includes('인증')) {
                throw new Error('API 인증에 실패했습니다. 서비스 키를 확인해주세요.');
            }

            throw new Error(errMsg);
        }

        // 결과 파싱
        const totalCount = parseInt(getTagValue(xmlText, 'totalCount')[0] || '0');
        const zipNos = getTagValue(xmlText, 'zipNo');
        const rnAddresses = getTagValue(xmlText, 'rnAdres');
        const lnmAddresses = getTagValue(xmlText, 'lnmAdres');

        console.log('파싱 결과:', {
            totalCount,
            addressCount: zipNos.length
        });

        // 주소 데이터 조합
        const addresses = zipNos.map((_, i) => ({
            zipNo: zipNos[i] || '',
            rnAdres: rnAddresses[i] || '',
            lnmAdres: lnmAddresses[i] || ''
        }));

        return NextResponse.json({
            totalCount,
            addresses,
            currentPage: parseInt(currentPage),
            countPerPage: parseInt(countPerPage)
        });

    } catch (error) {
        console.error('Address search error:', error);

        // 개발 환경에서는 더 자세한 에러 정보 제공
        const isDevelopment = process.env.NODE_ENV === 'development';

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : '주소 검색 중 오류가 발생했습니다.',
                ...(isDevelopment && {
                    details: error instanceof Error ? error.stack : undefined,
                    timestamp: new Date().toISOString()
                })
            },
            { status: 500 }
        );
    }
}