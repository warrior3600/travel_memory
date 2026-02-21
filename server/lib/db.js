import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

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
    logger.info('db.init', { dbPath: DB_PATH });
  }
}

export async function readDb() {
  await ensureDbFile();
  const raw = await fs.readFile(DB_PATH, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    logger.debug('db.read', {
      users: parsed.users?.length || 0,
      travels: parsed.travels?.length || 0,
      trips: parsed.trips?.length || 0
    });
    return {
      users: parsed.users || [],
      travels: parsed.travels || [],
      trips: parsed.trips || []
    };
  } catch {
    logger.warn('db.read.parse_failed');
    return { ...DEFAULT_STATE };
  }
}

async function writeDbNow(nextState) {
  await ensureDbFile();
  const payload = JSON.stringify(nextState, null, 2);
  await fs.writeFile(DB_PATH, payload, 'utf8');
  logger.debug('db.write', {
    users: nextState.users?.length || 0,
    travels: nextState.travels?.length || 0,
    trips: nextState.trips?.length || 0
  });
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
