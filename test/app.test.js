const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

let server, base, cookie, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-test-'));
  const app = createApp({ dataDir, adminPassword: 'secret', sessionSecret: 'x' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('admin pages require login', async () => {
  const res = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location'), /login/);
});

test('wrong password is rejected', async () => {
  const res = await fetch(`${base}/admin/login`, { method: 'POST', body: new URLSearchParams({ password: 'nope' }), redirect: 'manual' });
  assert.strictEqual(res.status, 401);
});

test('full flow: create form, anonymous submit with attachment, download it', async () => {
  const login = await fetch(`${base}/admin/login`, { method: 'POST', body: new URLSearchParams({ password: 'secret' }), redirect: 'manual' });
  assert.strictEqual(login.status, 302);
  cookie = login.headers.get('set-cookie').split(';')[0];

  const create = await fetch(`${base}/admin/api/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Job application',
      fields: [
        { id: 'name', type: 'text', label: 'Name', required: true },
        { id: 'cv', type: 'file', label: 'CV', required: true, accept: '.pdf,.txt', maxSizeMb: 1, maxFiles: 2 },
      ],
    }),
  });
  const { id } = await create.json();
  assert.ok(id);

  // Public page works without a cookie
  const page = await fetch(`${base}/f/${id}`);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /type="file"/);

  // Missing required file -> 400
  let fd = new FormData();
  fd.append('name', 'Ada');
  let res = await fetch(`${base}/f/${id}`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 400);
  assert.match(await res.text(), /Please attach a file/);

  // Disallowed extension -> 400, temp file cleaned up
  fd = new FormData();
  fd.append('name', 'Ada');
  fd.append('cv', new Blob(['MZ']), 'virus.exe');
  res = await fetch(`${base}/f/${id}`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(fs.readdirSync(path.join(dataDir, 'uploads', 'tmp')), []);

  // Too large -> 400
  fd = new FormData();
  fd.append('name', 'Ada');
  fd.append('cv', new Blob([Buffer.alloc(1024 * 1024 + 1)]), 'big.pdf');
  res = await fetch(`${base}/f/${id}`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 400);

  // Valid submission
  fd = new FormData();
  fd.append('name', 'Ada <b>Lovelace</b>');
  fd.append('cv', new Blob(['hello cv']), 'résumé.txt');
  res = await fetch(`${base}/f/${id}`, { method: 'POST', body: fd, redirect: 'manual' });
  assert.strictEqual(res.status, 303);

  const responses = await (await fetch(`${base}/admin/forms/${id}/responses`, { headers: { cookie } })).text();
  assert.match(responses, /Ada &lt;b&gt;Lovelace&lt;\/b&gt;/);
  assert.match(responses, /résumé\.txt/);
  const link = responses.match(/href="(\/admin\/files\/[^"]+)"/)[1];

  // File download requires admin
  assert.strictEqual((await fetch(base + link, { redirect: 'manual' })).status, 302);
  const dl = await fetch(base + link, { headers: { cookie } });
  assert.strictEqual(await dl.text(), 'hello cv');
  assert.match(dl.headers.get('content-disposition'), /attachment/);

  const csv = await (await fetch(`${base}/admin/forms/${id}/export.csv`, { headers: { cookie } })).text();
  assert.match(csv, /"Name","CV"/);
  assert.match(csv, /\/admin\/files\//);

  const zip = await fetch(`${base}/admin/forms/${id}/files.zip`, { headers: { cookie } });
  const buf = Buffer.from(await zip.arrayBuffer());
  assert.strictEqual(buf.subarray(0, 2).toString(), 'PK');

  // Deleting the form removes uploaded files
  await fetch(`${base}/admin/api/forms/${id}`, { method: 'DELETE', headers: { cookie } });
  const left = fs.readdirSync(path.join(dataDir, 'uploads')).filter((f) => f !== 'tmp');
  assert.deepStrictEqual(left, []);
});

test('closed form rejects submissions', async () => {
  const create = await fetch(`${base}/admin/api/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ title: 'Closed', open: false, fields: [{ id: 'a', type: 'text', label: 'A' }] }),
  });
  const { id } = await create.json();
  const fd = new FormData();
  fd.append('a', 'x');
  const res = await fetch(`${base}/f/${id}`, { method: 'POST', body: fd });
  assert.strictEqual(res.status, 403);
});
