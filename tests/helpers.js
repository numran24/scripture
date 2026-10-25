import { readFileSync } from 'node:fs';
import { Repo, MemoryAdapter } from '../js/repo.js';
export const read = (p) => readFileSync(new URL('../sample/' + p, import.meta.url), 'utf8');
export async function newRepo() {
  let t = Date.parse('2026-10-24T12:00:00Z');
  const repo = new Repo(new MemoryAdapter(), { clock: () => (t += 1000) });
  await repo.load();
  return repo;
}
