/** @format */

'use client';

import React from 'react';
import { Button } from './button'; // Button 컴포넌트 경로 확인
import { Plus, Download, Edit, Trash2, ArrowRight } from 'lucide-react';

export function ButtonExamples() {
    return (
        <div className="p-8 space-y-8 bg-gray-50">
            <h1 className="text-2xl font-bold mb-6">버튼 컴포넌트 예시</h1>

            {/* Primary 버튼 */}
            <section>
                <h2 className="text-lg font-semibold mb-4">Primary 버튼</h2>
                <div className="flex flex-wrap items-center gap-4">
                    <Button variant="primary" size="sm">Small</Button>
                    <Button variant="primary" size="md">Medium</Button>
                    <Button variant="primary" size="lg">Large</Button>
                    <Button variant="primary" size="md" icon={Plus} iconPosition="left">
                        아이콘 왼쪽
                    </Button>
                    <Button variant="primary" size="md" icon={ArrowRight} iconPosition="right">
                        아이콘 오른쪽
                    </Button>
                    <Button variant="primary" size="md" loading>
                        로딩 중
                    </Button>
                    <Button variant="primary" size="md" disabled>
                        비활성화
                    </Button>
                </div>
            </section>

            {/* Secondary 버튼 */}
            <section>
                <h2 className="text-lg font-semibold mb-4">Secondary 버튼</h2>
                <div className="flex flex-wrap items-center gap-4">
                    <Button variant="secondary" size="sm">Small</Button>
                    <Button variant="secondary" size="md">Medium</Button>
                    <Button variant="secondary" size="lg">Large</Button>
                    <Button variant="secondary" size="md" icon={Download} iconPosition="left">
                        다운로드
                    </Button>
                    <Button variant="secondary" size="md" disabled>
                        비활성화
                    </Button>
                </div>
            </section>

            {/* Outline 버튼 */}
            <section>
                <h2 className="text-lg font-semibold mb-4">Outline 버튼</h2>
                <div className="flex flex-wrap items-center gap-4">
                    <Button variant="outline" size="sm">Small</Button>
                    <Button variant="outline" size="md">Medium</Button>
                    <Button variant="outline" size="lg">Large</Button>
                    <Button variant="outline" size="md" icon={Edit} iconPosition="left">
                        수정
                    </Button>
                    <Button variant="outline" size="md" disabled>
                        비활성화
                    </Button>
                </div>
            </section>

            {/* Text 버튼 */}
            <section>
                <h2 className="text-lg font-semibold mb-4">Text 버튼</h2>
                <div className="flex flex-wrap items-center gap-4">
                    <Button variant="text" size="sm">Small</Button>
                    <Button variant="text" size="md">Medium</Button>
                    <Button variant="text" size="lg">Large</Button>
                    <Button variant="text" size="md" disabled>
                        비활성화
                    </Button>
                </div>
            </section>

            {/* Danger 버튼 */}
            <section>
                <h2 className="text-lg font-semibold mb-4">Danger 버튼</h2>
                <div className="flex flex-wrap items-center gap-4">
                    <Button variant="danger" size="sm">Small</Button>
                    <Button variant="danger" size="md">Medium</Button>
                    <Button variant="danger" size="lg">Large</Button>
                    <Button variant="danger" size="md" icon={Trash2} iconPosition="left">
                        삭제
                    </Button>
                    <Button variant="danger" size="md" disabled>
                        비활성화
                    </Button>
                </div>
            </section>

            {/* [수정] '상태별 예시' 섹션을 새로운 컴포넌트 API에 맞게 변경합니다.
              - 'state' prop은 제거되었습니다.
              - 'hover', 'active', 'focus' 상태는 실제 마우스/키보드 상호작용으로 확인해야 합니다.
              - 'disabled' 상태는 'disabled' prop을 사용하여 명확하게 표현합니다.
            */}
            <section>
                <h2 className="text-lg font-semibold mb-4">상태별 예시 (Enabled / Disabled)</h2>
                <div className="space-y-4">
                    <div>
                        <h3 className="text-md font-medium mb-2">Enabled (기본 활성화 상태)</h3>
                        <p className="text-sm text-gray-500 mb-2">
                            버튼 위에 마우스를 올리거나 클릭, 키보드 포커스를 이동하여 상태 변화를 확인하세요.
                        </p>
                        <div className="flex flex-wrap gap-4">
                            {/* state="enabled" prop 제거 */}
                            <Button variant="primary">Primary</Button>
                            <Button variant="secondary">Secondary</Button>
                            <Button variant="outline">Outline</Button>
                            <Button variant="text">Text</Button>
                            <Button variant="danger">Danger</Button>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-md font-medium mb-2">Disabled (비활성화 상태)</h3>
                        <div className="flex flex-wrap gap-4">
                            {/* state="disabled" prop 대신 disabled prop 사용 */}
                            <Button variant="primary" disabled>Primary</Button>
                            <Button variant="secondary" disabled>Secondary</Button>
                            <Button variant="outline" disabled>Outline</Button>
                            <Button variant="text" disabled>Text</Button>
                            <Button variant="danger" disabled>Danger</Button>
                        </div>
                    </div>
                </div>
            </section>

            {/* 전체 너비 버튼 */}
            <section>
                <h2 className="text-lg font-semibold mb-4">전체 너비 버튼</h2>
                <div className="space-y-2">
                    <Button variant="primary" fullWidth>전체 너비 Primary</Button>
                    <Button variant="secondary" fullWidth>전체 너비 Secondary</Button>
                    <Button variant="outline" fullWidth>전체 너비 Outline</Button>
                </div>
            </section>
        </div>
    );
}