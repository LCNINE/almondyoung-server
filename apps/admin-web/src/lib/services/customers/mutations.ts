// src/lib/services/customers/mutations.ts
// Customers 도메인 뮤테이션 함수들

// TODO: 고객 관련 뮤테이션 함수들 구현 예정
// import { useMutation, useQueryClient } from '@tanstack/react-query';
// import { customers } from '../../api/domains/customers';
// import { customerQueryKeys } from './query-keys';

// export const useCreateCustomer = () => {
//   const queryClient = useQueryClient();
  
//   return useMutation({
//     mutationFn: customers.create,
//     onSuccess: () => {
//       queryClient.invalidateQueries({ queryKey: customerQueryKeys.customers.lists() });
//     },
//   });
// };
