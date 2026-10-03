import { db } from "@/lib/db";

export interface StoredFile {
  bytes: Uint8Array;
  contentType: string;
  size: number;
  userId: string | null;
}

export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string, userId?: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  url(key: string): string;
}

class PostgresStorage implements Storage {
  async put(key: string, bytes: Uint8Array, contentType: string, userId?: string) {
    const data = {
      bytes: Buffer.from(bytes),
      contentType,
      size: bytes.byteLength,
      userId: userId ?? null,
    };
    await db.fileBlob.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
  }

  async get(key: string): Promise<StoredFile | null> {
    const row = await db.fileBlob.findUnique({ where: { key } });
    if (!row) return null;
    return {
      bytes: new Uint8Array(row.bytes),
      contentType: row.contentType,
      size: row.size,
      userId: row.userId,
    };
  }

  url(key: string) {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `/api/files/${encoded}`;
  }
}

function createStorage(): Storage {
  const driver = (process.env.STORAGE_DRIVER ?? "postgres").trim();
  if (driver === "postgres") return new PostgresStorage();
  throw new Error(`STORAGE_DRIVER ${driver} is not implemented`);
}

export const storage = createStorage();
