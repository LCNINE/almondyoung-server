// 자동 생성: live Medusa product_category id 기반 카테고리 대표 썸네일 file id 매핑
// 임시 우회: live stage의 pcat_* id가 dev와 달라 category thumbnail fallback을 live 기준으로 고정합니다.
// 근본 해결 전까지 사용하고, 카테고리/상품 재백필 이후에는 metadata.thumbnail 기반으로 대체해야 합니다.

export const CATEGORY_FALLBACK_THUMBNAILS: Record<string, string> = {
  // 경기도 (cafe24-cat-100)
  pcat_01KT8J1012SQC2FGH2CFNWZ111: "019df045-8325-7534-b1e4-d36f475694a4",
  // 강원도 (cafe24-cat-101)
  pcat_01KT8J11JGQ74W2NASPERA8NFF: "019df01d-3f84-7815-b8cb-0dc2d39bd96e",
  // 충청도&대전 (cafe24-cat-102)
  pcat_01KT8J10XNSPR4JDR41R0511BV: "019df03e-1fc3-7caa-8de8-12efc186aa27",
  // 전라도 (cafe24-cat-103)
  pcat_01KT8J11AK88NQVBHAQN1AQE6Z: "019df02e-c605-77e3-adef-5c6bf9aad721",
  // 경상도&부산&대구 (cafe24-cat-104)
  pcat_01KT8J119NAD0KFJ9B822D8JSA: "019df02f-384c-7cc2-bf69-627c15f2ca85",
  // 인천 (cafe24-cat-173)
  pcat_01KT8J106812RSJ7GTJ2KTD4ES: "019df045-50f0-7d03-8de0-960ba6f712cc",
  // 속눈썹펌 (cafe24-cat-246)
  pcat_01KT8J0XYYYR0GGNSEG5XKHNZC: "019df005-943c-7c16-9713-9d140baf4c0b",
  // 속눈썹연장 (cafe24-cat-247)
  pcat_01KT8J0XW61TT61Z8SVNTZXYS8: "019df03e-5da4-7019-8fb9-5095b3acb89d",
  // 펌제 (cafe24-cat-248)
  pcat_01KT8J0ZJY0SR2RBTXXH8S6QJX: "019df04d-7794-7829-8a7a-13429e188950",
  // 펌글루&왁스 (cafe24-cat-249)
  pcat_01KT8J109WCS8VNB5JC4838S7N: "019df044-dcdd-7bc1-a5d2-13cafc5f8b5f",
  // 롯드 (cafe24-cat-250)
  pcat_01KT8J0Y46KH4E149GGNJE537V: "019df04d-3e77-7d21-96f7-f42db807ae09",
  // 에센스&영양제 (cafe24-cat-251)
  pcat_01KT8J0XZDQXTJEEP076DW7J2K: "019df005-943c-7c16-9713-9d140baf4c0b",
  // 부자재 (cafe24-cat-252)
  pcat_01KT8J0YZ3C9K7PDQCV63WR4CB: "019df04d-b93d-76a1-b871-9f47129fc0ea",
  // 세트 (cafe24-cat-253)
  pcat_01KT8J116BR694XPE6EJAX0HRD: "019df03a-e110-7ecb-902d-c9535de3281b",
  // 래쉬 (cafe24-cat-254)
  pcat_01KT8J0XXGT4MJSDPW5CSC4DAQ: "019df03e-5da4-7019-8fb9-5095b3acb89d",
  // 글루 (cafe24-cat-255)
  pcat_01KT8J0ZY6E0WASCBV3P2W3Z3S: "019df04c-70f8-756e-8795-c5d87ea0a264",
  // 리무버&전처리제 (cafe24-cat-256)
  pcat_01KT8J0ZC24XFCK69XGJ7PJHZV: "019df04d-a8f9-77dc-9ac2-b1e3188a9f27",
  // 핀셋 (cafe24-cat-257)
  pcat_01KT8J10BFRN304VYNBT6D1K4A: "019df049-62eb-746a-ae92-e633c997b162",
  // 에센스&영양제 (cafe24-cat-258)
  pcat_01KT8J10DTE5YKJDJSTB06N7YG: "019df042-f34f-7246-b08e-8233c2c4fcc2",
  // 테이프 (cafe24-cat-259)
  pcat_01KT8J0Z3NENEDM5CYDEK4CGWZ: "019df04d-b4b0-7a5e-b299-e768ec68bbf0",
  // 부자재 (cafe24-cat-260)
  pcat_01KT8J0ZAVBWT7RKQE98MBV0S7: "019df04d-9fa3-7628-a002-955fd7c222ac",
  // 반영구 (cafe24-cat-261)
  pcat_01KT8J0Y58AQY5WQJHTHRJKQJ1: "019df04f-8224-778c-8321-977e5b7dce1a",
  // 니들 (cafe24-cat-262)
  pcat_01KT8J0YGJ7AQ0QRZGJG6728D3: "019df04e-06c0-7684-91ab-105b9a69f5e5",
  // 색소 (cafe24-cat-263)
  pcat_01KT8J0YCAK3XS68585AHZ6ZM6: "019df04f-95c1-70ae-9766-1a07783f2175",
  // 엠보&수지펜 (cafe24-cat-264)
  pcat_01KT8J0YDJSD0H2MAWKKTS46BV: "019df04e-2048-71e0-92bc-accc43ac0890",
  // 머신 (cafe24-cat-265)
  pcat_01KT8J0Y5N239T4JBBZ19HZG6T: "019df04f-8224-778c-8321-977e5b7dce1a",
  // 부자재 (cafe24-cat-266)
  pcat_01KT8J0Z298Y6JAJ6H20M7CDR5: "019df04d-c561-76f8-bb7a-e1d19a5d0764",
  // 왁싱 (cafe24-cat-267)
  pcat_01KT8J0Y84WXFEAHRK9N98NE8T: "019df04f-848a-7057-9ede-887d1449c81c",
  // 왁스 (cafe24-cat-268)
  pcat_01KT8J0Z7T3S3E7FMYFPVWD6NW: "019df04d-e38f-75ca-8faf-fa3cead6b40d",
  // 전후처리제 (cafe24-cat-269)
  pcat_01KT8J0YH0GA1FJM6VGYRTRNE3: "019df04e-05f2-7cf3-b3f4-259f7b4cf1d6",
  // 부자재 (cafe24-cat-270)
  pcat_01KT8J0Y8N6GG6CSPW7P3D989P: "019df04f-848a-7057-9ede-887d1449c81c",
  // 타투 (cafe24-cat-271)
  pcat_01KT8J0YPD4EE9P13FR36CVAX1: "019df04f-8224-778c-8321-977e5b7dce1a",
  // 니들 (cafe24-cat-272)
  pcat_01KT8J0ZGMH3WEJBF8DQ9GBVQT: "019df04a-315d-7840-95dd-9dbdab3c3133",
  // 잉크 (cafe24-cat-273)
  pcat_01KT8J112T0MEWMB1D7H5YE0PK: "019df03c-2943-7477-98b2-2eadc2c3abd3",
  // 팁/그립 (cafe24-cat-274)
  pcat_01KT8J0ZNMNETKYMHXJEX0XBMW: "019df04d-4f7a-72f7-b231-63fb3639946e",
  // 머신 (cafe24-cat-275)
  pcat_01KT8J0ZQ7MT9FMCHW7WHSKMCV: "019df04f-8224-778c-8321-977e5b7dce1a",
  // 서플라이 (cafe24-cat-276)
  pcat_01KT8J1138ENE3NE3G7VPYZ1M1: "019df03c-22a2-7053-96b8-c4b9547a3064",
  // 부자재 (cafe24-cat-277)
  pcat_01KT8J0YPWWX42035SPDBTJ378: "019df04e-0465-785c-bcdd-2243b6196e92",
  // 피부미용 (cafe24-cat-278)
  pcat_01KT8J0YG1NWJXZ4M9MT7R7PS0: "019df04e-08b9-7331-9a4c-1a3f262c90cd",
  // 스킨플래닝 (cafe24-cat-279)
  pcat_01KT8J0YWEPG8N9TASWQK6DE0D: "019df04d-f93f-7d10-993c-a5c1669bec35",
  // 네일아트 (cafe24-cat-28)
  pcat_01KT8J0Y04B5MTMRRTYQHVE6A1: "019df04d-f521-7c5e-bf29-4d137a5e666d",
  // 패디플래닝 (cafe24-cat-280)
  pcat_01KT8J0YXPNSRWAXJ4RMDMSXEQ: "019df04d-bf4b-75b1-8d8c-51a32448c68e",
  // 화장품 (cafe24-cat-281)
  pcat_01KT8J10711W64F6WTKXC4RV33: "019df045-4727-7938-8c42-0bbe4c321b92",
  // 미용기기 (cafe24-cat-282)
  pcat_01KT8J11PCP66S9ECPJ6BV65RX: "019df004-cb83-7692-8676-b6f79c3bacfd",
  // 기타소품 (cafe24-cat-283)
  pcat_01KT8J0YVDDKZPYNYXZ6E183YT: "019df04d-e960-79b8-b9c7-dd506e1297c7",
  // 팩&모델링팩 (cafe24-cat-284)
  pcat_01KT8J0ZBMC39HYV4BB79R300K: "019df04d-aa35-7775-a011-70e0e9224308",
  // 가방 (cafe24-cat-289)
  pcat_01KT8J10EQMBSP9NVQBWN53K1K: "019df041-164b-7d5a-a1b3-7090991a1df5",
  // 미용기기 (cafe24-cat-290)
  pcat_01KT8J11MEV1ZWE4P9NMDCB0TQ: "019df008-6c55-7d55-aa2e-565206071376",
  // 마케팅 (cafe24-cat-299)
  pcat_01KT8J11VQ7MKA1MVMHZBD4B7N: "019df004-f559-7872-a913-2baa855a60f4",
  // 퍼마블렌드 (cafe24-cat-339)
  pcat_01KT8J0YBKE1JM0WGV5K0K9197: "019df04f-95c1-70ae-9766-1a07783f2175",
  // 고무판 (cafe24-cat-340)
  pcat_01KT8J0ZP3N0E82PR9A4VB930S: "019df04d-43ce-7bd2-9f0a-82cc307cc525",
  // 캔바 디자인 (cafe24-cat-345)
  pcat_01KT8J0YQ6T50DP2NJBKPRC43C: "019df04e-0303-7d33-a92b-3a128f647026",
  // 헤어 (cafe24-cat-347)
  pcat_01KT8J0YK9NGQD5X5EMC0B2ZGR: "019df04d-efae-7130-abd8-aff4d30d904f",
  // 뷰티 소품 (cafe24-cat-351)
  pcat_01KT8J0YNPS41Y0RFVNDEQE3D9: "019df04d-ee3e-70f4-890f-244c340a141f",
  // 메이크업 브러쉬 (cafe24-cat-352)
  pcat_01KT8J0Y2RD7YZAMEZGGFDC8B0: "019df04a-67d7-75eb-a522-fa099846bd40",
  // 색조 메이크업 (cafe24-cat-353)
  pcat_01KT8J0ZMCZHXFXF33AHHRS49X: "019df04d-5305-75e7-a606-9ba8c9733843",
  // 페이스 메이크업 (cafe24-cat-354)
  pcat_01KT8J116RFM9032AK5TTBS2S2: "019df030-13ab-70a7-85e7-e89cee6551f5",
  // 아이 메이크업 (cafe24-cat-355)
  pcat_01KT8J0ZMRTBEZVWVBX7K93ADS: "019df04d-5305-75e7-a606-9ba8c9733843",
  // 립 메이크업 (cafe24-cat-356)
  pcat_01KT8J1045TK0HCZ6HTXTW678J: "019df045-5c4e-702b-bf17-5532ceb7e93e",
  // 페이스 브러쉬 (cafe24-cat-357)
  pcat_01KT8J108N39BZRD915CH6V4NT: "019df044-f7b9-7f88-9865-2a0a40488c9c",
  // 아이 브러쉬 (cafe24-cat-358)
  pcat_01KT8J0Y39BFYFGMCHX3835V1A: "019df04a-67d7-75eb-a522-fa099846bd40",
  // 섀도우 브러쉬 (cafe24-cat-359)
  pcat_01KT8J0Y3RZ7ERRFAQTF0Y5PSN: "019df04a-67d7-75eb-a522-fa099846bd40",
  // 아이브로우 브러쉬 (cafe24-cat-360)
  pcat_01KT8J1181070D3DV2V30GSF1V: "019df02f-75c0-7d0e-a5e6-2c4366a17e24",
  // 파운데이션 브러쉬 (cafe24-cat-361)
  pcat_01KT8J1091KV260GWXQ00CKV5N: "019df044-f7b9-7f88-9865-2a0a40488c9c",
  // 컨실러 브러쉬 (cafe24-cat-362)
  pcat_01KT8J10KXYRMFTRMQ05M8V1M2: "019df040-9dd4-784c-a5cf-f356d819e1c6",
  // 블러셔, 쉐이딩 브러쉬 (cafe24-cat-363)
  pcat_01KT8J118T76ZHRBQZY230FBK3: "019df02f-09ec-71de-a61c-5f91048e08fc",
  // 립 브러쉬 (cafe24-cat-364)
  pcat_01KT8J10M9NG4KKG3W329VBED9: "019df040-9dd4-784c-a5cf-f356d819e1c6",
  // 속눈썹 브러쉬 (cafe24-cat-365)
  pcat_01KT8J0ZKA8WYWRWTFRX83BDKZ: "019df04d-557b-7128-9ef5-3870f45e0dc4",
  // 브러쉬 세트 (cafe24-cat-366)
  pcat_01KT8J0Y4Z7MGW3QK167628C8A: "019df02a-0d41-71c7-b49e-f65fcd1b8a45",
  // 브러쉬 커버, 케이스 (cafe24-cat-367)
  pcat_01KT8J11PQ28B9Y37XVCZNDWT7: "019df003-449c-7932-a098-881846e24d60",
  // 쿠션 퍼프/라텍스 스펀지 (cafe24-cat-368)
  pcat_01KT8J0ZN64WRNRRP6QFF92N4Q: "019df04d-5082-7de2-a264-e4222a950d15",
  // 파우더 퍼프 (cafe24-cat-369)
  pcat_01KT8J11EH7PX7MP3VPDZDXYDF: "019df029-e7f2-761d-9157-9c88b0997b08",
  // 스파츌라, 파레트 (cafe24-cat-370)
  pcat_01KT8J114WBYKXQYHS8QHEZQ98: "019df03b-1d84-7df8-9f03-85f6ddcb894b",
  // 인조 속눈썹 (cafe24-cat-371)
  pcat_01KT8J0YP3W1CQ5Z6Z06AP3S07: "019df04d-ee3e-70f4-890f-244c340a141f",
  // 일회용품 (cafe24-cat-373)
  pcat_01KT8J106M9DKTCTGMMYW1GGAK: "019df045-4b4c-7d3f-b20a-d08fe5d76ca2",
  // 아이라이너 브러쉬 (cafe24-cat-378)
  pcat_01KT8J11EXDN17NJ76PX3ZJ0DA: "019df028-f1b4-7eb7-9888-60f57af3d69c",
  // 커트 (cafe24-cat-379)
  pcat_01KT8J11G1ZT0PTGF3K5N0HMG9: "019df024-e711-79e9-922e-efade0799b54",
  // 염색/파마 (cafe24-cat-380)
  pcat_01KT8J101Z40ZS1QZEVZER6TRJ: "019df045-658b-7993-bd23-c96532af099a",
  // 업스타일 (cafe24-cat-381)
  pcat_01KT8J104MW6CW1VC8Z8F198TS: "019df045-5cf9-72b2-acd9-0cd6cb98c6f7",
  // 헤어 소품 (cafe24-cat-383)
  pcat_01KT8J0YKXHX072VFFZXXFD50Y: "019df04d-efae-7130-abd8-aff4d30d904f",
  // 장가위 (cafe24-cat-385)
  pcat_01KT8J11SC3QC6A03ME6P6R2MH: "019df036-a5ec-7864-bda5-2509e5c6b0f7",
  // 틴닝가위 (cafe24-cat-386)
  pcat_01KT8J11QMKY5W0MXG294G7HJ0: "019df036-a5ec-7864-bda5-2509e5c6b0f7",
  // 염색 (cafe24-cat-388)
  pcat_01KT8J10NTCCNKBXKJN423W54Q: "019df040-4f9b-70af-9f45-5b8283fab717",
  // 파마 (cafe24-cat-389)
  pcat_01KT8J102BYQH28W7KMEHTG1MP: "019df045-658b-7993-bd23-c96532af099a",
  // 염모제 (cafe24-cat-390)
  pcat_01KT8J118EAQFQF0709NTW2HCK: "019df02f-7292-7598-a2dc-7a36195a607b",
  // 중화 받침대 (cafe24-cat-396)
  pcat_01KT8J10QT4V43XJ6PQKR6F08Y: "019df03f-8390-76ca-86e7-77df92095ecb",
  // 롯드/파지 (cafe24-cat-397)
  pcat_01KT8J102RQEBQS1GAWJPZZWH3: "019df045-658b-7993-bd23-c96532af099a",
  // 헤어 브러쉬 (cafe24-cat-399)
  pcat_01KT8J0YMD90YD76X57QVMFRJH: "019df04d-efae-7130-abd8-aff4d30d904f",
  // 가운/앞치마 (cafe24-cat-400)
  pcat_01KT8J10GDKG4WXAEDQE6TT6Z0: "019df041-2ec6-7ca8-96d2-8ba2da55d14f",
  // 실핀/U핀 (cafe24-cat-401)
  pcat_01KT8J1051SMQ4SB58GSCCRBRY: "019df045-5cf9-72b2-acd9-0cd6cb98c6f7",
  // 핀컬핀/악어 클립 (cafe24-cat-402)
  pcat_01KT8J11DMQMFB0YFM3Q0KPHRM: "019df02a-8888-76f7-89ef-adcee7191fda",
  // 가발망/실망 (cafe24-cat-403)
  pcat_01KT8J11M6XJBHB2VM050ZREKV: "019df009-b098-731f-9bb5-f230264079ba",
  // 머리끈/집게핀 (cafe24-cat-405)
  pcat_01KT8J0ZQXHJCT673SFY6FSFZD: "019df04d-29cb-7010-aa05-c2a7d5543738",
  // 머리끈 (cafe24-cat-406)
  pcat_01KT8J10XB1Y3KJT2P2JT96G6Q: "019df03e-0ce0-7b4f-9e64-069f5561c3ba",
  // 집게핀 (cafe24-cat-407)
  pcat_01KT8J0ZR9CS2EFASQAYK224FK: "019df04d-29cb-7010-aa05-c2a7d5543738",
  // 커트보 (cafe24-cat-408)
  pcat_01KT8J10GVY09C47CEC03EY52H: "019df041-2ec6-7ca8-96d2-8ba2da55d14f",
  // 앞치마 (cafe24-cat-410)
  pcat_01KT8J11P01P5E382NMMTZJEVA: "019df006-a34a-7049-90b3-139f8675343a",
  // 커트빗/클리퍼 빗 (cafe24-cat-411)
  pcat_01KT8J0Z50E5K7G2V5D049ZHPZ: "019df04d-db5c-77db-b7f8-55aa6f6643d9",
  // 꼬리빗 (cafe24-cat-412)
  pcat_01KT8J10Z6NZS3RH4CEJTBJZWC: "019df03d-3f88-742c-98cd-628a3219d04e",
  // 염색빗 (cafe24-cat-413)
  pcat_01KT8J10S1T0FDRYW9NVECP0HH: "019df03e-f7ec-7f9f-b675-874c521bce08",
  // 롤 빗 (cafe24-cat-414)
  pcat_01KT8J0YMXA328KRQBG1QNP367: "019df04d-efae-7130-abd8-aff4d30d904f",
  // 패들 브러쉬 (cafe24-cat-420)
  pcat_01KT8J0ZXEJRHXRGFBZNZ4JX5A: "019df04c-a90e-7693-b7db-00a784ec969c",
  // 기타 미용 (cafe24-cat-421)
  pcat_01KT8J103S7BMA04HN0H30Z4S8: "019df045-5c4e-702b-bf17-5532ceb7e93e",
  // 일회용품 (cafe24-cat-423)
  pcat_01KT8J10AM7Z6HH93BAKJP3775: "019df044-9f15-76c2-b716-53e8536b5ae9",
  // 페이스 쉴드 (cafe24-cat-424)
  pcat_01KT8J10B26BJAADG7C048D5ZM: "019df044-9f15-76c2-b716-53e8536b5ae9",
  // DIY 키트 (cafe24-cat-425)
  pcat_01KT8J1117T7JZRDMA1ZYQCZSH: "019df03c-d57f-787e-b56d-0e7189aa81a6",
  // 분장 (cafe24-cat-426)
  pcat_01KT8J10W67N0QXWBQF44CR7DY: "019df03e-a374-70b1-9d3e-0ce67dcd3087",
  // 페이스/바디페인팅 (cafe24-cat-427)
  pcat_01KT8J11HGSXTPKMNQ50D2E3PT: "019df01d-fc1b-7523-8d0f-510e134b7e23",
  // 라텍스/더마왁스/실리콘 (cafe24-cat-428)
  pcat_01KT8J11CK4XDC8P5TDJZ552B7: "019df02d-a483-7c47-b1d6-946cad517e75",
  // 메이크업 (cafe24-cat-43)
  pcat_01KT8J0Y2BNXM981E5AK81TRXP: "019df04a-67d7-75eb-a522-fa099846bd40",
  // 스티커 (cafe24-cat-432)
  pcat_01KT8J10WZHJSZGEAHDH62B6F3: "019df03e-a374-70b1-9d3e-0ce67dcd3087",
  // 수염 (cafe24-cat-433)
  pcat_01KT8J10ZYBRCET6K3XV3QX9KR: "019df03c-e26e-7bbb-a8df-5d81be41d418",
  // 무대눈썹 (cafe24-cat-434)
  pcat_01KT8J1140SM6DHKVJ3GMRF1D4: "019df03b-9396-771d-85b4-a41a0c2ac3e9",
  // 페이스 페인팅 (cafe24-cat-437)
  pcat_01KT8J11HYHDM09TT10Y57X4ZH: "019df01d-fc1b-7523-8d0f-510e134b7e23",
  // 바디 페인팅 (cafe24-cat-438)
  pcat_01KT8J11JZ0JTXJE72CP4303NP: "019df01d-2de9-7c93-b54b-085980b412ca",
  // 인테리어 (cafe24-cat-44)
  pcat_01KT8J0ZCWXBDKZB4T6ZXPHJ70: "019df04d-8c93-777e-9262-a0d7a8eea3ce",
  // 네일 재료 (cafe24-cat-441)
  pcat_01KT8J0Y0MRET6GGNTGXC7BHNF: "019df04d-f5f5-7677-a718-dfea836fde04",
  // 스톤/ 파츠 (cafe24-cat-442)
  pcat_01KT8J0Y6Y01Q68P2K3V1W4588: "019df04d-f5f5-7677-a718-dfea836fde04",
  // 네일 팁 (cafe24-cat-443)
  pcat_01KT8J0YN91PYFZB2NQKS86DQ9: "019df04d-ee70-781b-8159-291fc0932a33",
  // 드로잉 펜 (cafe24-cat-444)
  pcat_01KT8J114GT628Q8FM57H0ZZN3: "019df03b-6751-7ac3-9437-af1f66b52517",
  // 자개/ 글리터 (cafe24-cat-445)
  pcat_01KT8J0Y14FWG1MX37D423K4CF: "019df04a-67d7-75eb-a522-fa099846bd40",
  // 염색볼/염색빗 (cafe24-cat-446)
  pcat_01KT8J10P7A9AR8WFWZZCCAFT9: "019df040-4f9b-70af-9f45-5b8283fab717",
  // 브러쉬 세척 (cafe24-cat-447)
  pcat_01KT8J10YTV7TWDN5MFMFXEC3Z: "019df03d-47fa-70e5-ad9a-16722dfeffc1",
  // 뷰러 (cafe24-cat-448)
  pcat_01KT8J113M4E3QP6KBS655RMBP: "019df03b-ab4c-769e-87c4-87db4420aef9",
  // 속눈썹 핀셋 (cafe24-cat-449)
  pcat_01KT8J10A70KDZ7DNCJNTN1VM8: "019df044-b0f5-76b7-a58e-fa2e37258fe4",
  // 국가자격증 (cafe24-cat-450)
  pcat_01KT8J0YSQ0HGXQY9AVJYFRJQ5: "019df04d-eb44-7b25-aafd-234e57171ed5",
  // 국가고시 재료 세트 (cafe24-cat-451)
  pcat_01KT8J11C6H63J4MX8V9M48ED1: "019df02d-d178-7c28-a280-65a4600f9e5c",
  // 국가고시 재료 (cafe24-cat-452)
  pcat_01KT8J0YT62GSRDN3PQBVQGPAQ: "019df04d-eb44-7b25-aafd-234e57171ed5",
  // 영양제/강화제/오일/ 크림 (cafe24-cat-453)
  pcat_01KT8J0Z61R14ZSK53XVXY9647: "019df04d-d8a5-7b41-951b-6342b26d6ae7",
  // 리무버/소독제/지혈제 (cafe24-cat-454)
  pcat_01KT8J0ZWXT02A29F4291R53WB: "019df04c-aa53-7325-9862-6ec9280edb4b",
  // 파일/샌딩 (cafe24-cat-455)
  pcat_01KT8J0ZT1G325GN0GS1B679QJ: "019df04d-2341-7fdf-b4c1-9ea727d09a1c",
  // 푸셔/니퍼 (cafe24-cat-456)
  pcat_01KT8J0YV0NPQ43PHYEYEV3M2E: "019df04d-eb44-7b25-aafd-234e57171ed5",
  // 클리퍼/팁커터 (cafe24-cat-457)
  pcat_01KT8J10K68SZ41B282FQCEDN2: "019df042-cab2-7857-8a4e-a85820d5da18",
  // 더스트브러쉬 (cafe24-cat-458)
  pcat_01KT8J105VMGDSWDXWGJKN0D4V: "019df045-7c6d-7575-b966-691b41e606b9",
  // 브러쉬 (cafe24-cat-459)
  pcat_01KT8J0Y21RJANP6JB7XHZ7V94: "019df04a-67d7-75eb-a522-fa099846bd40",
  // 핀셋 (cafe24-cat-460)
  pcat_01KT8J1089C825Q3Z3G6T44QZ2: "019df044-fd11-77e1-a19a-f49afb12a2a0",
  // 글루/ 글루 드라이어 (cafe24-cat-461)
  pcat_01KT8J10SJER1D8J235HE5Q0TW: "019df03e-f438-733c-bd63-1b78f21aa9c3",
  // 실크/ 필러파우더/ 가위 (cafe24-cat-462)
  pcat_01KT8J0ZW5WJSM51C3G32GREST: "019df04c-e900-780a-b6cf-554861dafc4f",
  // 젤 연장 (cafe24-cat-463)
  pcat_01KT8J10ZK8WSBV2JH0RY2Z6MP: "019df03d-0a7e-702b-817e-b7fd2f3dccd2",
  // 아크릴 (cafe24-cat-464)
  pcat_01KT8J1002PZQHBZ6AT9XGZ6QM: "019df045-7af2-7ddf-b642-2c29b834c6d4",
  // 부자재 (cafe24-cat-465)
  pcat_01KT8J0ZH19STBV6S4DCNQ1J74: "019df04d-631f-7e97-9478-e403aca44bf9",
  // 팁스탠드/ 인조손 (cafe24-cat-466)
  pcat_01KT8J0ZYMJTF3JKFDSHAYJQN2: "019df04c-a1c8-7227-8bc2-d4430e65ec93",
  // 진열/ 컬러차트 (cafe24-cat-467)
  pcat_01KT8J101M2CT8GDA7TRB4QSG7: "019df045-81b2-71c2-89a2-69339c296c89",
  // 스틱/ 솜 (cafe24-cat-468)
  pcat_01KT8J0ZHECPHSF8GS0PFF2ESP: "019df04d-631f-7e97-9478-e403aca44bf9",
  // 멘다/ 공병 (cafe24-cat-469)
  pcat_01KT8J10HHVYTX0G5EZ6WXE0DJ: "019df040-f8e8-7daf-8114-76f8abca86fc",
  // 트레이/ 화일통 (cafe24-cat-470)
  pcat_01KT8J110C4TT7C8ADSDHR8EYG: "019df03d-2f98-7ae1-85ee-bf8c54d02120",
  // 네일 피커 (cafe24-cat-471)
  pcat_01KT8J107S9HJ8GZZ14QENFBGV: "019df044-fd11-77e1-a19a-f49afb12a2a0",
  // 핑거볼/세퍼레이터 (cafe24-cat-472)
  pcat_01KT8J11KB98W5H09BW3NAAV5Q: "019df00c-897f-7c5b-9657-3bb0dabde7e8",
  // 국가자격증 (cafe24-cat-476)
  pcat_01KT8J0Z0QQEPR1Y5NJV32R9GZ: "019df04d-b882-74e8-8d4c-103316c16323",
  // 국가자격증 세트 (cafe24-cat-477)
  pcat_01KT8J0Z13ME5ZD9W9PN3YQ1FF: "019df04d-b882-74e8-8d4c-103316c16323",
  // 국가자격증 재료 (cafe24-cat-478)
  pcat_01KT8J0Z1FES7QSJW3EBB1A7TN: "019df04d-b882-74e8-8d4c-103316c16323",
  // 국가자격증 (cafe24-cat-479)
  pcat_01KT8J0Z43JFJRAFWGWDWNERD4: "019df04d-db5c-77db-b7f8-55aa6f6643d9",
  // 국가자격증 재료 (cafe24-cat-481)
  pcat_01KT8J0Z4FE4BE3AYF8DHGS5PA: "019df04d-db5c-77db-b7f8-55aa6f6643d9",
  // 가발 (cafe24-cat-482)
  pcat_01KT8J10Y1413316YJG31CHN1M: "019df03d-6d52-7771-aaaf-9fba2571987e",
  // 덧가발 (cafe24-cat-484)
  pcat_01KT8J1129039CSRAKABFFJX2Q: "019df04c-53a9-79c2-bfed-28bdfbdfb8a5",
  // 통가발 (cafe24-cat-485)
  pcat_01KT8J10YDT48264GPHK2KG50Z: "019df03d-6d52-7771-aaaf-9fba2571987e",
  // 분장 소품 (cafe24-cat-486)
  pcat_01KT8J10WHSVZJVGSF5DFBZ12X: "019df03e-a374-70b1-9d3e-0ce67dcd3087",
  // 드라이기 (cafe24-cat-488)
  pcat_01KT8J1171CNEC2FX2MX2QN0MG: "019df02f-f09b-7ad8-ba0e-bbf50938a328",
  // 매직기/판고데기 (cafe24-cat-489)
  pcat_01KT8J11MQW7PVYNPTZNN5GZW4: "019df008-4884-75a7-b05e-973956fa58a3",
  // 분무기 (cafe24-cat-493)
  pcat_01KT8J11D8HRVPD32N6PG5DWEH: "019df02b-7357-75ca-8860-0301631c8590",
  // 노몬드 (cafe24-cat-495)
  pcat_01KT8J0ZPDR31T56CD8FZMN5ES: "019df04d-3e77-7d21-96f7-f42db807ae09",
  // 묶고 더블로 가 (cafe24-cat-497)
  pcat_01KT8J0ZB53M35ZBX381H85DTM: "019df04d-accb-75fa-801b-76e19f08fcc0",
  // 100원 웰컴딜 (cafe24-cat-498)
  pcat_01KT8J0Z844049TQST51VJ8MC3: "019df04d-a0d6-708c-89db-4ffa3d934543",
  // 전체상품 보기 (cafe24-cat-499)
  pcat_01KT8J0XYKDAHR5REZRTNDJKBP: "019df04d-f521-7c5e-bf29-4d137a5e666d",
  // 속눈썹 열펌 (cafe24-cat-501)
  pcat_01KT8J10SV0G6FN24MK690BB4B: "019df03f-0191-7541-a92f-93471bd79dae",
  // 반하다 롯드 (cafe24-cat-502)
  pcat_01KT8J10G1RM8MHFXXE7ESJ8Y9: "019df041-1367-750d-ace8-df6cfe4f759b",
  // 누누뷰티 (cafe24-cat-503)
  pcat_01KT8J0Z339BZ55FP0JQ6694WX: "019df04d-b4b0-7a5e-b299-e768ec68bbf0",
  // 인레이 (cafe24-cat-504)
  pcat_01KT8J0Z091CNK0EED57C068AM: "019df04d-b93d-76a1-b871-9f47129fc0ea",
  // 에루샤 (cafe24-cat-505)
  pcat_01KT8J11GAA7HB5VVZWBH10HSP: "019df023-3526-785f-8a84-161bbc60e71c",
  // 래쉬업 (cafe24-cat-506)
  pcat_01KT8J0ZKKDYBW5FNAB7J6TVAK: "019df04d-69c5-7156-a9c0-ce7176b7c8ab",
  // 래쉬홀릭 (cafe24-cat-507)
  pcat_01KT8J0ZDMMNDENZXJZHF66KZJ: "019df04d-8ba6-7e05-944f-080ad0b9176d",
  // 루가래쉬 (cafe24-cat-508)
  pcat_01KT8J0XXW06444HD2MT72F577: "019df03e-5da4-7019-8fb9-5095b3acb89d",
  // 비투스 핀셋 (cafe24-cat-509)
  pcat_01KT8J10BRAM50R04DH3A0B5GF: "019df049-62eb-746a-ae92-e633c997b162",
  // 래쉬몬스터 (cafe24-cat-510)
  pcat_01KT8J10RNQPSSA2MF5EBT37B2: "019df03f-3c44-7ac2-974d-5ef1581af512",
  // 마르시아 (cafe24-cat-513)
  pcat_01KT8J10PZ1R65YHTWQCAETD3Q: "019df03f-8306-7695-b48a-f9a2b111ea44",
  // 임뷰티 (cafe24-cat-514)
  pcat_01KT8J0YSBHM8X35WZ7MVXC04C: "019df04f-8639-7f65-a1ae-be4fb70ecfd8",
  // 베럴왁싱 (cafe24-cat-516)
  pcat_01KT8J10KGMM9DWQ0GD7ZYZS13: "019df040-cc73-7e18-8301-f75972faa75f",
  // 트위지스트랩 (cafe24-cat-517)
  pcat_01KT8J0YYQ3RZPZDGP45DTJM3Q: "019df04d-bc56-74f2-8895-b888bb7a7831",
  // 제이앤코 (cafe24-cat-518)
  pcat_01KT8J1031NNPMQJ8RJQCVJ8DC: "019df045-7280-7224-832c-e9cf65f0a68d",
  // 이탈왁스 (cafe24-cat-519)
  pcat_01KT8J0YJHW67PTFVN93QYTM69: "019df04f-8cac-742d-8599-f1c9eda8dd6c",
  // 라프랑스 (cafe24-cat-520)
  pcat_01KT8J0Z7A2C9G65CWY13CPWYM: "019df04d-e38f-75ca-8faf-fa3cead6b40d",
  // 비즈니스 (cafe24-cat-521)
  pcat_01KT8J0YQTBPH8S5REFM77FGWE: "019df04e-0303-7d33-a92b-3a128f647026",
  // 마케팅 (cafe24-cat-522)
  pcat_01KT8J11R4T2MVK9BDR6EJ6P8S: "019df045-df74-7968-a4f8-68f694fdf714",
  // 클래스 (cafe24-cat-523)
  pcat_01KT8J0ZHT4JYV5RDPW3FA8JB4: "019df04d-70d7-762d-aca2-f6d9e074872b",
  // 브랜딩 (cafe24-cat-524)
  pcat_01KT8J0YR83JEBBJNFFX4BKSY9: "019df04e-01d1-71bd-be7a-c8beaa6250e7",
  // 루가색소 (cafe24-cat-525)
  pcat_01KT8J117908CZW1M8MFFMHMXN: "019df02f-a446-73e5-be42-0a798ee02855",
  // 타사와라 (cafe24-cat-527)
  pcat_01KT8J0ZQGVRTV569ZTVZVQAKH: "019df04d-46c8-7d2e-a672-a45e8920f85f",
  // 클레오 (cafe24-cat-528)
  pcat_01KT8J11TA6NK63WWGEWKGC8VQ: "019df031-ea50-784f-8a3b-0ddd12454b3f",
  // LED/UV 연장 (cafe24-cat-529)
  pcat_01KT8J10VTW0DPC884W6JZ0T1X: "019df03e-af14-7aca-bd1f-46f9b1ac2aeb",
  // 패션 (cafe24-cat-530)
  pcat_01KT8J0ZDY7Q8CTP9856VHY232: "019df04d-96e0-79e4-90f1-395d0d705e0b",
  // 주얼리 (cafe24-cat-531)
  pcat_01KT8J10QBT7384BC0R6WXBF2C: "019df03f-98f9-7ad1-bcc9-eab18aa67448",
  // 의류 (cafe24-cat-532)
  pcat_01KT8J11TQMDFXPWGHHZYFHMW8: "019df031-a428-7f16-80b3-459baeb25f1b",
  // 서비스 (cafe24-cat-533)
  pcat_01KT8J11SNQ2CK6ZAYYMH4S0KX: "019df034-39f5-7164-91f7-57b930f6d515",
  // 국가자격증 (cafe24-cat-535)
  pcat_01KT8J0ZJJ7Z3Q104KQJ76FAYD: "019df006-2f50-761e-8546-017190e2677c",
  // 네일 젤 브랜드 (cafe24-cat-59)
  pcat_01KT8J0Y62GR8XDWQ942PBEFTW: "019df04d-f521-7c5e-bf29-4d137a5e666d",
  // MAST 마스트 (cafe24-cat-594)
  pcat_01KT8J0ZRK786XJNZ3GSQQDC0D: "019df04f-8224-778c-8321-977e5b7dce1a",
  // 인쇄물 (cafe24-cat-595)
  pcat_01KT8J0YHC9RB1YAM9FEZZ4M2Z: "019df04e-0517-7de6-a81c-b1c9d153fc58",
  // 메뉴판 (cafe24-cat-596)
  pcat_01KT8J11GR9T0YCJFYPS20KP9P: "019df023-31ed-718c-90db-7ffeef096451",
  // 주의사항 (cafe24-cat-597)
  pcat_01KT8J10E9KP6JQBJ730EGVW9J: "019df043-0e81-77aa-8bed-ac437b914145",
  // 미니배너 (cafe24-cat-598)
  pcat_01KT8J0ZAC5RX51T1QZ78R48T9: "019df04d-9fa3-7628-a002-955fd7c222ac",
  // 배너&입간판 (cafe24-cat-599)
  pcat_01KT8J0YHRBRV7V6FKHCDQA80W: "019df04e-0517-7de6-a81c-b1c9d153fc58",
  // 네일 케어 (cafe24-cat-60)
  pcat_01KT8J0YTKA82S27NHXBM4FVNC: "019df04d-eb44-7b25-aafd-234e57171ed5",
  // 스티커 (cafe24-cat-601)
  pcat_01KT8J11S0WETD2P4AS9CGE5D6: "019df037-ede3-78b4-acc5-9683f3ef0a93",
  // 디플로마 (cafe24-cat-603)
  pcat_01KT8J0ZPTYWNMBP75QT824P5N: "019df04d-2fbe-70ee-912a-654e7b5e9375",
  // 기타 (cafe24-cat-604)
  pcat_01KT8J11H5723EHQ9YS36AQEZN: "019df023-28ff-7ef4-8297-07302b402790",
  // 사각 스티커 (cafe24-cat-605)
  pcat_01KT8J11VDRDKKGNKWCHXP4HW7: "019df030-533e-7d0a-a684-72899c7acb8f",
  // 도무송 스티커 (cafe24-cat-606)
  pcat_01KT8J11W3TC7RNZW33ZX2PVY0: "019df04d-c209-7f8e-99ec-ace3a01d37b5",
  // 일반 명함 (cafe24-cat-608)
  pcat_01KT8J11X2WT3Q611XXXSSYZW3: "019df03a-9134-7971-a08f-a205d336108b",
  // 특수지 명함 (cafe24-cat-609)
  pcat_01KT8J11WSGPZFCCR0HDDQ0N0V: "019df041-15c4-77b1-9f0b-ebb519c7e972",
  // 프리미엄 명함 (cafe24-cat-611)
  pcat_01KT8J11FJWNF0RQW2PG1ZBGK1: "019df027-a70a-7d01-92d7-da8c79867b80",
  // 후가공 명함 (cafe24-cat-612)
  pcat_01KT8J11WF96Y0CNM0QX4MD7XZ: "019df044-92b4-7ad1-9ca2-16902707e656",
  // 세트 (cafe24-cat-616)
  pcat_01KT8J11F9X9KSPGW5049GM3VA: "019df028-2f85-791f-bc2f-4525461b7904",
  // 샵 간편식 (cafe24-cat-618)
  pcat_01KT8J0Z8XVAYFQ8EF965GSTWM: "019df04d-9d15-7012-8aa2-cf8c15793d0e",
  // 오직미 (cafe24-cat-619)
  pcat_01KT8J0Z9BS5VQ0T04DNHAJTPJ: "019df04d-9d15-7012-8aa2-cf8c15793d0e",
  // 네일 도구 (cafe24-cat-62)
  pcat_01KT8J0Y1J4CBM4QAM8243FTF8: "019df04a-67d7-75eb-a522-fa099846bd40",
  // 스티커 (cafe24-cat-621)
  pcat_01KT8J0ZFZY9ZT7RACFD6SVT8M: "019df04d-a4c7-70ba-8db5-ac75e16a30f8",
  // 전동 기기 (cafe24-cat-622)
  pcat_01KT8J0ZTVS4GWXE248F62XED8: "019df04d-2085-75b1-a9cf-744046abbb5e",
  // 램프 (cafe24-cat-623)
  pcat_01KT8J0ZV7P1PFHB5ESFH340VN: "019df04d-2085-75b1-a9cf-744046abbb5e",
  // 드릴 (cafe24-cat-624)
  pcat_01KT8J0ZXT668Z1FQDHJNVPSCX: "019df04c-dbfe-77b2-8ff9-cccd9737ce47",
  // 흡진기 (cafe24-cat-625)
  pcat_01KT8J10TJTCHJYP8MNJATNM6Q: "019df005-fb7c-77ee-aaf2-b030be0d64db",
  // 비트 (cafe24-cat-626)
  pcat_01KT8J10MN2KRPF7856KD237V3: "019df040-8883-7fb2-a503-f31207a887f3",
  // 그라시아 (cafe24-cat-627)
  pcat_01KT8J105DVN2Z0BXYXFJN93HD: "019df045-7dbe-77cc-b263-2d713a642489",
  // 프롬 더 네일 (cafe24-cat-628)
  pcat_01KT8J0YEC3EAQX894NR4C0QP4: "019df04e-1eb8-70cb-a2d8-4e3f5af666c5",
  // 스윗온 (cafe24-cat-630)
  pcat_01KT8J115X37X2GYQRJZFJRY1A: "019df03a-d64a-7964-ba39-b394168e81ac",
  // 루벤스 (cafe24-cat-631)
  pcat_01KT8J10C740DYMBG6E5Z7HE5C: "019df043-2317-75a7-8e54-3ed0745b9ee7",
  // 오페라 (cafe24-cat-632)
  pcat_01KT8J0ZTFRQJ77NTEM9TRN4T0: "019df04d-2085-75b1-a9cf-744046abbb5e",
  // 뷰닉스 (cafe24-cat-633)
  pcat_01KT8J109D3ZJ6SP56ZQPV17WN: "019df045-4278-7198-b290-b3ede33f6bfc",
  // 아쁘레쑤 (cafe24-cat-634)
  pcat_01KT8J0ZSGR6TD2EZTDERYQ1XK: "019df04d-0fe2-7a1d-84c4-39055d97e17c",
  // 씨씨 (cafe24-cat-635)
  pcat_01KT8J10TZH85FWB3F94GC1QWZ: "019df03d-47ac-78cb-bc23-c87e6ee6bf62",
  // 모스티브 (cafe24-cat-636)
  pcat_01KT8J0YJ8BNPKQB14JFDX5DYE: "019df04f-8f0c-7e17-bbf2-856855d93e7c",
  // 더젤 (cafe24-cat-637)
  pcat_01KT8J0Z5D5KWAWSJJWT08RTF1: "019df04d-db06-7426-afb7-7186f084b4ef",
  // 앞치마 (cafe24-cat-638)
  pcat_01KT8J0ZEBJVX06Y57TE6T2F0E: "019df04d-96e0-79e4-90f1-395d0d705e0b",
  // 원피스 앞치마 (cafe24-cat-639)
  pcat_01KT8J0ZF899ZRWVDK6PXCZ1NW: "019df04d-96e0-79e4-90f1-395d0d705e0b",
  // X형H형 앞치마 (cafe24-cat-640)
  pcat_01KT8J103DR0NTZ9VR9HFMP705: "019df045-5e84-770f-b08a-1da20cf49f61",
  // 방수 앞치마 (cafe24-cat-641)
  pcat_01KT8J0ZESHEMV151WY8XFNXZZ: "019df04d-96e0-79e4-90f1-395d0d705e0b",
  // 멜빵 앞치마 (cafe24-cat-642)
  pcat_01KT8J10ND8M5XDWHEW8KZE8S0: "019df040-79ce-7062-970d-7bddf30f7d2f",
  // 젤로젤로 (cafe24-cat-643)
  pcat_01KT8J0Z2QQEH05BAQ8ER1HVZJ: "019df04d-c4d3-7623-9ceb-5c189f68de87",
  // 샴푸 (cafe24-cat-651)
  pcat_01KT8J11NK6C74QG6CBKF6VXNW: "019df006-c978-754e-b546-48ea01cd1167",
  // 모어젤 (cafe24-cat-652)
  pcat_01KT8J0Z1WVVWQHTK4HBW7AKN0: "019df04d-b7ed-79fc-bead-4259026dcdf2",
  // 디젤 (cafe24-cat-653)
  pcat_01KT8J0YRMSTWB3AKPSPZ2KQ59: "019df04d-fd2f-7d2d-ad1a-67ae053fe04e",
  // 메이유어 (cafe24-cat-654)
  pcat_01KT8J0YWY7H094ETKKFQEVQA7: "019df04d-f962-71df-897b-18e58e5476df",
  // 요고마요 (cafe24-cat-655)
  pcat_01KT8J0ZCJVPRCT8K142N7A03T: "019df04d-8d95-711a-879b-7b42d1a09414",
  // 요거트젤 (cafe24-cat-656)
  pcat_01KT8J0YFNR7V5K6KTR4WG0Z1A: "019df04e-090e-79d9-9c08-4bc37c88e148",
  // 다이아미 (cafe24-cat-657)
  pcat_01KT8J0YAX902QBCV85VVWPE2D: "019df04f-9721-7592-b6e6-6ad8f375082d",
  // 키스뉴욕 (cafe24-cat-658)
  pcat_01KT8J11A5DE9WE6GFGM821AMV: "019df02e-a91d-7ecd-9ce4-d59b3926c58d",
  // 바이뮤즈 (cafe24-cat-660)
  pcat_01KT8J0ZZ0MRVQXHJMWE46Y7Q8: "019df04c-7d90-70ed-abd8-7a12b04dc00b",
  // 띵크 오브 네일 (cafe24-cat-665)
  pcat_01KT8J11B5Q2JJK0H5AC9D9Z77: "019df02e-a081-7942-8a3a-67f75b0fda49",
  // 유니코 (cafe24-cat-667)
  pcat_01KT8J11RHRD3C1XD6S6AFJESN: "019df045-b871-74e7-b3d7-6305b46093d6",
  // 비블라 (cafe24-cat-669)
  pcat_01KT8J0YVSYE8949CCEJ7SJW9W: "019df02a-321f-7649-add3-d55fe0a4ad20",
  // 가구 (cafe24-cat-67)
  pcat_01KT8J10N1P36A4KMFBKEBY39F: "019df040-834f-700a-b9ac-1da0d116cf78",
  // 뷰젤 (cafe24-cat-670)
  pcat_01KT8J0ZJ6WPCE06H24JMM17A1: "019df04d-7c3d-73da-85bb-d40f56f1ffb1",
  // 세체 (cafe24-cat-671)
  pcat_01KT8J10PPJMFRCFG8T71DHMFB: "019df040-4a81-72b7-9b58-a7c60cc96def",
  // 켄지코 (cafe24-cat-672)
  pcat_01KT8J11KS4TFS2782R1GR8EJJ: "019df00a-bc5e-7ef3-b1f6-acbeabb689fb",
  // 베씨 (cafe24-cat-675)
  pcat_01KT8J0ZZBJRM5WW8SKBAHR7RY: "019df04c-7aed-7250-9517-d309caea9405",
  // 빅사이즈 (cafe24-cat-676)
  pcat_01KT8J11T02XCMGB28FST92T32: "019df034-0885-7f90-9a25-06a2bb9bbf71",
  // 화홍 (cafe24-cat-678)
  pcat_01KT8J0Z8MW21M902XVTHC5BTG: "019df037-f636-7f3a-8866-5b79ed7228a2",
  // 소품 (cafe24-cat-68)
  pcat_01KT8J0ZD9W1VN33RNA0C9J9CZ: "019df04d-8c93-777e-9262-a0d7a8eea3ce",
  // 퍼스트스트릿 (cafe24-cat-685)
  pcat_01KT8J0Y6G0328RZAVDMX740Q0: "019df04d-f521-7c5e-bf29-4d137a5e666d",
  // 케미젤 (cafe24-cat-686)
  pcat_01KT8J111XZH8010VA98JC06EQ: "019df03c-961e-7f85-a3f1-4a7a7e04f49b",
  // 엔리안 (cafe24-cat-687)
  pcat_01KT8J10DCZ4SB5EC76MYJHWZ4: "019df041-7a51-7906-a263-7d98e1522f7f",
  // 하모니 (cafe24-cat-688)
  pcat_01KT8J0YY2G65ZV4ABCANQE7VD: "019df04d-ca70-75e1-8aae-55af723b11bc",
  // 메모리 (cafe24-cat-689)
  pcat_01KT8J11Q3HA3J8QK38CBMX9E7: "019df003-03d0-7c0c-b6f3-3cdaf293d78e",
  // 캣워크 (cafe24-cat-691)
  pcat_01KT8J117N8JFJP9Z8WFSQ0PGN: "019df02f-b590-78af-8f3e-ce7041237d2c",
  // 파셋 (cafe24-cat-692)
  pcat_01KT8J0YJZFX4S2A0DEGN3Y7B7: "019df04f-87ea-7111-aff1-154e42f5603d",
  // 유즈미 (cafe24-cat-693)
  pcat_01KT8J0ZVPH4B98HECP7DY0079: "019df04c-cdec-7ebd-a793-22fca5bb3334",
  // 베드 (cafe24-cat-70)
  pcat_01KT8J11V2DJVD192G44HCAWMX: "019df031-7da7-7f31-bb0d-12fff901a38e",
  // 발라젤 (cafe24-cat-701)
  pcat_01KT8J0Y7T6EJBAXKQ4N0A4Q5B: "019df04d-f433-785b-b254-e3fe47f9d51f",
  // 젤앤젤 (cafe24-cat-703)
  pcat_01KT8J0YCZ5ZTDMPTJF1Z9GPAG: "019df04f-942f-7ee9-a998-39eb044b1125",
  // 로지힙 (cafe24-cat-704)
  pcat_01KT8J0YYEQDWKFA2G8DW6S9AR: "019df04d-ca4f-72a8-b1a6-5a6ab97e7980",
  // 수짜젤 (cafe24-cat-705)
  pcat_01KT8J0ZRZWETVT3F5Y1J4V5QY: "019df04c-fad8-7d70-a8f9-de9c04f2aa13",
  // 미고딕 (cafe24-cat-706)
  pcat_01KT8J0YZGP5X0PS3AP12ZT34E: "019df04d-c9ca-78fa-9ca3-857c3e4a7423",
  // 미라클 (cafe24-cat-707)
  pcat_01KT8J10T7ZQ0AF5KNJKHTN5G6: "019df005-fb7c-77ee-aaf2-b030be0d64db",
  // 블루크로스 (cafe24-cat-708)
  pcat_01KT8J0ZWG13NFE0BA269ZM9EQ: "019df04c-aa53-7325-9862-6ec9280edb4b",
  // 디보크 (cafe24-cat-709)
  pcat_01KT8J0YX9EJPBRP0N7W5BDZ1K: "019df04e-21d8-783e-be3d-e1f19ef9a7f3",
  // 웨건&트롤리&카트 (cafe24-cat-71)
  pcat_01KT8J110VGCN1VM1X40JVC6RZ: "019df03d-2f98-7ae1-85ee-bf8c54d02120",
  // 캔디젤 (cafe24-cat-710)
  pcat_01KT8J0Z005N43R2YYX6B326K3: "019df04d-bbb7-7853-8851-cb1216d6230a",
  // 캣츠미 (cafe24-cat-711)
  pcat_01KT8J0ZKZ36FEWWWRA6XYN4E8: "019df04d-73aa-7afa-8c14-4356f64e0e22",
  // 블랑드블루 (cafe24-cat-713)
  pcat_01KT8J0YA13BTK2CVPRNA8WVXD: "019df04f-97ad-7282-82ea-b87bb594eab9",
  // 피오떼 (cafe24-cat-719)
  pcat_01KT8J0YF7VR7PZPXNPH6YBNK3: "019df04e-1ea6-7343-9967-6483a85040c5",
  // 베리굿네일 (cafe24-cat-720)
  pcat_01KT8J0YS1ZB9J01N3PBBJTEVW: "019df04f-8987-72ed-9863-1641ef7ee127",
  // 아우라글리터 (cafe24-cat-722)
  pcat_01KT8J100ETAQ8ZDB3HDW4VX8H: "019df045-6b6c-75a4-a743-447585f37a2f",
  // 멀티탭 (cafe24-cat-727)
  pcat_01KT8J10CZS99R3QDS27D78DEH: "019df041-7502-7073-aa4f-961853ac04df",
  // 속눈썹펌 롯드 추천관 (cafe24-cat-736)
  pcat_01KT8J1155RF3QAJQAQVCGY1VT: "019df03b-561e-724b-8ece-9efd8422b7d2",
  // 연장 글루 추천관 (cafe24-cat-737)
  pcat_01KT8J11E389MC3SVZQ0ETXAQ8: "019df02a-7d5c-7b71-9422-b2b563417b82",
  // 캐릭터 땅콩 브러쉬 모음전 (cafe24-cat-738)
  pcat_01KT8J0ZZMAV5368Y6VGQS7GN3: "019df045-6f83-7222-a98d-61cf7c4f2f30",
  // 속눈썹 영양제 추천관 (cafe24-cat-739)
  pcat_01KT8J111FZ3NJ371N01KQMSBN: "019df03c-9de6-78bb-a977-e0ac59a0edd2",
  // 신상 (cafe24-cat-81)
  pcat_01KT8J0XZSFXT52B58MJ114A1T: "019df04f-8224-778c-8321-977e5b7dce1a",
  // 베스트 (cafe24-cat-82)
  pcat_01KT8J0YW2E6R0W2CN3NQFZEPQ: "019df04d-f93f-7d10-993c-a5c1669bec35",
  // 클래스 (cafe24-cat-86)
  pcat_01KT8J100QFXNVSSYX8J9B9B5D: "019df045-8325-7534-b1e4-d36f475694a4",
  // 서울 (cafe24-cat-99)
  pcat_01KT8J11971XJZXA5ZTHB4EWKB: "019df02f-136e-7daf-a3c9-66f2565a3f2e",
}
