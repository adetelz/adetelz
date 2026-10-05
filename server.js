const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const os = require('os');
const Store = require('./lib/store');
const { DiskBackend, SupabaseBackend } = require('./lib/backends');
const { normalizeForm, validateSubmission } = require('./lib/fields');
const views = require('./lib/views');

// Supabase when SUPABASE_URL + SUPABASE_SECRET_KEY are set, else a local folder.
function defaultBackend() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    return new SupabaseBackend({ url, key, bucket: process.env.SUPABASE_BUCKET, tmpDir: path.join(os.tmpdir(), 'form-uploads') });
  }
  return new DiskBackend(process.env.DATA_DIR || path.join(__dirname, 'data'));
}

async function createApp({
  backend = defaultBackend(),
  adminPassword = process.env.ADMIN_PASSWORD,
  sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  publicUrl = process.env.PUBLIC_URL,
} = {}) {
  if (!adminPassword) throw new Error('ADMIN_PASSWORD is required');
  const store = await Store.open(backend);
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  const baseUrl = (req) => (publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  // ---- Admin auth: one shared password, HMAC-signed session cookie ----
  const SESSION_MS = 7 * 24 * 3600 * 1000;
  const sign = (v) => crypto.createHmac('sha256', sessionSecret).update(v).digest('hex');
  const safeEqual = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  const cookie = (req, name) => {
    const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  };
  const isAdmin = (req) => {
    const [exp, mac] = (cookie(req, 'session') || '').split('.');
    return Boolean(exp && mac && Number(exp) > Date.now() && safeEqual(mac, sign(exp)));
  };
  const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : res.redirect('/admin/login'));

  const attempts = new Map();
  app.get('/admin/login', (req, res) => res.send(views.loginPage()));
  app.post('/admin/login', (req, res) => {
    const key = req.ip;
    const a = attempts.get(key) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60 * 1000) Object.assign(a, { n: 0, t: Date.now() });
    if (a.n >= 10) return res.status(429).send(views.loginPage('Too many attempts. Try again in 15 minutes.'));
    if (!safeEqual(req.body.password || '', adminPassword)) {
      a.n++;
      attempts.set(key, a);
      return res.status(401).send(views.loginPage('Wrong password.'));
    }
    attempts.delete(key);
    const exp = String(Date.now() + SESSION_MS);
    res.cookie('session', `${exp}.${sign(exp)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: SESSION_MS,
    });
    res.redirect('/admin');
  });
  app.post('/admin/logout', (req, res) => {
    res.clearCookie('session');
    res.redirect('/admin/login');
  });

  // ---- Admin pages ----
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get('/admin', requireAdmin, (req, res) => {
    const counts = {};
    for (const s of store.db.submissions) counts[s.formId] = (counts[s.formId] || 0) + 1;
    res.send(views.dashboard(store.listForms(), counts, baseUrl(req)));
  });
  app.get('/admin/forms/new', requireAdmin, (req, res) => res.send(views.builderPage(null)));

  const loadForm = (req, res, next) => {
    req.form = store.getForm(req.params.id);
    req.form ? next() : res.status(404).send(views.notFound());
  };

  app.get('/admin/forms/:id/edit', requireAdmin, loadForm, (req, res) => res.send(views.builderPage(req.form)));

  app.post('/admin/api/forms', requireAdmin, (req, res) => saveForm(req, res, null));
  app.put('/admin/api/forms/:id', requireAdmin, loadForm, (req, res) => saveForm(req, res, req.form.id));
  async function saveForm(req, res, id) {
    let input;
    try {
      input = normalizeForm(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const form = await store.saveForm(input, id);
    res.json({ id: form.id });
  }
  app.delete('/admin/api/forms/:id', requireAdmin, loadForm, async (req, res) => {
    await store.deleteForm(req.form.id);
    res.json({ ok: true });
  });

  app.get('/admin/forms/:id/responses', requireAdmin, loadForm, (req, res) => {
    res.send(views.responsesPage(req.form, store.submissionsFor(req.form.id), baseUrl(req)));
  });

  app.get('/admin/forms/:id/export.csv', requireAdmin, loadForm, (req, res) => {
    const form = req.form;
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [['Submitted', ...form.fields.map((f) => f.label)].map(cell).join(',')];
    for (const s of store.submissionsFor(form.id)) {
      lines.push([
        s.createdAt,
        ...form.fields.map((f) => {
          if (f.type === 'file') {
            return (s.files?.[f.id] || []).map((x) => `${baseUrl(req)}/admin/files/${s.id}/${x.id}`).join(' ');
          }
          const v = s.answers[f.id];
          return Array.isArray(v) ? v.join('; ') : v;
        }),
      ].map(cell).join(','));
    }
    res.attachment(`${slug(form.title)}-responses.csv`);
    res.type('text/csv').send('﻿' + lines.join('\r\n'));
  });

  app.get('/admin/forms/:id/files.zip', requireAdmin, loadForm, async (req, res) => {
    const form = req.form;
    res.attachment(`${slug(form.title)}-files.zip`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', (err) => res.destroy(err));
    zip.pipe(res);
    // Fetch one file at a time so a large form doesn't open every download at once.
    for (const s of store.submissionsFor(form.id)) {
      const folder = `${s.createdAt.replace(/[:.]/g, '-')}_${s.id}`;
      for (const f of form.fields.filter((x) => x.type === 'file')) {
        for (const file of s.files?.[f.id] || []) {
          const stream = await store.backend.getFile(file.storedName);
          if (!stream) continue;
          const added = new Promise((resolve, reject) => {
            zip.once('entry', resolve);
            stream.once('error', reject);
          });
          zip.append(stream, { name: `${folder}/${slug(f.label)}/${safeName(file.originalName)}` });
          await added;
        }
      }
    }
    await zip.finalize();
  });

  app.get('/admin/files/:subId/:fileId', requireAdmin, async (req, res) => {
    const sub = store.getSubmission(req.params.subId);
    const file = sub && Object.values(sub.files || {}).flat().find((f) => f.id === req.params.fileId);
    const stream = file && (await store.backend.getFile(file.storedName));
    if (!stream) return res.status(404).send(views.notFound());
    res.attachment(safeName(file.originalName));
    res.type('application/octet-stream');
    if (file.size) res.set('Content-Length', String(file.size));
    stream.on('error', (err) => res.destroy(err));
    stream.pipe(res);
  });

  app.post('/admin/submissions/:id/delete', requireAdmin, async (req, res) => {
    const sub = store.getSubmission(req.params.id);
    if (sub) await store.deleteSubmission(sub.id);
    res.redirect(sub ? `/admin/forms/${sub.formId}/responses` : '/admin');
  });

  // ---- Public form: no login, anyone with the link can respond ----
  app.get('/f/:id', loadForm, (req, res) => res.send(views.publicForm(req.form)));

  const tmpDir = backend.tmpDir;

  app.post('/f/:id', loadForm, (req, res) => {
    const form = req.form;
    if (!form.open) return res.status(403).send(views.publicForm(form));
    const fileFields = form.fields.filter((f) => f.type === 'file');
    const maxMb = Math.max(1, ...fileFields.map((f) => f.maxSizeMb));
    const upload = multer({
      storage: multer.diskStorage({
        destination: tmpDir,
        filename: (r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
      }),
      limits: {
        fileSize: maxMb * 1024 * 1024,
        files: fileFields.reduce((n, f) => n + f.maxFiles, 0) || 0,
        fields: 200,
        fieldSize: 100 * 1024,
      },
      fileFilter: (r, f, cb) => cb(null, fileFields.some((x) => x.id === f.fieldname)),
    }).any();

    upload(req, res, async (err) => {
      const uploaded = req.files || [];
      const cleanup = () => uploaded.forEach((f) => fs.rmSync(f.path, { force: true }));
      if (err) {
        cleanup();
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `A file is larger than ${maxMb} MB.`
          : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files attached.'
          : 'Upload failed. Please try again.';
        return res.status(400).send(views.publicForm(form, { formError: msg }));
      }
      // Multer decodes filenames as latin1; browsers send UTF-8.
      for (const f of uploaded) f.originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const byField = {};
      for (const f of uploaded) (byField[f.fieldname] ||= []).push(f);

      const { answers, errors } = validateSubmission(form, req.body || {}, byField);
      if (Object.keys(errors).length) {
        cleanup();
        const formError = fileFields.length ? 'Please fix the errors below. Attached files need to be selected again.' : 'Please fix the errors below.';
        return res.status(400).send(views.publicForm(form, { values: answers, errors, formError }));
      }

      const files = {};
      const stored = [];
      try {
        for (const [fieldId, list] of Object.entries(byField)) {
          files[fieldId] = [];
          for (const f of list) {
            await backend.putFile(f.filename, f.path, f.mimetype);
            stored.push(f.filename);
            files[fieldId].push({ id: Store.id(), storedName: f.filename, originalName: f.originalname, size: f.size, mimeType: f.mimetype });
          }
        }
        await store.addSubmission(form.id, answers, files);
      } catch (e) {
        console.error('Saving submission failed:', e);
        cleanup();
        await backend.deleteFiles(stored).catch(() => {});
        return res.status(500).send(views.publicForm(form, { values: answers, formError: 'Sorry, we could not save your response. Please try again.' }));
      }
      res.redirect(303, `/f/${form.id}/thanks`);
    });
  });
  app.get('/f/:id/thanks', loadForm, (req, res) => res.send(views.thanksPage(req.form)));

  app.use((req, res) => res.status(404).send(views.notFound()));
  return app;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'form';
}

function safeName(s) {
  return String(s).replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 200) || 'file';
}

module.exports = { createApp };

if (require.main === module) {
  if (!process.env.ADMIN_PASSWORD) {
    process.env.ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
    console.log(`No ADMIN_PASSWORD set. Generated one for this run: ${process.env.ADMIN_PASSWORD}`);
  }
  const port = Number(process.env.PORT) || 3000;
  createApp()
    .then((app) => app.listen(port, () => console.log(`Forms running at http://localhost:${port}/admin`)))
    .catch((e) => {
      console.error('Failed to start:', e.message);
      process.exit(1);
    });
}
