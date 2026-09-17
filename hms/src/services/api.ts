/**
 * HTTP client for the HMS API.
 *
 * The access token is kept in memory only. The refresh token lives in an
 * HttpOnly cookie that JavaScript cannot read; expired access tokens are
 * renewed transparently, with a single refresh shared by concurrent requests.
 */

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Field errors from request validation, keyed by path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { path?: string; message?: string }[]) {
      if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
    }
    return out;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<RefreshResult | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export interface RefreshResult {
  accessToken: string;
  user: unknown;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(attempt = 0): Promise<RefreshResult | null> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'hms' },
  });
  const body = await res.json().catch(() => null);
  if (res.ok && body?.data?.accessToken) {
    accessToken = body.data.accessToken;
    return body.data as RefreshResult;
  }
  // Another tab refreshed at the same moment; the rotated cookie is already set.
  if (body?.error?.code === 'REFRESH_RACE' && attempt < 2) {
    await wait(400);
    return doRefresh(attempt + 1);
  }
  accessToken = null;
  return null;
}

/** Renews the access token. Concurrent callers share one request. */
export function refreshSession(): Promise<RefreshResult | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, options: RequestOptions, retry = true): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'hms' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    signal: options.signal,
    body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const renewed = await refreshSession();
    if (renewed) return send(path, options, false);
    onSessionExpired?.();
  }
  return res;
}

async function toError(res: Response) {
  const body = await res.json().catch(() => null);
  return new ApiError(
    res.status,
    body?.error?.code ?? 'HTTP_ERROR',
    body?.error?.message ?? `Request failed (${res.status})`,
    body?.error?.details,
  );
}

/** Performs a request and returns `{ data, meta }`. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: PageMeta }> {
  let res: Response;
  try {
    res = await send(path, options);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check the network connection.');
  }
  if (!res.ok) throw await toError(res);
  const body = await res.json();
  return { data: body.data as T, meta: body.meta as PageMeta | undefined };
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>) => request<T>(path, { query }).then((r) => r.data),
  page: <T>(path: string, query?: Record<string, QueryValue>) => request<T[]>(path, { query }),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body }).then((r) => r.data),
  put: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'PUT', body }).then((r) => r.data),
  patch: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'PATCH', body }).then((r) => r.data),
};

/** Fetches a protected file (CSV export, patient document) as a Blob. */
export async function fetchBlob(path: string, query?: Record<string, QueryValue>) {
  const res = await send(path, { query });
  if (!res.ok) throw await toError(res);
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = decodeURIComponent(/filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'download');
  return { blob: await res.blob(), filename };
}

export async function downloadFile(path: string, query?: Record<string, QueryValue>) {
  const { blob, filename } = await fetchBlob(path, query);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function openFile(path: string) {
  const { blob } = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
