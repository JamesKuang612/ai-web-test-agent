/** 调用本地 JSON API，并统一抛出服务端错误。 */
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? '请求失败');
  return value;
}
