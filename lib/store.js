// Tiny JSON-file store. Good enough for a single server with modest traffic;
// swap for SQLite/Postgres if you outgrow it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.uploadDir = path.join(dataDir, 'uploads');
    this.file = path.join(dataDir, 'db.json');
    fs.mkdirSync(this.uploadDir, { recursive: true });
    this.db = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : { forms: [], submissions: [] };
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
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

  saveForm(input, id) {
    const now = new Date().toISOString();
    let form = id && this.getForm(id);
    if (form) {
      Object.assign(form, input, { updatedAt: now });
    } else {
      form = { id: Store.id(), createdAt: now, updatedAt: now, open: true, ...input };
      this.db.forms.push(form);
    }
    this.save();
    return form;
  }

  deleteForm(id) {
    for (const s of this.submissionsFor(id)) this.deleteSubmissionFiles(s);
    this.db.forms = this.db.forms.filter((f) => f.id !== id);
    this.db.submissions = this.db.submissions.filter((s) => s.formId !== id);
    this.save();
  }

  submissionsFor(formId) {
    return this.db.submissions
      .filter((s) => s.formId === formId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSubmission(id) {
    return this.db.submissions.find((s) => s.id === id);
  }

  addSubmission(formId, answers, files) {
    const sub = { id: Store.id(), formId, createdAt: new Date().toISOString(), answers, files };
    this.db.submissions.push(sub);
    this.save();
    return sub;
  }

  deleteSubmission(id) {
    const sub = this.getSubmission(id);
    if (!sub) return;
    this.deleteSubmissionFiles(sub);
    this.db.submissions = this.db.submissions.filter((s) => s.id !== id);
    this.save();
  }

  deleteSubmissionFiles(sub) {
    for (const list of Object.values(sub.files || {})) {
      for (const f of list) fs.rmSync(path.join(this.uploadDir, f.storedName), { force: true });
    }
  }
}

module.exports = Store;
