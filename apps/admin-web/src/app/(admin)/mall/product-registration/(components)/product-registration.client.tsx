'use client';

import { useState } from 'react';
import { Button } from '@/components/common/button';
import {
  FormField,
  FormInput,
  FormSelect,
  FormCheckbox,
  FormNumberInput,
  FormTextarea,
  FormRadioGroup,
  FormSection,
  FormLayout,
} from '@/components/common/form';
import { Switch } from '@/components/ui/switch';
import { CategoryTreeSelect } from '@/components/common/category-tree-select';

export default function ProductRegistrationClient() {
  const [activeTab, setActiveTab] = useState<
    'individual' | 'csv' | 'smartstore'
  >('individual');
  const [isMembershipOnly, setIsMembershipOnly] = useState(false);
  const [isDisplayEnabled, setIsDisplayEnabled] = useState(true);
  const [isSaleEnabled, setIsSaleEnabled] = useState(true);
  const [hasOptions, setHasOptions] = useState(true);
  const [optionType, setOptionType] = useState('combination-unified');
  const [additionalOptionEnabled, setAdditionalOptionEnabled] = useState(false);
  const [giftEnabled, setGiftEnabled] = useState(false);

  // 기본정보
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [tag, setTag] = useState('');

  // 표시설정
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');

  // 제품정보
  const [manufacturer, setManufacturer] = useState('');
  const [origin, setOrigin] = useState('');
  const [brand, setBrand] = useState('');
  const [material, setMaterial] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [depth, setDepth] = useState('');
  const [weight, setWeight] = useState('');
  const [volume, setVolume] = useState('');
  const [validDate, setValidDate] = useState('');
  const [usage, setUsage] = useState('');

  // 가격정보
  const [basePrice, setBasePrice] = useState('');
  const [membershipPrice, setMembershipPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [taxType, setTaxType] = useState('tax-included');
  const [bulkDiscount1Min, setBulkDiscount1Min] = useState('');
  const [bulkDiscount1Price, setBulkDiscount1Price] = useState('');
  const [bulkDiscount2Min, setBulkDiscount2Min] = useState('');
  const [bulkDiscount2Price, setBulkDiscount2Price] = useState('');

  // 구매조건
  const [deliveryType, setDeliveryType] = useState('free-over-50000');
  const [purchaseLimitType, setPurchaseLimitType] = useState('none');
  const [exclusivePurchaseType, setExclusivePurchaseType] = useState('none');
  const [pointType, setPointType] = useState('default');
  const [quantityLimitType, setQuantityLimitType] = useState('none');
  const [quantityLimitMax, setQuantityLimitMax] = useState('');
  const [purchaseCountLimitType, setPurchaseCountLimitType] = useState('none');
  const [purchaseCountLimitMax, setPurchaseCountLimitMax] = useState('');

  // 상세페이지
  const [description, setDescription] = useState('');

  // 이미지
  const [mainImage, setMainImage] = useState<File | null>(null);
  //   const [additionalImages, setAdditionalImages] = useState<(File | null)[]>([]);

  const handleSave = () => {
    console.log('상품 저장');
  };

  const handleCancel = () => {
    if (confirm('작성 중인 내용이 저장되지 않습니다. 정말 취소하시겠습니까?')) {
      window.history.back();
    }
  };
  const labelWidth = 'w-32';
  const gapX = 'gap-x-22';

  return (
    <div className="p-6 min-h-screen">
      {/* 탭 */}
      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => setActiveTab('individual')}
          className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
            activeTab === 'individual'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          자사몰상품 등록
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
            activeTab === 'csv'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          CSV 상품등록
        </button>
        <button
          onClick={() => setActiveTab('smartstore')}
          className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
            activeTab === 'smartstore'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          스마트스토어 상품 등록
        </button>
      </div>

      <div className="space-y-6">
        {/* 표시설정 */}
        <FormSection
          title="표시설정"
          className="bg-muted rounded-lg border p-6"
        >
          <FormLayout columns={2} gap="md" className={gapX}>
            <div className="flex gap-40">
              <div className="flex items-center gap-10">
                <FormField
                  label="진열함"
                  required
                  direction="horizontal"
                  labelClassName={labelWidth}
                >
                  <Switch
                    checked={isDisplayEnabled}
                    onCheckedChange={setIsDisplayEnabled}
                  />
                </FormField>
                <FormField
                  label="판매함"
                  required
                  direction="horizontal"
                  labelClassName={labelWidth}
                >
                  <Switch
                    checked={isDisplayEnabled}
                    onCheckedChange={setIsDisplayEnabled}
                  />
                </FormField>
              </div>
            </div>
          </FormLayout>
          <FormLayout columns={1} gap="md">
            <FormField label="상품분류" required>
              <CategoryTreeSelect
                value={selectedCategoryId}
                onChange={(categoryId, categoryPath) => {
                  setSelectedCategoryId(categoryId);
                  console.log('선택된 카테고리:', categoryId, categoryPath);
                }}
              />
            </FormField>

            <div className="col-span-2">
              <FormCheckbox
                label="멤버십 회원에게만 공개"
                checked={isMembershipOnly}
                onCheckedChange={setIsMembershipOnly}
              />
            </div>
          </FormLayout>
        </FormSection>

        {/* 기본정보 */}
        <FormSection
          title="기본정보"
          className="bg-muted rounded-lg border p-6"
        >
          <FormLayout columns={2} gap="md" className={gapX}>
            <FormField
              label="상품명"
              required
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="상품명을 입력하세요"
              />
            </FormField>

            <FormField
              label="상품코드"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="자동생성"
                disabled
              />
            </FormField>

            <FormField
              label="태그"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="태그를 입력하세요 (#으로 구문입력)"
              />
            </FormField>
          </FormLayout>
        </FormSection>

        {/* 제품정보 */}
        <FormSection
          title="제품정보"
          className="bg-muted rounded-lg border p-6"
        >
          <FormLayout columns={2} gap="md" className={gapX}>
            <FormField
              label="제조사"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="제조사를 입력하세요"
              />
            </FormField>

            <FormField
              label="원산지"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="원산지를 입력하세요"
              />
            </FormField>

            <FormField
              label="브랜드"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="브랜드를 입력하세요"
              />
            </FormField>

            <FormField
              label="소재"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="소재를 입력하세요"
              />
            </FormField>

            <FormField
              label="상품 규격"
              required
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <div className="flex items-center gap-2">
                <FormInput
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder="W"
                  className="flex-1"
                />
                <span className="text-gray-500">x</span>
                <FormInput
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="H"
                  className="flex-1"
                />
                <span className="text-gray-500">x</span>
                <FormInput
                  value={depth}
                  onChange={(e) => setDepth(e.target.value)}
                  placeholder="DL"
                  className="flex-1"
                />
              </div>
            </FormField>

            <FormField
              label="상품 무게"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormNumberInput
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0"
                suffix="kg"
              />
            </FormField>

            <FormField
              label="용량"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormNumberInput
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="0"
                suffix="ml"
              />
            </FormField>

            <FormField
              label="유효일자"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormInput
                value={validDate}
                onChange={(e) => setValidDate(e.target.value)}
                placeholder="ex) 개봉일로부터 12개월 이내"
              />
            </FormField>

            <FormField
              label="사용방법"
              className="col-span-2"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormTextarea
                value={usage}
                onChange={(e) => setUsage(e.target.value)}
                placeholder="제품 사용방법을 기재해주세요. (100자)"
                rows={4}
              />
            </FormField>
          </FormLayout>
        </FormSection>

        {/* 가격정보 */}
        <FormSection
          title="가격정보"
          className="bg-muted rounded-lg border p-6"
        >
          <FormLayout columns={2} gap="md" className={gapX}>
            <FormField
              label="판매가 (대표)"
              required
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormNumberInput
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="0"
                suffix="원"
              />
            </FormField>

            <FormField
              label="멤버십가"
              required
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormNumberInput
                value={membershipPrice}
                onChange={(e) => setMembershipPrice(e.target.value)}
                placeholder="0"
                suffix="원"
              />
            </FormField>

            <FormField
              label="도매가"
              required
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormNumberInput
                value={wholesalePrice}
                onChange={(e) => setWholesalePrice(e.target.value)}
                placeholder="0"
                suffix="원"
              />
            </FormField>

            <FormField
              label="세금구분"
              required
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormSelect
                value={taxType}
                onValueChange={setTaxType}
                options={[
                  { value: 'tax-included', label: '세금포함' },
                  { value: 'tax-excluded', label: '세금별도' },
                ]}
              />
            </FormField>

            <FormField
              label="대량구매 할인가 1"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <div className="flex items-center gap-2">
                <FormNumberInput
                  value={bulkDiscount1Min}
                  onChange={(e) => setBulkDiscount1Min(e.target.value)}
                  placeholder="0"
                  suffix="개"
                  className="flex-1"
                />
                <span className="text-gray-500">~</span>
                <FormNumberInput
                  value={bulkDiscount1Price}
                  onChange={(e) => setBulkDiscount1Price(e.target.value)}
                  placeholder="0"
                  suffix="원"
                  className="flex-1"
                />
              </div>
            </FormField>

            <FormField
              label="대량구매 할인가 2"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <div className="flex items-center gap-2">
                <FormNumberInput
                  value={bulkDiscount2Min}
                  onChange={(e) => setBulkDiscount2Min(e.target.value)}
                  placeholder="0"
                  suffix="개"
                  className="flex-1"
                />
                <span className="text-gray-500">~</span>
                <FormNumberInput
                  value={bulkDiscount2Price}
                  onChange={(e) => setBulkDiscount2Price(e.target.value)}
                  placeholder="0"
                  suffix="원"
                  className="flex-1"
                />
              </div>
            </FormField>
          </FormLayout>
        </FormSection>

        {/* 구매조건 */}
        <FormSection
          title="구매조건"
          className="bg-muted rounded-lg border p-6"
        >
          <FormLayout columns={2} gap="md" className={gapX}>
            <FormField
              label="배송정보"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormSelect
                value={deliveryType}
                onValueChange={setDeliveryType}
                options={[
                  { value: 'free-over-50000', label: '5만원 이상 무료배송' },
                  { value: 'paid', label: '유료배송' },
                ]}
              />
            </FormField>

            <FormField
              label="구매제한"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormRadioGroup
                value={purchaseLimitType}
                onValueChange={setPurchaseLimitType}
                options={[
                  { value: 'none', label: '제한안함' },
                  {
                    value: 'membership-only',
                    label: '멤버십 회원만 구매 가능',
                  },
                  { value: 'wholesale-only', label: '도매 회원만 구매 가능' },
                ]}
                orientation="horizontal"
              />
            </FormField>

            <FormField
              label="단독구매설정"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormRadioGroup
                value={exclusivePurchaseType}
                onValueChange={setExclusivePurchaseType}
                options={[
                  { value: 'none', label: '제한안함' },
                  { value: 'cannot-standalone', label: '단독구매 불가' },
                  { value: 'standalone-only', label: '단독구매 전용' },
                ]}
                orientation="horizontal"
              />
            </FormField>

            <FormField
              label="적립금"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormRadioGroup
                value={pointType}
                onValueChange={setPointType}
                options={[
                  { value: 'default', label: '기본설정' },
                  { value: 'custom', label: '개별설정' },
                ]}
                orientation="horizontal"
              />
            </FormField>

            <FormField
              label="구매 수량 제한"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormRadioGroup
                value={quantityLimitType}
                onValueChange={setQuantityLimitType}
                options={[
                  { value: 'none', label: '제한안함' },
                  { value: 'limited', label: '개 이하로 제한함' },
                ]}
                orientation="horizontal"
              />
              {quantityLimitType === 'limited' && (
                <div className="mt-2">
                  <FormNumberInput
                    value={quantityLimitMax}
                    onChange={(e) => setQuantityLimitMax(e.target.value)}
                    placeholder="1"
                    suffix="개 이상"
                  />
                </div>
              )}
            </FormField>

            <FormField
              label="구매 횟수 제한"
              direction="horizontal"
              labelClassName={labelWidth}
            >
              <FormRadioGroup
                value={purchaseCountLimitType}
                onValueChange={setPurchaseCountLimitType}
                options={[
                  { value: 'none', label: '제한안함' },
                  { value: 'limited', label: '최대' },
                ]}
                orientation="horizontal"
              />
              {purchaseCountLimitType === 'limited' && (
                <div className="mt-2 flex items-center gap-2">
                  <FormSelect
                    value="item-basis"
                    options={[{ value: 'item-basis', label: '상품기준' }]}
                    className="w-32"
                  />
                  <FormNumberInput
                    value={purchaseCountLimitMax}
                    onChange={(e) => setPurchaseCountLimitMax(e.target.value)}
                    placeholder="1"
                    suffix="번 이하로 제한함 (id 당)"
                  />
                </div>
              )}
            </FormField>
          </FormLayout>
        </FormSection>

        {/* 단품(옵션)정보 */}
        {hasOptions && (
          <FormSection
            title="단품(옵션)정보"
            className="bg-muted rounded-lg border p-6"
          >
            <div className="space-y-6">
              <FormCheckbox
                label="옵션 없음 (선택 시 단품으로 등록 / 옵션 상품은 옵션없음 선택을 해제)"
                checked={!hasOptions}
                onCheckedChange={(checked) => setHasOptions(!checked)}
              />

              <FormField
                label="옵션 구성방식"
                direction="horizontal"
                labelClassName={labelWidth}
              >
                <FormRadioGroup
                  value={optionType}
                  onValueChange={setOptionType}
                  options={[
                    { value: 'combination-unified', label: '조합 일체선택형' },
                    {
                      value: 'combination-separated',
                      label: '조합 분리선택형',
                    },
                    { value: 'independent', label: '독립 선택형' },
                  ]}
                  orientation="horizontal"
                />
              </FormField>

              {/* 옵션 입력 영역 */}
              <div className="border rounded-lg p-4">
                <FormField label="옵션 입력" labelClassName={labelWidth}>
                  <div className="space-y-4">
                    <p className="text-sm text-gray-500">
                      세미콜론(;) 또는 Enter, Tab 키를 통해 옵션값을 연속적으로
                      입력하세요.
                    </p>
                    <div className="space-y-2">
                      <div className="border rounded p-2 bg-blue-50">
                        <span className="text-sm">예시)블랙</span>
                      </div>
                    </div>
                    <Button variant="primary" size="sm">
                      옵션품목 생성
                    </Button>
                  </div>
                </FormField>
              </div>

              {/* 옵션 품목 목록 */}
              <div className="border rounded-lg">
                <div className="bg-gray-100 p-4">
                  <p className="text-sm text-gray-500">
                    데이터가 존재하지 않습니다.
                  </p>
                </div>
              </div>

              {/* 추가 입력 옵션 */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-500 rounded"></span>
                    <h3 className="font-semibold text-gray-900">
                      추가 입력 옵션
                    </h3>
                  </div>
                  <FormCheckbox
                    label="사용"
                    checked={additionalOptionEnabled}
                    onCheckedChange={setAdditionalOptionEnabled}
                  />
                </div>

                {additionalOptionEnabled && (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <FormField
                      label="옵션 목록"
                      direction="horizontal"
                      labelClassName={labelWidth}
                    >
                      <FormSelect
                        value="required"
                        options={[
                          { value: 'required', label: '필수항목' },
                          { value: 'optional', label: '선택항목' },
                        ]}
                      />
                    </FormField>
                    <div className="mt-2">
                      <FormInput placeholder="예시)색상" />
                    </div>
                  </div>
                )}
              </div>

              {/* 사은품 증정 */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-500 rounded"></span>
                    <h3 className="font-semibold text-gray-900">사은품 증정</h3>
                  </div>
                  <FormCheckbox
                    label="사은품 증정"
                    checked={giftEnabled}
                    onCheckedChange={setGiftEnabled}
                  />
                </div>

                {giftEnabled && (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <FormField label="사은품 구성" labelClassName={labelWidth}>
                      <FormSelect
                        value="nail-gift"
                        options={[{ value: 'nail-gift', label: '네일 사은품' }]}
                      />
                    </FormField>
                  </div>
                )}
              </div>
            </div>
          </FormSection>
        )}

        {/* 상세페이지 */}
        <FormSection
          title="상세페이지"
          className="bg-muted rounded-lg border p-6"
        >
          <FormField
            label="상품 상세설명"
            required
            direction="horizontal"
            labelClassName={labelWidth}
          >
            <FormTextarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="상품 상세설명을 입력하세요"
              rows={10}
            />
          </FormField>
        </FormSection>

        {/* 이미지 정보 */}
        <FormSection
          title="이미지 정보"
          className="bg-muted rounded-lg border p-6"
        >
          <FormLayout columns={3} gap="md">
            <FormField label="대표이미지" required direction="horizontal">
              <div className="space-y-2">
                <div className="w-full h-48 border-2 border-dashed rounded-lg flex items-center justify-center bg-gray-50">
                  {mainImage ? (
                    <span className="text-sm text-gray-600">
                      {mainImage.name}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">
                      이미지를 업로드하세요
                    </span>
                  )}
                </div>
                <Button variant="secondary" size="sm" fullWidth>
                  파일선택
                </Button>
                <p className="text-xs text-gray-500">
                  권장사이즈 500*500px ~ 1000*1000px
                </p>
              </div>
            </FormField>

            {[1, 2, 3, 4, 5].map((num) => (
              <FormField
                key={num}
                label={`부가이미지${num}`}
                direction="horizontal"
              >
                <div className="space-y-2">
                  <div className="w-full h-48 border-2 border-dashed rounded-lg flex items-center justify-center bg-gray-50">
                    <span className="text-sm text-gray-400">
                      이미지를 업로드하세요
                    </span>
                  </div>
                  <Button variant="secondary" size="sm" fullWidth>
                    파일선택
                  </Button>
                  <p className="text-xs text-gray-500">
                    권장사이즈 500*500px ~ 1000*1000px
                  </p>
                </div>
              </FormField>
            ))}
          </FormLayout>
        </FormSection>

        {/* 하단 버튼 */}
        <div className="flex justify-end gap-4 pb-6">
          <Button variant="secondary" size="lg" onClick={handleCancel}>
            취소
          </Button>
          <Button variant="primary" size="lg" onClick={handleSave}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
