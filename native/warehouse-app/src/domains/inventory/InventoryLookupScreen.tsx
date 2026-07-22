import { useState } from 'react';
import { Button } from '../../core/design/Button';
import { errorMessage } from '../../core/data/errorMessage';
import { useSkuSearch } from './useSkuSearch';

export function InventoryLookupScreen() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const { data, isLoading, isError, error } = useSkuSearch(query);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">재고조회</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(term);
        }}
      >
        <input
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="상품명 검색"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Button type="submit">검색</Button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">조회 중…</p>}
      {isError && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(error)}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-gray-500">결과가 없어요.</p>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data?.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="font-medium text-gray-800">{s.name}</div>
              <div className="text-xs text-gray-500">
                {s.code}
                {s.optionKey ? ` · ${s.optionKey}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
