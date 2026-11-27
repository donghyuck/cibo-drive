export async function api(path: string, init?: RequestInit) {
  const res = await fetch('/api/' + path, { cache: 'no-store', ...init });
  if (!res.ok)
    throw Object.assign(
      new Error(
        (await res.json().catch(() => ({}))).error ?? '요청에 실패했습니다.',
      ),
      { status: res.status },
    );
  return res.status === 204 ? null : res.json();
}
export function post(path: string, body: object) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
