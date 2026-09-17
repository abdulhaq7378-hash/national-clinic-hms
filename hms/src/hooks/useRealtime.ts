import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS } from '@hms/shared';
import { subscribeToEvents } from '../services/realtime';
import { useAuth } from '../contexts/AuthContext';

const INVALIDATIONS: Record<string, string[][]> = {
  [REALTIME_EVENTS.appointmentChanged]: [['appointments'], ['dashboard']],
  [REALTIME_EVENTS.queueChanged]: [['queue'], ['dashboard'], ['consultations']],
  [REALTIME_EVENTS.labOrderChanged]: [['lab'], ['dashboard']],
  [REALTIME_EVENTS.prescriptionChanged]: [['prescriptions'], ['dashboard']],
  [REALTIME_EVENTS.bedChanged]: [['beds'], ['admissions'], ['dashboard']],
  [REALTIME_EVENTS.notification]: [['notifications']],
};

/**
 * Keeps screens current by refreshing affected queries when the server
 * announces a change. There is no interval polling.
 */
export function useRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return;
    return subscribeToEvents((type) => {
      for (const key of INVALIDATIONS[type] ?? []) void queryClient.invalidateQueries({ queryKey: key });
    }, setConnected);
  }, [user, queryClient]);

  return connected;
}
