// In-memory form database, persisted as one JSON document through a backend
// (local disk or Supabase Storage). Good enough for a single server with
// modest traffic; swap for a real database if you outgrow it.
const crypto = require('crypto');

class Store {
  constructor(backend, db) {
    this.backend = backend;
    this.db = db || { forms: [], submissions: [] };
    this.writes = Promise.resolve();
  }

  static async open(backend) {
    if (backend.init) await backend.init();
    return new Store(backend, await backend.loadDb());
  }

  // Writes are serialised so an older snapshot never overwrites a newer one.
  save() {
    const snapshot = JSON.parse(JSON.stringify(this.db));
    this.writes = this.writes.catch(() => {}).then(() => this.backend.saveDb(snapshot));
    return this.writes;
  }

  static id() {
    return crypto.randomBytes(8).toString('hex');
  }

  listForms() {
    return [...this.db.forms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getForm(id) {
    return this.db.forms.find((f) => f.id === id);
  }

  async saveForm(input, id) {
    const now = new Date().toISOString();
    let form = id && this.getForm(id);
    if (form) {
      Object.assign(form, input, { updatedAt: now });
    } else {
      form = { id: Store.id(), createdAt: now, updatedAt: now, open: true, ...input };
      this.db.forms.push(form);
    }
    await this.save();
    return form;
  }

  async deleteForm(id) {
    const names = this.submissionsFor(id).flatMap(storedNames);
    this.db.forms = this.db.forms.filter((f) => f.id !== id);
    this.db.submissions = this.db.submissions.filter((s) => s.formId !== id);
    await this.save();
    await this.backend.deleteFiles(names);
  }

  submissionsFor(formId) {
    return this.db.submissions
      .filter((s) => s.formId === formId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSubmission(id) {
    return this.db.submissions.find((s) => s.id === id);
  }

  async addSubmission(formId, answers, files) {
    const sub = { id: Store.id(), formId, createdAt: new Date().toISOString(), answers, files };
    this.db.submissions.push(sub);
    try {
      await this.save();
    } catch (e) {
      this.db.submissions = this.db.submissions.filter((s) => s.id !== sub.id);
      throw e;
    }
    return sub;
  }

  async deleteSubmission(id) {
    const sub = this.getSubmission(id);
    if (!sub) return;
    this.db.submissions = this.db.submissions.filter((s) => s.id !== id);
    await this.save();
    await this.backend.deleteFiles(storedNames(sub));
  }
}

function storedNames(sub) {
  return Object.values(sub.files || {}).flat().map((f) => f.storedName);
}

module.exports = Store;
