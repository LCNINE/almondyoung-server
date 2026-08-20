/**
 * 개인정보처리방침 — 개인정보보호법 §30 법정 기재사항 전문.
 *
 * 이 파일은 가입 절차의 "개인정보 수집·이용 동의서"(agreements.json)와 다르다.
 * 동의서는 정보주체에게 동의를 받는 문서, 이 방침은 처리자가 공개하는 문서다.
 */
import type { ReactNode } from "react"

/** 처리방침 시행일. 개정 시 이전 버전 링크와 함께 갱신한다. */
export const PRIVACY_POLICY_EFFECTIVE_DATE = "2026년 8월 11일"

const COLLECTED_ITEMS = [
  {
    scene: "회원가입",
    required: "성명, 아이디, 비밀번호, 휴대전화번호, 이메일 주소, 생년월일",
    optional: "닉네임, 프로필 사진, 관심 카테고리",
  },
  {
    scene: "본인확인",
    required: "휴대전화번호, 통신사 인증 결과",
    optional: "-",
  },
  {
    scene: "주문·배송",
    required: "수령인 성명, 배송지 주소, 연락처, 주문 내역",
    optional: "배송 메모",
  },
  {
    scene: "결제",
    required: "결제수단 정보, 결제 승인·취소 내역",
    optional: "현금영수증 발급 정보",
  },
  {
    scene: "멤버십 자동이체",
    required: "예금주명, 계좌번호, 은행명, 생년월일 또는 사업자등록번호",
    optional: "-",
  },
  {
    scene: "사업자 회원",
    required: "사업자등록번호, 대표자명, 사업자등록증 사본",
    optional: "-",
  },
  {
    scene: "리뷰·문의",
    required: "작성 내용, 첨부 이미지",
    optional: "-",
  },
  {
    scene: "서비스 이용 중 자동 생성",
    required: "접속 IP, 쿠키, 접속 일시, 기기·브라우저 정보",
    optional: "-",
  },
]

const PROCESSORS = [
  {
    name: "CJ대한통운, 한진택배, 롯데택배, 우체국택배",
    task: "주문 상품 배송 및 배송 조회",
    retention: "위탁 계약 종료 시까지",
  },
  {
    name: "토스페이먼츠 주식회사",
    task: "신용카드·계좌이체·가상계좌 결제 처리 및 환불",
    retention: "위탁 계약 종료 시까지",
  },
  {
    name: "주식회사 효성에프엠에스",
    task: "멤버십 정기결제 자동이체(CMS) 출금 및 계좌 실명 확인",
    retention: "위탁 계약 종료 시까지",
  },
  {
    name: "엔에이치엔클라우드 주식회사",
    task: "카카오 알림톡 발송",
    retention: "위탁 계약 종료 시까지",
  },
  {
    name: "아마존웹서비스코리아 유한책임회사",
    task: "서비스 운영을 위한 클라우드 인프라 운영 (국내 서울 리전)",
    retention: "위탁 계약 종료 시까지",
  },
]

const OVERSEAS_TRANSFERS = [
  {
    company: "Resend, Inc.",
    country: "미국",
    contact: "support@resend.com",
    items: "이메일 주소, 성명",
    purpose: "주문·배송·인증 등 서비스 안내 이메일 발송",
    method: "서비스 이용 시점에 정보통신망을 통해 전송",
    retention: "위탁 계약 종료 시 또는 회원 탈퇴 시까지",
  },
  {
    company: "Twilio Inc.",
    country: "미국",
    contact: "privacy@twilio.com",
    items: "휴대전화번호",
    purpose: "인증번호 및 안내 문자(SMS) 발송, 휴대전화번호 유효성 확인",
    method: "서비스 이용 시점에 정보통신망을 통해 전송",
    retention: "위탁 계약 종료 시 또는 회원 탈퇴 시까지",
  },
  {
    company: "Google LLC",
    country: "미국",
    contact: "support.google.com/policies",
    items:
      "쿠키 기반 온라인 식별자, 접속 IP, 기기·브라우저 정보, 페이지 조회 및 상품 조회·장바구니·구매 이벤트",
    purpose: "서비스 이용 통계 분석 및 서비스 개선(Google Analytics 4)",
    method: "서비스 이용 시점에 정보통신망을 통해 전송",
    retention: "수집일로부터 14개월",
  },
]

const LEGAL_RETENTION = [
  { basis: "전자상거래법", target: "계약 또는 청약철회 등에 관한 기록", period: "5년" },
  { basis: "전자상거래법", target: "대금결제 및 재화 등의 공급에 관한 기록", period: "5년" },
  { basis: "전자상거래법", target: "소비자의 불만 또는 분쟁처리에 관한 기록", period: "3년" },
  { basis: "전자상거래법", target: "표시·광고에 관한 기록", period: "6개월" },
  { basis: "전자금융거래법", target: "전자금융거래에 관한 기록", period: "5년" },
  { basis: "통신비밀보호법", target: "서비스 접속 기록(로그)", period: "3개월" },
]

const REMEDY_CHANNELS = [
  { name: "개인정보분쟁조정위원회", tel: "1833-6972", url: "www.kopico.go.kr" },
  { name: "개인정보침해신고센터", tel: "118", url: "privacy.kisa.or.kr" },
  { name: "대검찰청 사이버수사과", tel: "1301", url: "www.spo.go.kr" },
  { name: "경찰청 사이버수사국", tel: "182", url: "ecrm.police.go.kr" },
]

function Article({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mb-10">
      <h2 className="text-foreground mb-3 text-base font-bold">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: string[][]
}) {
  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="bg-muted">
            {headers.map((h) => (
              <th
                key={h}
                className="text-foreground border-border border-b px-3 py-2 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-border [&:not(:last-child)]:border-b">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PrivacyPolicy() {
  return (
    <div>
      <p className="text-muted-foreground mb-10 text-sm leading-relaxed">
        주식회사 엘씨나인(이하 &quot;회사&quot;)은 「개인정보 보호법」 제30조에
        따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게
        처리할 수 있도록 다음과 같이 개인정보처리방침을 수립·공개합니다.
      </p>

      <Article title="제1조 (개인정보의 처리 목적)">
        <p>회사는 다음의 목적으로 개인정보를 처리합니다.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>회원 가입 의사 확인, 본인 식별·인증, 회원자격 유지·관리</li>
          <li>상품 주문·결제, 배송, 반품·교환·환불 처리</li>
          <li>유료 멤버십 가입·정기결제·해지 및 환급 처리</li>
          <li>고객 상담, 불만 처리, 분쟁 조정을 위한 기록 보존</li>
          <li>서비스 이용 관련 고지사항 전달</li>
          <li>부정 이용 방지 및 비인가 사용 확인</li>
          <li>
            신규 서비스 개발, 이벤트·광고성 정보 제공 및 참여 기회 제공(별도
            동의 시)
          </li>
        </ol>
        <p>
          처리 중인 개인정보는 위 목적 이외의 용도로 이용하지 않으며, 목적이
          변경되는 경우에는 「개인정보 보호법」 제18조에 따라 별도의 동의를
          받는 등 필요한 조치를 이행합니다.
        </p>
      </Article>

      <Article title="제2조 (처리하는 개인정보의 항목)">
        <DataTable
          headers={["수집 시점", "필수 항목", "선택 항목"]}
          rows={COLLECTED_ITEMS.map((r) => [r.scene, r.required, r.optional])}
        />
        <p className="pt-2">
          선택 항목에 동의하지 않으셔도 회원가입 및 서비스 이용에 제한은
          없습니다. 다만 해당 항목이 필요한 개별 기능(예: 사업자 회원 전용 상품
          구매)은 이용이 제한될 수 있습니다.
        </p>
      </Article>

      <Article title="제3조 (개인정보의 처리 및 보유 기간)">
        <p>
          회사는 회원 탈퇴 시 지체 없이 개인정보를 파기합니다. 다만 다음 각 호의
          정보는 관계 법령에 따라 아래 기간 동안 보관합니다.
        </p>
        <DataTable
          headers={["근거 법령", "보관 대상", "보관 기간"]}
          rows={LEGAL_RETENTION.map((r) => [r.basis, r.target, r.period])}
        />
        <p className="pt-2">
          법령에 따라 보관하는 정보는 보관 목적으로만 이용하며, 별도의
          데이터베이스로 분리하여 관리합니다.
        </p>
      </Article>

      <Article title="제4조 (개인정보의 제3자 제공)">
        <p>
          회사는 정보주체의 개인정보를 제1조에 명시한 목적 범위 내에서만
          처리하며, 정보주체의 별도 동의, 법률의 특별한 규정 등
          「개인정보 보호법」 제17조 및 제18조에 해당하는 경우에만 제3자에게
          제공합니다.
        </p>
        <p>
          현재 회사는 이벤트·프로모션 협력사에 대한 제공(선택 동의 시)을 제외하고
          정기적으로 개인정보를 제3자에게 제공하고 있지 않습니다. 배송·결제 등
          서비스 제공에 필요한 처리는 제5조의 위탁에 해당합니다.
        </p>
      </Article>

      <Article title="제5조 (개인정보 처리업무의 위탁)">
        <p>
          회사는 원활한 서비스 제공을 위하여 다음과 같이 개인정보 처리업무를
          위탁하고 있습니다.
        </p>
        <DataTable
          headers={["수탁자", "위탁 업무", "보유 기간"]}
          rows={PROCESSORS.map((r) => [r.name, r.task, r.retention])}
        />
        <p className="pt-2">
          회사는 위탁계약 체결 시 개인정보의 안전한 관리를 위하여 위탁업무 수행
          목적 외 개인정보 처리 금지, 기술적·관리적 보호조치, 재위탁 제한,
          수탁자에 대한 관리·감독, 손해배상 등 책임에 관한 사항을 계약서에
          명시하고 수탁자가 개인정보를 안전하게 처리하는지 감독합니다. 위탁
          업무의 내용이나 수탁자가 변경될 경우 본 방침을 통해 공개합니다.
        </p>
      </Article>

      <Article title="제6조 (개인정보의 국외 이전)">
        <p>회사는 다음과 같이 개인정보를 국외로 이전하고 있습니다.</p>
        <DataTable
          headers={[
            "이전받는 자",
            "이전 국가",
            "연락처",
            "이전 항목",
            "이전 목적",
            "이전 방법",
            "보유 기간",
          ]}
          rows={OVERSEAS_TRANSFERS.map((r) => [
            r.company,
            r.country,
            r.contact,
            r.items,
            r.purpose,
            r.method,
            r.retention,
          ])}
        />
        <p className="pt-2">
          정보주체는 국외 이전을 거부할 수 있습니다. 다만 위 이전은 인증번호
          발송, 주문·배송 안내 등 서비스 제공에 필수적인 처리이므로, 거부하시는
          경우 회원가입 및 서비스 이용이 제한될 수 있습니다. 거부 의사는
          제9조의 개인정보 보호책임자 연락처로 접수하실 수 있습니다.
        </p>
      </Article>

      <Article title="제7조 (개인정보의 파기 절차 및 방법)">
        <p>
          회사는 보유 기간의 경과, 처리 목적 달성 등 개인정보가 불필요하게
          되었을 때에는 지체 없이 해당 개인정보를 파기합니다.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <span className="text-foreground font-medium">파기 절차</span> —
            파기 사유가 발생한 개인정보를 선정하고, 개인정보 보호책임자의 승인을
            받아 파기합니다. 법령에 따라 보관해야 하는 정보는 별도의
            데이터베이스로 옮겨 보관 기간이 끝날 때까지 보관한 뒤 파기합니다.
          </li>
          <li>
            <span className="text-foreground font-medium">파기 방법</span> —
            전자적 파일 형태의 정보는 복구·재생이 불가능한 방법으로 영구
            삭제하며, 종이에 출력된 정보는 분쇄기로 분쇄하거나 소각하여
            파기합니다.
          </li>
        </ol>
      </Article>

      <Article title="제8조 (정보주체와 법정대리인의 권리·의무 및 행사 방법)">
        <p>
          정보주체는 회사에 대해 언제든지 개인정보 열람·정정·삭제·처리정지를
          요구할 수 있습니다.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            권리 행사는 마이페이지 &gt; 회원정보 수정에서 직접 하시거나, 제9조의
            개인정보 보호책임자에게 서면, 전화, 전자우편으로 요청하실 수 있으며
            회사는 지체 없이 조치합니다.
          </li>
          <li>
            정보주체가 개인정보의 오류에 대해 정정을 요청하신 경우, 회사는 정정을
            완료할 때까지 해당 개인정보를 이용하거나 제공하지 않습니다.
          </li>
          <li>
            권리 행사는 법정대리인이나 위임을 받은 자를 통하여 하실 수 있으며,
            이 경우 위임장을 제출하셔야 합니다.
          </li>
          <li>
            열람·처리정지 요구는 「개인정보 보호법」 제35조 제4항 및 제37조
            제2항에 의하여 제한될 수 있습니다.
          </li>
          <li>
            만 14세 미만 아동의 개인정보는 수집하지 않으며, 회원가입 시 만 14세
            이상임을 확인하고 있습니다.
          </li>
        </ol>
      </Article>

      <Article title="제9조 (개인정보 보호책임자 및 열람 청구 접수·처리 부서)">
        <p>
          회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와
          관련한 정보주체의 불만 처리 및 피해 구제를 위하여 아래와 같이 개인정보
          보호책임자를 지정하고 있습니다.
        </p>
        <DataTable
          headers={["구분", "성명", "직책", "연락처"]}
          rows={[
            [
              "개인정보 보호책임자",
              "권흥철",
              "대표이사",
              "1877-7184 / hello@lcnine.kr",
            ],
            [
              "열람 청구 접수·처리",
              "권흥철",
              "대표이사",
              "1877-7184 / hello@lcnine.kr",
            ],
          ]}
        />
        <p className="pt-2">
          정보주체는 서비스 이용 중 발생한 모든 개인정보 보호 관련 문의, 불만
          처리, 피해 구제를 개인정보 보호책임자에게 문의하실 수 있으며, 회사는
          지체 없이 답변 및 처리하겠습니다.
        </p>
      </Article>

      <Article title="제10조 (개인정보의 안전성 확보조치)">
        <p>
          회사는 개인정보의 안전성 확보를 위하여 다음과 같은 조치를 취하고
          있습니다.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <span className="text-foreground font-medium">관리적 조치</span> —
            내부관리계획 수립·시행, 개인정보 취급자 최소화 및 정기 교육
          </li>
          <li>
            <span className="text-foreground font-medium">기술적 조치</span> —
            개인정보처리시스템 접근권한 관리, 접근통제시스템 설치, 비밀번호의
            일방향 암호화 저장, 계좌·결제정보 등 고유식별정보의 암호화, 접속기록
            보관 및 위·변조 방지, 보안프로그램 설치
          </li>
          <li>
            <span className="text-foreground font-medium">전송 구간 보호</span> —
            서비스 전 구간에 대한 HTTPS(TLS) 암호화 통신 적용
          </li>
          <li>
            <span className="text-foreground font-medium">물리적 조치</span> —
            전산실·자료보관실 등에 대한 접근통제
          </li>
        </ol>
      </Article>

      <Article title="제11조 (개인정보 자동 수집 장치의 설치·운영 및 거부에 관한 사항)">
        <p>
          회사는 이용자에게 개별적인 맞춤 서비스를 제공하기 위해 이용정보를
          저장하고 수시로 불러오는 쿠키(cookie)를 사용합니다.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <span className="text-foreground font-medium">사용 목적</span> —
            로그인 상태 유지, 장바구니 보관, 방문·이용 형태 분석을 통한 서비스
            개선
          </li>
          <li>
            <span className="text-foreground font-medium">거부 방법</span> —
            웹브라우저 상단의 도구 &gt; 설정 &gt; 개인정보 보호 메뉴에서 쿠키
            저장을 거부하거나 저장된 쿠키를 삭제하실 수 있습니다. 다만 쿠키
            저장을 거부하시면 로그인이 필요한 일부 서비스 이용에 어려움이 있을 수
            있습니다.
          </li>
        </ol>
      </Article>

      <Article title="제12조 (행태정보의 수집·이용 및 거부에 관한 사항)">
        <p>
          회사는 서비스 이용 통계를 분석하여 서비스를 개선하기 위해 이용자의
          행태정보를 수집합니다.
        </p>
        <DataTable
          headers={["구분", "내용"]}
          rows={[
            [
              "수집하는 행태정보 항목",
              "쿠키 기반 온라인 식별자, 접속 IP, 기기·브라우저 정보, 페이지 조회 이력, 상품 조회·장바구니 담기·구매 이벤트",
            ],
            [
              "수집 방법",
              "이용자가 서비스에 접속하여 페이지를 조회하거나 상품을 조회·구매할 때 웹브라우저를 통해 자동 수집",
            ],
            [
              "수집 목적",
              "서비스 이용 통계 분석, 이용 형태 파악을 통한 서비스 개선",
            ],
            [
              "보유·이용 기간 및 이후 처리 방법",
              "수집일로부터 14개월 보관 후 자동 삭제",
            ],
            ["행태정보를 제공받는 자", "Google LLC (제6조 국외 이전 참조)"],
          ]}
        />
        <p className="pt-2">
          회사는 수집한 행태정보를 이용자별 온라인 맞춤형 광고에 이용하거나
          광고사업자에게 제공하지 않으며, 사상·신념, 정치적 견해, 건강, 성생활
          등 정보주체의 권리를 현저하게 침해할 우려가 있는 민감한 행태정보는
          수집하지 않습니다. 또한 만 14세 미만임을 알고 있는 아동의 행태정보는
          수집하지 않습니다.
        </p>
        <p>
          <span className="text-foreground font-medium">거부 방법</span> —
          웹브라우저의 쿠키 차단 설정(제11조)으로 행태정보 수집을 거부하실 수
          있으며, Google이 제공하는 차단 도구(
          <span className="whitespace-nowrap">
            tools.google.com/dlpage/gaoptout
          </span>
          )를 설치하여 Google Analytics의 수집을 개별적으로 차단하실 수도
          있습니다. 거부하시더라도 서비스 이용에는 제한이 없습니다.
        </p>
      </Article>

      <Article title="제13조 (정보주체의 권익침해에 대한 구제 방법)">
        <p>
          정보주체는 개인정보 침해로 인한 피해를 구제받기 위하여 아래 기관에
          분쟁 해결이나 상담을 신청하실 수 있습니다.
        </p>
        <DataTable
          headers={["기관", "전화", "홈페이지"]}
          rows={REMEDY_CHANNELS.map((r) => [r.name, r.tel, r.url])}
        />
        <p className="pt-2">
          또한 「개인정보 보호법」 제35조(개인정보의 열람), 제36조(개인정보의
          정정·삭제), 제37조(개인정보의 처리정지 등)에 따른 요구에 대하여 공공기관의
          장이 행한 처분 또는 부작위로 인하여 권리 또는 이익의 침해를 받은 자는
          행정심판법이 정하는 바에 따라 행정심판을 청구할 수 있습니다.
        </p>
      </Article>

      <Article title="제14조 (개인정보처리방침의 변경)">
        <p>
          본 개인정보처리방침은 {PRIVACY_POLICY_EFFECTIVE_DATE}부터 적용됩니다.
        </p>
        <p>
          법령·정책 또는 보안기술의 변경에 따라 내용의 추가·삭제 및 수정이 있을
          경우에는 변경사항의 시행 7일 전부터 서비스 공지사항을 통하여 고지합니다.
          다만 수집하는 개인정보의 항목, 이용목적의 변경 등과 같이 정보주체의
          권리에 중대한 영향을 미치는 변경의 경우에는 최소 30일 전에 고지합니다.
        </p>
      </Article>
    </div>
  )
}
