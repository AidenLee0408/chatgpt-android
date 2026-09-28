import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '../api';

const NO_RETRY = new Set(['not_found', 'token_expired', 'step_up_required', 'step_up_cancelled', 'validation_failed', 'plan_limit_reached', 'fact_private_pattern', 'version_conflict']);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, e) => !(isApiError(e) && NO_RETRY.has(e.code)) && count < 2,
    },
    mutations: { retry: false },
  },
});
