/**
 * SQLite 数据层（sql.js 纯JS实现，免编译）
 * 数据文件保存在项目 data/ 目录，便于备份和迁移
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.ZJ_DB_PATH || path.join(__dirname, '..', 'data', 'zj_koc_v3.dat');
let db = null;
let SQL = null;
let saveTimer = null;

class Statement {
  constructor(database, sql) {
    this._db = database;
    this._sql = sql;
    this._stmt = database.prepare(sql);
  }
  run(...params) {
    this._stmt.bind(this._normalize(params));
    this._stmt.step();
    this._stmt.reset();
    const result = {
      lastInsertRowid: this._lastId(),
      changes: this._db.getRowsModified()
    };
    scheduleSave();
    return result;
  }
  get(...params) {
    if (params.length > 0) this._stmt.bind(this._normalize(params));
    let result = null;
    if (this._stmt.step()) result = this._stmt.getAsObject();
    this._stmt.reset();
    return result;
  }
  all(...params) {
    if (params.length > 0) this._stmt.bind(this._normalize(params));
    const results = [];
    while (this._stmt.step()) results.push(this._stmt.getAsObject());
    this._stmt.reset();
    return results;
  }
  _normalize(params) {
    const p = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
    return p.map(v => v === undefined ? null : v);
  }
  _lastId() {
    const r = this._db.exec('SELECT last_insert_rowid() as id');
    return r.length > 0 ? r[0].values[0][0] : null;
  }
}

class DatabaseWrapper {
  constructor(database) { this._db = database; }
  prepare(sql) { return new Statement(this._db, sql); }
  exec(sql) { this._db.exec(sql); scheduleSave(); }
  transaction(fn) {
    return (...args) => {
      this._db.exec('BEGIN');
      try {
        const r = fn(...args);
        this._db.exec('COMMIT');
        scheduleSave();
        return r;
      } catch (e) {
        this._db.exec('ROLLBACK');
        throw e;
      }
    };
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 300);
}

function saveNow() {
  if (!db) return;
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Buffer.from(db.export());
    fs.writeFileSync(DB_PATH + '.tmp', data);
    fs.renameSync(DB_PATH + '.tmp', DB_PATH);
  } catch (e) {
    console.error('[db] save failed:', e.message);
  }
}

let wrapper = null;

async function initDb() {
  if (wrapper) return wrapper;
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  wrapper = new DatabaseWrapper(db);
  const schema = require('./schema');
  schema.createSchema(wrapper);
  schema.migrate(wrapper);
  return wrapper;
}

function getDb() {
  if (!wrapper) throw new Error('DB not initialized');
  return wrapper;
}

process.on('exit', saveNow);
process.on('SIGINT', () => { saveNow(); process.exit(0); });

module.exports = { initDb, getDb, saveNow, DB_PATH };
