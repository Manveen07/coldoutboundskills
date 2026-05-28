import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { resolve } from 'path';

export function runDirName(client: string, category: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}${mm}-${client}-${category}`;
}

export function initRunDir(client: string, category: string, baseDir?: string): string {
  const base = baseDir ?? resolve(process.cwd(), 'data/runs');
  const dir = resolve(base, runDirName(client, category));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeArtifact(runDir: string, name: string, payload: any): void {
  const path = resolve(runDir, name);
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  writeFileSync(path, content, 'utf8');
}

export function appendLog(runDir: string, line: string): void {
  const path = resolve(runDir, 'pipeline.log');
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${line}\n`;
  if (!existsSync(path)) writeFileSync(path, entry, 'utf8');
  else appendFileSync(path, entry, 'utf8');
}
