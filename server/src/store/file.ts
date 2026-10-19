// Stockage fichier pour le développement local sans Supabase : un fichier JSON écrit de façon
// atomique (fichier temporaire + renommage) et un journal d'actions en JSON Lines.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MemoryStore, type MemoryData } from './memory.ts';
import type { ActionLogEntry } from './types.ts';

export class FileStore extends MemoryStore {
  override readonly kind = 'file';
  private readonly file: string;
  private readonly logFile: string;
  private writing: Promise<void> = Promise.resolve();
  private pending = false;

  constructor(private readonly dir: string) {
    super();
    this.file = path.join(dir, 'world.json');
    this.logFile = path.join(dir, 'actions.jsonl');
  }

  override async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8')) as MemoryData;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  override async close() { await this.writing; }

  protected override changed(): Promise<void> {
    // Les écritures sont sérialisées ; plusieurs demandes rapprochées n'en produisent qu'une.
    if (this.pending) return this.writing;
    this.pending = true;
    this.writing = this.writing.then(async () => {
      this.pending = false;
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data));
      await rename(tmp, this.file);
    });
    return this.writing;
  }

  override async logAction(entry: ActionLogEntry) {
    await super.logAction(entry);
    this.actions.length = 0;
    await appendFile(this.logFile, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
  }
}
