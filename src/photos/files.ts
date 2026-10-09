import { photoPaperColors } from '../domain/presentation';
import { storedPhotoPageSchema, type PhotoPage } from './model';

export const MAX_PHOTOS = 8;
/** Re-encode locally to strip metadata and bound the provider payload. */
export async function preparePhoto(file: File): Promise<PhotoPage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}：請使用 JPG、PNG 或 WebP；HEIC 請先轉成 JPG。`);
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} 超過 15 MB，請縮小後再試。`);
  if (!file.size) throw new Error(`${file.name} 是空白檔案。`);
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const id = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`${file.name} 無法開啟，請重新匯出照片。`); }
  try {
    if (bitmap.width * bitmap.height > 80_000_000) throw new Error('照片像素過高，請縮小後再試。');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('瀏覽器未能處理照片。');
    ctx.fillStyle = photoPaperColors.background; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let image = canvas.toDataURL('image/jpeg', 0.9);
    if (image.length > 4 * 1024 * 1024) image = canvas.toDataURL('image/jpeg', 0.7);
    if (image.length > 4 * 1024 * 1024) throw new Error('照片仍然過大，請分開拍攝。');
    return { id, name: file.name, image, status: 'ready', rows: [], warnings: [] };
  } finally { bitmap.close(); }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('careflow-atlas-photo-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(account: string, mode: IDBTransactionMode, action: (store: IDBObjectStore, key: string) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try { return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction('drafts', mode); const request = action(tx.objectStore('drafts'), account);
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function loadPhotoDraft(account: string): Promise<PhotoPage[]> {
  const raw: unknown = await transaction(account, 'readonly', (store, key) => store.get(key)) ?? [];
  const pages = storedPhotoPageSchema.array().max(MAX_PHOTOS).parse(raw);
  return pages.map(p => p.status === 'processing' ? { ...p, status: 'error', error: '上次辨識已中斷，請重試。' } : p);
}
export const savePhotoDraft = (account: string, pages: PhotoPage[]) => pages.length
  ? transaction(account, 'readwrite', (store, key) => store.put(pages, key))
  : transaction(account, 'readwrite', (store, key) => store.delete(key));
