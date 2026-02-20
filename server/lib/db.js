import { promises as fs } from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve(process.cwd(), 'server/storage/db.json');
const DEFAULT_STATE = {
  users: [],
  travels: [],
  trips: []
};

let writeQueue = Promise.resolve();

async function ensureDbFile() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
  }
}

export async function readDb() {
  await ensureDbFile();
  const raw = await fs.readFile(DB_PATH, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || [],
      travels: parsed.travels || [],
      trips: parsed.trips || []
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function writeDbNow(nextState) {
  await ensureDbFile();
  const payload = JSON.stringify(nextState, null, 2);
  await fs.writeFile(DB_PATH, payload, 'utf8');
}

export async function writeDb(nextState) {
  writeQueue = writeQueue.then(() => writeDbNow(nextState));
  return writeQueue;
}

export async function mutateDb(mutator) {
  let result;
  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    result = await mutator(db);
    await writeDbNow(db);
  });
  await writeQueue;
  return result;
}
