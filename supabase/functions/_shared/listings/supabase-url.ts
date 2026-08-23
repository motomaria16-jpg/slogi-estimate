const LOCAL_SUPABASE_HTTP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'host.docker.internal',
  'kong',
]);

export function validateSupabaseServiceUrl(rawValue: string): string {
  const raw = String(rawValue || '').trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('supabase_url_invalid');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const localHttp = url.protocol === 'http:' && LOCAL_SUPABASE_HTTP_HOSTS.has(hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) {
    throw new Error('supabase_url_unsafe');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('supabase_url_unsafe');
  return url.origin;
}
