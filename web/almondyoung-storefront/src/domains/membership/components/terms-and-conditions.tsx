export function TermsAndConditions({
  monthlyPrice,
  yearlyPrice,
  billingMode,
}: {
  /** 플랜 조회 실패 시 undefined — 금액이 빠진 채로도 약관 전문은 노출한다 */
  monthlyPrice?: number
  yearlyPrice?: number
  billingMode: "recurring" | "one_time"
}) {
  const isRecurring = billingMode === "recurring"
  const hasPrices = monthlyPrice !== undefined && yearlyPrice !== undefined
  return (
    <div className="space-y-6 text-sm leading-[19px] text-[#555d6d]">
      <div>
        <h1 className="mb-2 text-lg font-bold text-[#1a1c20]">
          {isRecurring
            ? "정기 자동 결제 및 이용 약관 동의서"
            : "멤버십 이용 및 환불 약관 동의서"}
        </h1>
        <p>
          {isRecurring
            ? "본 동의서는 귀하의 정기 결제 서비스 이용과 관련하여 법적 보호 및 명확한 이용 조건을 제공하기 위해 작성되었습니다."
            : "본 동의서는 귀하의 멤버십 1회 결제 이용과 관련하여 법적 보호 및 명확한 이용 조건을 제공하기 위해 작성되었습니다."}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">
          결제 목적 및 내용
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          {isRecurring ? (
            <>
              <li>
                본 서비스는 매월 정기적인 금액 결제를 통해 서비스 구독 및 제공을
                목적으로 합니다.
              </li>
              <li>자동이체(CMS)를 통해 진행됩니다.</li>
            </>
          ) : (
            <>
              <li>
                본 서비스는 1회 결제를 통해 선택하신 기간의 멤버십 구독 및 제공을
                목적으로 합니다.
              </li>
              <li>결제는 신용·체크카드 등 선택하신 결제수단으로 진행됩니다.</li>
            </>
          )}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">
          결제 주기 및 금액
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          {isRecurring ? (
            <>
              <li>
                결제 주기: 매월 구독 기간이 하루 남았을 때 1회 (정기결제 기준)
              </li>
              {hasPrices && (
                <li>
                  결제 금액: 월간 정기결제 {monthlyPrice.toLocaleString()}원 /
                  연간 1회 결제 {yearlyPrice.toLocaleString()}원
                </li>
              )}
              <li>결제 금액은 동의 없이 변경되지 않습니다.</li>
            </>
          ) : (
            <>
              <li>
                결제 주기: 가입 시 1회 결제 (자동 갱신 없음). 구독 만료 시 계속
                이용하려면 재결제가 필요합니다.
              </li>
              {hasPrices && (
                <li>
                  결제 금액: 월간 결제 {monthlyPrice.toLocaleString()}원 / 연간
                  결제 {yearlyPrice.toLocaleString()}원
                </li>
              )}
            </>
          )}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">
          결제 정보 수집 항목
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          {isRecurring ? (
            <>
              <li>결제자 정보: 이름, 연락처, 생년월일</li>
              <li>
                결제 수단 정보: 계좌번호, 은행명, 예금주명, 생년월일(개인) 또는
                사업자번호(법인)
              </li>
            </>
          ) : (
            <>
              <li>결제자 정보: 이름, 연락처</li>
              <li>
                결제 수단 정보는 결제대행사(PG)를 통해 안전하게 처리되며 회사는
                카드번호 등 민감정보를 보관하지 않습니다.
              </li>
            </>
          )}
        </ul>
      </div>

      {isRecurring && (
        <div>
          <h2 className="mb-2 text-base font-bold text-[#1a1c20]">
            동의 철회 및 변경
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
            <li>
              귀하는 언제든 동의를 철회하거나 결제 정보를 변경할 권리가 있습니다.
            </li>
            <li>
              고객센터(1877-7184)로 연락 또는 아몬드영 홈페이지를 통해 해지가
              가능합니다.
            </li>
            <li>
              철회하시면 다음 결제부터 출금이 중단되며, 이미 결제한 기간의
              서비스는 종료일까지 정상적으로 유지됩니다. 이미 결제한 금액의
              환급은 아래 「환불 정책」에 따릅니다.
            </li>
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">유의사항</h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          {isRecurring ? (
            <>
              <li>결제 실패 시 서비스 이용이 제한될 수 있습니다.</li>
              <li>
                사전 고지 없이 결제 수단이 유효하지 않을 경우, 결제 처리가
                진행되지 않을 수 있습니다.
              </li>
            </>
          ) : (
            <>
              <li>1회 결제 상품으로 자동 갱신·정기 출금이 발생하지 않습니다.</li>
              <li>
                구독 기간이 만료되면 멤버십 혜택이 종료되며, 계속 이용하려면 다시
                결제해야 합니다.
              </li>
            </>
          )}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold text-[#1a1c20]">환불 정책</h2>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">
          제 1조 목적
        </h3>
        <p>
          본 약관은 아몬드영 멤버십 서비스(이하 &quot;서비스&quot;)를 이용함에
          있어 회원과 회사 간의 권리·의무 및 책임 사항을 규정함을 목적으로
          합니다.
        </p>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">
          제 2조 청약철회 및 중도해지 환급
        </h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            회원은 결제일부터 7일 이내에 청약을 철회할 수 있으며, 이 경우 회사는
            결제금액 전액을 환급합니다. 다만 해당 결제 주기에 멤버십
            혜택(멤버십가 구매, 웰컴딜 등)을 이용하신 사실이 있는 경우에는
            그러하지 아니합니다.
          </li>
          <li>
            연간 플랜 회원은 기간 중 언제든지 해지할 수 있으며, 회사는
            결제금액에서 이용한 기간에 해당하는 금액과 회원이 실제로 적용받은
            멤버십 할인 총액을 공제한 잔액을 환급합니다.
            <ul className="mt-1.5 list-[circle] space-y-1.5 pl-5 marker:text-[#b0b3ba]">
              <li>
                이용한 기간은 30일을 1개월로 하여 계산하며, 시작일이 포함된 달도
                1개월로 봅니다.
              </li>
              <li>
                이용한 기간에 해당하는 금액은 월간 플랜 정가
                {monthlyPrice !== undefined &&
                  `(${monthlyPrice.toLocaleString()}원)`}
                에 이용 개월 수를 곱하여 산정합니다.
              </li>
              <li>일시정지 기간은 이용한 기간에서 제외합니다.</li>
              <li>
                정산 결과 환급액이 0원 이하인 경우 환급은 발생하지 않으며, 남은
                기간까지 계속 이용하실 수 있습니다.
              </li>
            </ul>
          </li>
          <li>
            월간 플랜 회원이 제1항의 기간이 지난 뒤 해지하는 경우, 해당 결제
            주기의 종료일까지 서비스를 이용하실 수 있고 다음 주기부터 청구되지
            않습니다. 이미 결제한 주기의 요금은 이용한 기간에 대한 대가이므로
            환급되지 않습니다.
          </li>
          <li>
            서비스 장애, 기술적 오류 등 회사의 사유로 정상 이용이 어려웠던
            경우에는 이용하지 못한 기간에 대해 별도로 환급합니다.
          </li>
        </ul>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">
          {isRecurring ? "제 3조 구독 해지 및 갱신" : "제 3조 구독 기간"}
        </h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          {isRecurring ? (
            <>
              <li>
                회원은 언제든지 구독을 해지할 수 있습니다. 다음 결제일 전에
                해지하시면 다음 주기부터 청구되지 않습니다.
              </li>
              <li>
                해지하셔도 이미 결제한 기간은 종료일까지 그대로 이용하실 수
                있으며, 환급은 제2조에 따릅니다.
              </li>
              <li>
                해지 요청이 이루어지지 않은 경우, 서비스는 자동으로 갱신되며
                결제가 처리됩니다.
              </li>
            </>
          ) : (
            <>
              <li>
                1회 결제 구독은 결제한 기간 동안만 유효하며 자동으로 갱신되지
                않습니다.
              </li>
              <li>
                구독 만료 후 계속 이용을 원하는 경우 새로 결제하여 이용할 수
                있습니다.
              </li>
            </>
          )}
        </ul>

        <h3 className="mt-4 mb-1.5 text-sm font-bold text-[#1a1c20]">
          제 4조 회원의 동의
        </h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[#b0b3ba]">
          <li>
            본 약관은 회원이 결제 화면에서 내용을 확인하고 동의한 때에 효력이
            발생합니다.
          </li>
          <li>
            회사는 본 약관을 결제 화면과 마이페이지에서 상시 확인할 수 있도록
            제공하며, 회원에게 불리하게 변경하는 경우 최소 30일 전에 사전
            고지합니다.
          </li>
        </ul>
      </div>
    </div>
  )
}
