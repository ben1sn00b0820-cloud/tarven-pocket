/** Image sources are data, never HTML or executable URLs. No privileged fetches. */
export function safePhotoUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || value !== value.trim() || /[\u0000-\u0020\u007f\\<>"`]/.test(value)) return '';
  let path;
  if (value.startsWith('/') && !value.startsWith('//')) {
    try { path = decodeURIComponent(value.split(/[?#]/, 1)[0]); } catch { return ''; }
    if (path.startsWith('//') || /[\u0000-\u001f\u007f\\<>"`]/.test(path) || path.split('/').includes('..') || /^\/(?:api|csrf-token)(?:\/|$)/i.test(path)) return '';
  } else {
    let url;
    try { url = new URL(value); } catch { return ''; }
    if (!/^https?:\/\//i.test(value) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '';
    try { path = decodeURIComponent(url.pathname); } catch { return ''; }
  }
  if (/\.(?:svgz?|html?|xhtml|xml|[cm]?js)(?:$|\/)/i.test(path)) return '';
  return value;
}
