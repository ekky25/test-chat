import Database from 'better-sqlite3';

const db = new Database('chat.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', -- 'admin', 'member', 'read_only'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Varsayılan admini oluştur
const defaultAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!defaultAdmin) {
  const insertAdmin = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  insertAdmin.run('admin', process.env.ADMIN_PASSWORD || 'admin123', 'admin');
  console.log('[Database] Varsayılan admin oluşturuldu.');
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getAllUsers() {
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id ASC').all();
}

export function createUser(username, password, role = 'member') {
  const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  return stmt.run(username, password, role);
}

export function updateUserRole(username, newRole) {
  const stmt = db.prepare('UPDATE users SET role = ? WHERE username = ?');
  return stmt.run(newRole, username);
}

export function deleteUser(username) {
  const stmt = db.prepare('DELETE FROM users WHERE username = ?');
  return stmt.run(username);
}

export default db;