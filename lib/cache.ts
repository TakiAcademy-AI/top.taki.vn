/**
 * Cache TTL trong bộ nhớ tiến trình — cho các API public đọc nhiều (home, leaderboard).
 * VPS self-hosted Supabase mỗi query đi qua HTTP Kong nên chậm; cache 60s giảm tải rõ rệt.
 * Dữ liệu public trễ tối đa TTL giây (chấp nhận được). KHÔNG dùng cho API nhạy cảm (admin/me).
 */
type Entry = { at: number; val: unknown };
const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.val as T;
  const val = await fn();
  store.set(key, { at: Date.now(), val });
  return val;
}

/** Xóa cache theo tiền tố — gọi sau khi tính điểm / thay đổi dữ liệu để trang cập nhật ngay. */
export function invalidate(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
