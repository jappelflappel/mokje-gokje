const readSql = 'SELECT state, revision, updated_at FROM rooms WHERE code = ?';
const insertSql = 'INSERT OR IGNORE INTO rooms (code, revision, updated_at, state) VALUES (?, 1, ?, ?)';
const updateSql = 'UPDATE rooms SET revision = revision + 1, updated_at = ?, state = ? WHERE code = ? AND revision = ?';
const pruneSql = 'DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE updated_at < ? LIMIT 48)';
const healthSql = 'SELECT code FROM rooms LIMIT 1';

export function d1Store(db) {
  return {
    read: code => db.prepare(readSql).bind(code).first(),
    insert: async room => (await db.prepare(insertSql).bind(room.code, Date.now(), JSON.stringify(room)).run()).meta.changes === 1,
    update: async (room, revision) => (await db.prepare(updateSql)
      .bind(Date.now(), JSON.stringify(room), room.code, revision).run()).meta.changes === 1,
    prune: limit => db.prepare(pruneSql).bind(limit).run(),
    health: () => db.prepare(healthSql).first()
  };
}

export function sqliteStore(db) {
  const read = db.prepare(readSql);
  const insert = db.prepare(insertSql);
  const update = db.prepare(updateSql);
  const prune = db.prepare(pruneSql);
  const health = db.prepare(healthSql);
  return {
    read: code => read.get(code),
    insert: room => insert.run(room.code, Date.now(), JSON.stringify(room)).changes === 1,
    update: (room, revision) => update.run(Date.now(), JSON.stringify(room), room.code, revision).changes === 1,
    prune: limit => prune.run(limit),
    health: () => health.get()
  };
}
