// Where the form database and uploaded files are persisted.
// DiskBackend: a local folder (needs a persistent disk in production).
// SupabaseBackend: a private Supabase Storage bucket (free tier, survives restarts).
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const DB_NAME = 'db.json';

class DiskBackend {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.uploadDir = path.join(dataDir, 'uploads');
    this.tmpDir = path.join(this.uploadDir, 'tmp');
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }

  async loadDb() {
    const file = path.join(this.dataDir, DB_NAME);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }

  async saveDb(db) {
    const file = path.join(this.dataDir, DB_NAME);
    fs.writeFileSync(file + '.tmp', JSON.stringify(db, null, 2));
    fs.renameSync(file + '.tmp', file);
  }

  async putFile(name, localPath) {
    fs.renameSync(localPath, path.join(this.uploadDir, name));
  }

  async getFile(name) {
    const p = path.join(this.uploadDir, name);
    return fs.existsSync(p) ? fs.createReadStream(p) : null;
  }

  async deleteFiles(names) {
    for (const n of names) fs.rmSync(path.join(this.uploadDir, n), { force: true });
  }
}

class SupabaseBackend {
  constructor({ url, key, bucket = 'forms', tmpDir }) {
    this.base = `${url.replace(/\/$/, '')}/storage/v1`;
    this.bucket = bucket;
    this.tmpDir = tmpDir;
    fs.mkdirSync(tmpDir, { recursive: true });
    // New-style secret keys (sb_secret_...) go only in the apikey header;
    // legacy service_role JWTs also go in Authorization.
    this.headers = key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
  }

  async request(method, urlPath, { body, headers = {}, okStatuses = [] } = {}) {
    const res = await fetch(`${this.base}${urlPath}`, { method, body, headers: { ...this.headers, ...headers } });
    if (!res.ok && !okStatuses.includes(res.status)) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase storage ${method} ${urlPath} failed: ${res.status} ${text}`);
    }
    return res;
  }

  objectPath(name) {
    return `/object/${this.bucket}/${name.split('/').map(encodeURIComponent).join('/')}`;
  }

  async init() {
    // Create the private bucket on first run; 400/409 means it already exists.
    await this.request('POST', '/bucket', {
      body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }),
      headers: { 'Content-Type': 'application/json' },
      okStatuses: [400, 409],
    });
  }

  async loadDb() {
    const res = await this.request('GET', this.objectPath(DB_NAME), { okStatuses: [400, 404] });
    if (res.ok) return res.json();
    // Only a genuine "not found" means first run. Any other error must stop
    // startup, or the next save would overwrite the real data with an empty db.
    const text = await res.text();
    if (/not.?found/i.test(text)) return null;
    throw new Error(`Supabase storage GET ${DB_NAME} failed: ${res.status} ${text}`);
  }

  async saveDb(db) {
    await this.request('POST', this.objectPath(DB_NAME), {
      body: JSON.stringify(db),
      headers: { 'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': 'no-cache' },
    });
  }

  async putFile(name, localPath, mimeType) {
    await this.request('POST', this.objectPath(`uploads/${name}`), {
      body: fs.readFileSync(localPath),
      headers: { 'Content-Type': mimeType || 'application/octet-stream' },
    });
    fs.rmSync(localPath, { force: true });
  }

  async getFile(name) {
    const res = await this.request('GET', this.objectPath(`uploads/${name}`), { okStatuses: [400, 404] });
    return res.ok ? Readable.fromWeb(res.body) : null;
  }

  async deleteFiles(names) {
    if (!names.length) return;
    await this.request('DELETE', `/object/${this.bucket}`, {
      body: JSON.stringify({ prefixes: names.map((n) => `uploads/${n}`) }),
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

module.exports = { DiskBackend, SupabaseBackend };
