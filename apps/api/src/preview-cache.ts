// A cached object is immutable: every upload receives a fresh object key.
// Unlink the private temp file immediately. POSIX retains its bytes only while
// the descriptor is open, including when the API exits unexpectedly.
import { randomUUID } from 'node:crypto';
import { open, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

const maxBytes = 30 * 1024 * 1024;
const lifetimeMs = 5 * 60_000;
type DiskFile = { handle: FileHandle; size: number };
type Entry = {
  file: Promise<DiskFile>;
  readers: number;
  timer?: NodeJS.Timeout;
};

async function spool(source: () => Promise<Readable>): Promise<DiskFile> {
  const path = join(tmpdir(), 'cibo-preview-' + randomUUID());
  const handle = await open(path, 'wx+', 0o600);
  try {
    await unlink(path);
    const stream = await source();
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes)
        throw Object.assign(new Error('File too large'), { status: 413 });
      await handle.writeFile(bytes);
    }
    return { handle, size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export class PreviewCache {
  private entries = new Map<string, Entry>();

  private discard(key: string, entry: Entry) {
    clearTimeout(entry.timer);
    this.entries.delete(key);
    void entry.file.then((file) => file.handle.close()).catch(() => {});
  }

  async acquire(key: string, source: () => Promise<Readable>) {
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 4) {
        const idle = [...this.entries].find(([, e]) => !e.readers);
        if (!idle)
          throw Object.assign(new Error('Preview cache busy'), { status: 503 });
        this.discard(...idle);
      }
      entry = { file: spool(source), readers: 0 };
    }
    // Map iteration starts with the least recently accessed object.
    this.entries.delete(key);
    this.entries.set(key, entry);
    clearTimeout(entry.timer);
    entry.readers++;
    const held = entry;
    try {
      const file = await held.file;
      return {
        ...file,
        release: () => {
          if (--held.readers === 0) {
            held.timer = setTimeout(
              () => this.discard(key, held),
              lifetimeMs,
            ).unref();
          }
        },
      };
    } catch (error) {
      if (this.entries.get(key) === held) this.discard(key, held);
      throw error;
    }
  }
}

export function byteRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

export async function* readSlice(
  handle: FileHandle,
  start: number,
  end: number,
) {
  for (let position = start; position <= end;) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, end - position + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw new Error('Unexpected end of cached file');
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}
