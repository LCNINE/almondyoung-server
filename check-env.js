// Railway 환경변수 확인용 스크립트
console.log('=== 환경변수 확인 ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('NODE_ENV type:', typeof process.env.NODE_ENV);
console.log('NODE_ENV === undefined:', process.env.NODE_ENV === undefined);
console.log('NODE_ENV === "production":', process.env.NODE_ENV === 'production');
console.log('isTest 값:', process.env.NODE_ENV !== 'production');
console.log('');
console.log('SW_KEY:', process.env.SW_KEY ? '설정됨' : '없음');
console.log('CUST_KEY:', process.env.CUST_KEY ? '설정됨' : '없음');
