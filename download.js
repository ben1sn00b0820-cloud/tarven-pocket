// Saving pictures and audio to the device: the browser's download (on phones, its save or share sheet).
// Used both in the tavern page and in the phone's frame, so everything goes through the document it is given.

const EXTENSIONS = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg',
  'audio/opus': 'opus', 'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
  'text/plain': 'txt', 'application/json': 'json', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif'
};
const KNOWN = /\.(png|jpe?g|webp|avif|gif|mp3|wav|ogg|opus|flac|aac|m4a|webm|txt|json)$/i;

/** A file name every system accepts, ending in the extension that matches the file's type. */
export function fileName(base, type = '', fallback = 'ST-iPhonie') {
  let name = String(base ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const ext = EXTENSIONS[String(type).split(';')[0].trim().toLowerCase()];
  if (ext) name = name.replace(KNOWN, '');
  name = [...(name || fallback)].slice(0, 80).join('').trim() || fallback;
  return ext ? `${name}.${ext}` : name;
}

/** Saves a Blob, or the file at a URL (blob:, data: or a path on the tavern), under the given name. Returns the name. */
export async function saveFile(doc, source, base) {
  const win = doc.defaultView;
  let blob = source;
  if (typeof source === 'string') {
    const response = await win.fetch(source);
    if (!response.ok) throw Error(`檔案讀取失敗（HTTP ${response.status}）`);
    blob = await response.blob();
  }
  if (!blob || typeof blob.arrayBuffer !== 'function' || !blob.size) throw Error('沒有可以下載的檔案');
  const name = fileName(base, blob.type), url = win.URL.createObjectURL(blob), link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the file after click() returns.
  win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
  return name;
}

/** A 下载 button for the image viewer: keeps the viewer open and reports how it went. */
export function downloadAction(doc, pick, notify = () => {}) {
  return {label: '下載', run: async index => {
    try {
      const {source, name} = await pick(index);
      notify(`已下載 ${await saveFile(doc, source, name)}`);
    } catch (error) { notify(`下載失敗：${error.message}`, {error: true}); }
    return false;
  }};
}
