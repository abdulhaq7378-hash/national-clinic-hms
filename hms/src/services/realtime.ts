import { API_BASE, getAccessToken, refreshSession } from './api';

export type RealtimeHandler = (type: string, payload: Record<string, unknown>) => void;

/**
 * Subscribes to the Server-Sent Events stream. `fetch` is used instead of
 * EventSource so the access token travels in a header, never in the URL.
 * Returns a function that closes the connection.
 */
export function subscribeToEvents(onEvent: RealtimeHandler, onStatus?: (connected: boolean) => void) {
  const controller = new AbortController();
  let stopped = false;
  let delay = 2000;

  const run = async () => {
    while (!stopped) {
      try {
        const token = getAccessToken();
        if (!token) throw new Error('No session');
        const res = await fetch(`${API_BASE}/events`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.status === 401) {
          await refreshSession();
          throw new Error('Unauthorized');
        }
        if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
        onStatus?.(true);
        delay = 2000;

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            let type = 'message';
            let data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            try {
              onEvent(type, JSON.parse(data));
            } catch {
              // Ignore malformed events.
            }
          }
        }
      } catch {
        if (stopped) return;
      }
      onStatus?.(false);
      if (stopped) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  };
  void run();

  return () => {
    stopped = true;
    controller.abort();
  };
}
