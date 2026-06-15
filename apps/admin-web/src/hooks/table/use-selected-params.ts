'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type UseSelectedParamsOptions = {
  prefix?: string;
};

export function useSelectedParams({ prefix }: UseSelectedParamsOptions = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const prefixKey = (key: string) => (prefix ? `${prefix}_${key}` : key);

  const get = (key: string): string | string[] | undefined => {
    const value = searchParams.get(prefixKey(key));
    if (value === null) return undefined;
    if (value.includes(',')) return value.split(',');
    return value;
  };

  const add = (key: string, value: string | string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    const strValue = Array.isArray(value) ? value.join(',') : value;
    params.set(prefixKey(key), strValue);
    params.delete(prefixKey('page'));
    router.replace(`${pathname}?${params.toString()}`);
  };

  const addMany = (entries: Record<string, string | string[]>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(entries)) {
      const strValue = Array.isArray(value) ? value.join(',') : value;
      params.set(prefixKey(key), strValue);
    }
    params.delete(prefixKey('page'));
    router.replace(`${pathname}?${params.toString()}`);
  };

  const deleteParam = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(prefixKey(key));
    params.delete(prefixKey('page'));
    router.replace(`${pathname}?${params.toString()}`);
  };

  const deleteMany = (keys: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of keys) {
      params.delete(prefixKey(key));
    }
    params.delete(prefixKey('page'));
    router.replace(`${pathname}?${params.toString()}`);
  };

  return { get, add, addMany, delete: deleteParam, deleteMany, searchParams };
}
