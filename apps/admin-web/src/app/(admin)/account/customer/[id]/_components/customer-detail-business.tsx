'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  useBusinessLicenseByUserId,
  useUpsertBusinessLicenseByUserId,
} from '@/lib/services/customers';

const businessFormSchema = z.object({
  businessNumber: z
    .string()
    .refine((value) => /^\d{10}$/.test(value), '사업자등록번호는 10자리 숫자여야 합니다.'),
  representativeName: z
    .string()
    .min(1, '대표자명을 입력해주세요.')
    .max(100, '대표자명은 100자 이하여야 합니다.'),
});

type BusinessFormValues = z.infer<typeof businessFormSchema>;

function CustomerDetailBusinessForm({ userId }: { userId: string }) {
  const { data, isLoading } = useBusinessLicenseByUserId(userId);
  const { mutate, isPending } = useUpsertBusinessLicenseByUserId(userId);

  const form = useForm<BusinessFormValues>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: {
      businessNumber: '',
      representativeName: '',
    },
  });

  const isEdit = !!data;

  useEffect(() => {
    if (data) {
      form.reset({
        businessNumber: data.businessNumber ?? '',
        representativeName: data.representativeName ?? '',
      });
    }
  }, [data, form]);

  const handleSubmit = (values: BusinessFormValues) => {
    mutate(
      {
        businessNumber: values.businessNumber,
        representativeName: values.representativeName,
        // 어드민이 직접 등록/수정하면 곧바로 승인 상태로 처리한다.
        status: 'approved',
      },
      {
        onSuccess: () => {
          toast.success(
            isEdit
              ? '사업자 정보가 수정되었습니다.'
              : '사업자 정보가 등록되었습니다.'
          );
        },
        onError: (error) => {
          toast.error(error.message || '사업자 정보 저장에 실패했습니다.');
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <div className="flex flex-col gap-4 p-4">
          <FormField
            control={form.control}
            name="businessNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>사업자등록번호</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="0000000000"
                    {...field}
                    onChange={(e) =>
                      field.onChange(e.target.value.replace(/\D/g, '').slice(0, 10))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="representativeName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>대표자명</FormLabel>
                <FormControl>
                  <Input placeholder="대표자명" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end border-t p-4">
          <Button type="submit" disabled={isPending}>
            {isPending ? '저장 중...' : isEdit ? '수정' : '등록'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function CustomerDetailBusiness({ userId }: { userId: string }) {
  return (
    <Container className="divide-y">
      <Header title="사업자 정보" />
      <CustomerDetailBusinessForm userId={userId} />
    </Container>
  );
}
