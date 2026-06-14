const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db = null;

function wrapStatement(sql, rawDb, save) {
  function safeFree(stmt) { try { stmt.free(); } catch (_) {} }
  function lastInsertRowid() {
    const r = rawDb.exec('SELECT last_insert_rowid() AS id');
    return r && r[0] && r[0].values && r[0].values[0] ? r[0].values[0][0] : 0;
  }
  function getChanges() {
    const r = rawDb.exec('SELECT changes() AS c');
    return r && r[0] && r[0].values && r[0].values[0] ? r[0].values[0][0] : 0;
  }
  return {
    run(...params) {
      const stmt = rawDb.prepare(sql);
      try {
        if (params && params.length) stmt.bind(params);
        stmt.step();
        const changes = getChanges();
        safeFree(stmt);
        const id = lastInsertRowid();
        if (save) save();
        return { changes, lastInsertRowid: id };
      } catch (e) {
        safeFree(stmt);
        throw e;
      }
    },
    get(...params) {
      const stmt = rawDb.prepare(sql);
      try {
        if (params && params.length) stmt.bind(params);
        let row = undefined;
        if (stmt.step()) row = stmt.getAsObject();
        safeFree(stmt);
        return row;
      } catch (e) {
        safeFree(stmt);
        throw e;
      }
    },
    all(...params) {
      const stmt = rawDb.prepare(sql);
      try {
        if (params && params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        safeFree(stmt);
        return rows;
      } catch (e) {
        safeFree(stmt);
        throw e;
      }
    }
  };
}

function wrapDb(rawDb) {
  let savePending = false;
  let savingNow = false;
  let inTransaction = false;

  const save = () => {
    try {
      const data = rawDb.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch (e) {
      console.error('[DB] 持久化保存失败:', e.message);
    }
  };

  const throttledSave = () => {
    if (inTransaction) return;
    if (savingNow) { savePending = true; return; }
    savingNow = true;
    save();
    savingNow = false;
    if (savePending) { savePending = false; throttledSave(); }
  };

  const wrapped = {
    prepare(sql) { return wrapStatement(sql, rawDb, throttledSave); },
    exec(sql) { rawDb.exec(sql); throttledSave(); },
    pragma() { /* sql.js 不支持常见 pragma，静默忽略 */ },
    transaction(fn) {
      return function wrappedTransaction(...args) {
        inTransaction = true;
        rawDb.exec('BEGIN TRANSACTION');
        try {
          const result = fn(...args);
          rawDb.exec('COMMIT');
          inTransaction = false;
          save();
          return result;
        } catch (e) {
          try { rawDb.exec('ROLLBACK'); } catch (_) {}
          inTransaction = false;
          throw e;
        }
      };
    },
    forceSave: save
  };
  return wrapped;
}

const ready = (async () => {
  const SQL = await initSqlJs({
    locateFile: (file) => {
      try {
        return require.resolve(`sql.js/dist/${file}`);
      } catch (_) {
        return path.join(path.dirname(require.resolve('sql.js')), 'dist', file);
      }
    }
  });

  let buffer = null;
  if (fs.existsSync(dbPath)) {
    try {
      buffer = fs.readFileSync(dbPath);
      console.log(`[DB] 已加载 SQLite 数据库: ${dbPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.warn('[DB] 数据库文件读取失败，将创建新库:', e.message);
    }
  } else {
    console.log(`[DB] 数据库文件不存在，将创建新库: ${dbPath}`);
  }

  const rawDb = buffer ? new SQL.Database(buffer) : new SQL.Database();
  _db = wrapDb(rawDb);
  return _db;
})().catch(err => {
  console.error('[DB] 初始化失败:', err);
  process.exit(1);
});

const assertReady = () => {
  if (!_db) throw new Error('[DB] 数据库尚未初始化，请在 db.ready 后使用');
};

const proxy = {
  ready,
  prepare(...a) { assertReady(); return _db.prepare(...a); },
  exec(...a)    { assertReady(); return _db.exec(...a); },
  pragma(...a)  { assertReady(); return _db.pragma(...a); },
  transaction(...a) { assertReady(); return _db.transaction(...a); },
  forceSave()   { assertReady(); return _db.forceSave(); },
  isReady()     { return !!_db; }
};

proxy.initTables = () => {
  assertReady();
  const db = proxy;
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'clerk')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      period TEXT NOT NULL CHECK(period IN ('morning', 'afternoon', 'evening')),
      time_start TEXT NOT NULL,
      time_end TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 10,
      available_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed', 'full')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      id_card TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'notifying', 'confirmed', 'passed', 'expired', 'cancelled')),
      notify_deadline DATETIME,
      notified_at DATETIME,
      confirmed_at DATETIME,
      expired_at DATETIME,
      passed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waitlist_id INTEGER NOT NULL,
      slot_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('opportunity', 'confirmed', 'passed', 'expired', 'recovered', 'manual')),
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('pending', 'sent', 'failed')),
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      slot_id INTEGER,
      waitlist_id INTEGER,
      patient_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT
    );

    CREATE TABLE IF NOT EXISTS no_show_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      waitlist_id INTEGER,
      appointment_id INTEGER,
      reason TEXT,
      recovered_at DATETIME,
      recovered_by INTEGER,
      recovery_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS time_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL DEFAULT 'real' CHECK(mode IN ('real', 'manual')),
      current_time DATETIME,
      speed_multiplier REAL DEFAULT 1.0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const insertConfig = db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)`);
  const defaults = [
    ['waitlist_timeout_seconds', '180'],
    ['recovery_strategy', 'auto_next'],
    ['auto_recover_enabled', 'true'],
    ['notify_retries', '3'],
    ['notify_retry_interval_seconds', '60'],
    ['manual_trigger_enabled', 'true'],
    ['clerk_can_modify_global_config', 'false'],
    ['position_display_mode', 'absolute'],
    ['export_include_contact_info', 'true']
  ];
  defaults.forEach(([k, v]) => insertConfig.run(k, v));

  const initTimeOverride = db.prepare(`
    INSERT OR IGNORE INTO time_overrides (id, mode, current_time, speed_multiplier) VALUES (1, 'real', NULL, 1.0)
  `);
  initTimeOverride.run();

  console.log('[DB] 数据表初始化完成');
};

module.exports = proxy;
