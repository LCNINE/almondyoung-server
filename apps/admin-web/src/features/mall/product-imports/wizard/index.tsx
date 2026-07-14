'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useValidateImport, useCommitImport } from '@/lib/services/products';
import type {
  ValidatePreviewDto,
  CommitResultDto,
} from '@/lib/types/dto/product-import';
import { UploadStep } from './upload-step';
import { ValidateStep } from './validate-step';
import { CommitResultStep } from './commit-result-step';

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: '업로드',
  2: '검증',
  3: '완료',
};

function Stepper({ current }: { current: Step }) {
  return (
    <div className="flex gap-2 px-6 pb-2 text-xs">
      {([1, 2, 3] as Step[]).map((s) => (
        <span
          key={s}
          className={
            s === current
              ? 'font-semibold text-primary'
              : 'text-muted-foreground'
          }
        >
          {s}. {STEP_LABELS[s]}
        </span>
      ))}
    </div>
  );
}

export default function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ValidatePreviewDto | null>(null);
  const [result, setResult] = useState<CommitResultDto | null>(null);

  const validate = useValidateImport();
  const commit = useCommitImport();

  function handleFileSelected(f: File) {
    setFile(f);
    setPreview(null);
    setStep(2);
    validate.mutate(f, {
      onSuccess: setPreview,
      onError: () => {
        toast.error('검증 중 오류가 발생했습니다.');
        setStep(1);
      },
    });
  }

  function handleReupload() {
    setStep(1);
    setFile(null);
    setPreview(null);
  }

  function handleCommit() {
    if (!file) return;
    commit.mutate(file, {
      onSuccess: (res) => {
        setResult(res);
        setStep(3);
      },
      onError: () => toast.error('커밋 중 오류가 발생했습니다.'),
    });
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="엑셀 대량등록"
          subtitle="엑셀로 판매상품을 일괄 등록합니다. (업로드 → 검증 → 커밋)"
        />
        <Stepper current={step} />
        <div className="p-6 pt-2">
          {step === 1 && <UploadStep onFileSelected={handleFileSelected} />}
          {step === 2 && (
            <ValidateStep
              preview={preview}
              isLoading={validate.isPending}
              committing={commit.isPending}
              onReupload={handleReupload}
              onCommit={handleCommit}
            />
          )}
          {step === 3 && result && (
            <CommitResultStep
              result={result}
              onGoToSession={() =>
                router.push(`/mall/product-imports/${result.sessionId}`)
              }
            />
          )}
        </div>
      </Container>
    </div>
  );
}
