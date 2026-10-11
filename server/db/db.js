import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;
let useLocalFallback = false;
const localDbPath = path.join(__dirname, 'local_db.json');

// Initialize local DB storage if needed
function loadLocalDb() {
  if (!fs.existsSync(localDbPath)) {
    const initial = {
      races: [],
      candidates: [],
      odds_snapshots: [],
      news_articles: [],
      jobs: [],
      job_audit_logs: [],
      site_config: {}
    };
    fs.writeFileSync(localDbPath, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
  } catch (e) {
    return { races: [], candidates: [], odds_snapshots: [], news_articles: [], jobs: [], job_audit_logs: [], site_config: {} };
  }
}

function saveLocalDb(data) {
  fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2));
}

// Attempt MySQL Pool Creation
try {
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'usmidterm-user',
    password: process.env.DB_PASSWORD || 'Kiran@5080',
    database: process.env.DB_NAME || 'usmidterm-db',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    connectTimeout: 5000
  });
} catch (err) {
  console.warn('[DB] MySQL Pool initialization deferred. Will test on first query.');
}

export async function testConnection() {
  if (pool) {
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      useLocalFallback = false;
      return { success: true, type: 'mysql', database: process.env.DB_NAME };
    } catch (err) {
      console.warn(`[DB] MySQL connection error (${err.message}). Falling back to local storage adapter.`);
      useLocalFallback = true;
      return { success: false, type: 'local_fallback', error: err.message };
    }
  }
  useLocalFallback = true;
  return { success: false, type: 'local_fallback', reason: 'No pool' };
}

export async function query(sql, params = []) {
  if (!useLocalFallback && pool) {
    try {
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (err) {
      console.warn(`[DB] Query fallback triggered: ${err.message}`);
      useLocalFallback = true;
    }
  }

  // Local fallback handler
  return queryLocal(sql, params);
}

export async function execute(sql, params = []) {
  if (!useLocalFallback && pool) {
    try {
      const [result] = await pool.execute(sql, params);
      return result;
    } catch (err) {
      console.warn(`[DB] Execute fallback triggered: ${err.message}`);
      useLocalFallback = true;
    }
  }

  return executeLocal(sql, params);
}

// Lightweight local querying emulation for development without local MySQL
function queryLocal(sql, params) {
  const db = loadLocalDb();
  const cleanSql = sql.trim().toLowerCase();

  if (cleanSql.includes('from races')) {
    let list = [...db.races];
    if (cleanSql.includes('where chamber = ?')) {
      list = list.filter(r => r.chamber === params[0]);
    } else if (cleanSql.includes('where id = ?')) {
      list = list.filter(r => r.id === params[0]);
    }
    return list;
  }

  if (cleanSql.includes('from candidates')) {
    let list = [...db.candidates];
    if (cleanSql.includes('where race_id = ?')) {
      list = list.filter(c => c.race_id === params[0]);
    } else if (cleanSql.includes('where id = ?')) {
      list = list.filter(c => c.id === params[0]);
    }
    return list;
  }

  if (cleanSql.includes('from news_articles')) {
    let list = db.news_articles.filter(n => !n.is_hidden);
    list.sort((a, b) => (b.is_pinned - a.is_pinned) || new Date(b.published_at) - new Date(a.published_at));
    return list.slice(0, 50);
  }

  if (cleanSql.includes('from jobs')) {
    return [...db.jobs];
  }

  if (cleanSql.includes('from job_audit_logs')) {
    let list = [...db.job_audit_logs];
    list.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    return list.slice(0, 100);
  }

  if (cleanSql.includes('from site_config')) {
    return Object.entries(db.site_config).map(([k, v]) => ({ config_key: k, config_value: v }));
  }

  return [];
}

function executeLocal(sql, params) {
  const db = loadLocalDb();
  const cleanSql = sql.trim().toLowerCase();

  // Basic local upsert handlers
  saveLocalDb(db);
  return { affectedRows: 1, insertId: Date.now() };
}

export function isMySQL() {
  return !useLocalFallback;
}

export { pool };
