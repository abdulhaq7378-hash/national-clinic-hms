import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import type { Doctor, HospitalSettings, Service } from '../types';

export function useSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<HospitalSettings>('/settings'),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
}

export function useDoctors(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['doctors'],
    queryFn: () => api.get<Doctor[]>('/doctors'),
    enabled: enabled && can('doctor:read'),
    staleTime: 5 * 60_000,
  });
}

export function useServices(category?: string) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['services', category ?? 'all'],
    queryFn: () => api.get<Service[]>('/services', { category }),
    enabled: can('service:read'),
    staleTime: 60_000,
  });
}

/**
 * Mutation with standard success toast and cache invalidation.
 * Errors are shown as toasts unless the caller handles them.
 */
export function useAction<TInput, TResult = unknown>(
  fn: (input: TInput) => Promise<TResult>,
  options: {
    success?: string | ((result: TResult) => string);
    invalidate?: QueryKey[];
    onSuccess?: (result: TResult) => void;
    silentError?: boolean;
  } = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      for (const key of options.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key });
      if (options.success) {
        toast.success(typeof options.success === 'function' ? options.success(result) : options.success);
      }
      options.onSuccess?.(result);
    },
    onError: (err) => {
      if (!options.silentError) toast.error(err);
    },
  });
}
