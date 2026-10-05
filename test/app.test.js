const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { DiskBackend, SupabaseBackend } = require('../lib/backends');
const { startFakeSupabase } = require('./fake-supabase');

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function login(base) {
  const res = await fetch(`${base}/admin/login`, { method: 'POST', body: new URLSearchParams({ password: 'secret' }), redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  return res.headers.get('set-cookie').split(';')[0];
}

async function createForm(base, cookie, body) {
  const res = await fetch(`${base}/admin/api/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return (await res.json()).id;
}

const jobForm = {
  title: 'Job application',
  fields: [
    { id: 'name', type: 'text', label: 'Name', required: true },
    { id: 'cv', type: 'file', label: 'CV', required: true, accept: '.pdf,.txt', maxSizeMb: 1, maxFiles: 2 },
  ],
};

// The same end-to-end checks run against local-disk and Supabase storage.
function backendSuite(name, setup) {
  describe(`${name} storage`, () => {
    let ctx, server, base, cookie;

    before(async () => {
      ctx = await setup();
      ({ server, base } = await listen(await createApp({ backend: ctx.backend(), adminPassword: 'secret', sessionSecret: 'x' })));
    });
    after(async () => {
      server.close();
      await ctx.teardown();
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
      cookie = await login(base);
      const id = await createForm(base, cookie, jobForm);
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
      assert.deepStrictEqual(fs.readdirSync(ctx.tmpDir), []);

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
      assert.deepStrictEqual(fs.readdirSync(ctx.tmpDir), []);
      assert.strictEqual(ctx.storedFileCount(), 1);

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
      assert.ok(buf.includes(Buffer.from('résumé.txt')), 'zip contains the uploaded file');

      // Data survives a restart (a new app instance on the same storage)
      const restarted = await listen(await createApp({ backend: ctx.backend(), adminPassword: 'secret', sessionSecret: 'x' }));
      const again = await (await fetch(`${restarted.base}/admin/forms/${id}/responses`, { headers: { cookie } })).text();
      restarted.server.close();
      assert.match(again, /résumé\.txt/);

      // Deleting the form removes uploaded files
      await fetch(`${base}/admin/api/forms/${id}`, { method: 'DELETE', headers: { cookie } });
      assert.strictEqual(ctx.storedFileCount(), 0);
    });

    test('closed form rejects submissions', async () => {
      const id = await createForm(base, cookie, { title: 'Closed', open: false, fields: [{ id: 'a', type: 'text', label: 'A' }] });
      const fd = new FormData();
      fd.append('a', 'x');
      const res = await fetch(`${base}/f/${id}`, { method: 'POST', body: fd });
      assert.strictEqual(res.status, 403);
    });
  });
}

backendSuite('disk', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-test-'));
  return {
    backend: () => new DiskBackend(dataDir),
    tmpDir: path.join(dataDir, 'uploads', 'tmp'),
    storedFileCount: () => fs.readdirSync(path.join(dataDir, 'uploads')).filter((f) => f !== 'tmp').length,
    teardown: async () => fs.rmSync(dataDir, { recursive: true, force: true }),
  };
});

backendSuite('supabase', async () => {
  const fake = await startFakeSupabase('sb_secret_test');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-sb-tmp-'));
  return {
    backend: () => new SupabaseBackend({ url: fake.url, key: 'sb_secret_test', tmpDir }),
    tmpDir,
    storedFileCount: () => [...fake.objects.keys()].filter((k) => k.startsWith('forms/uploads/')).length,
    teardown: async () => {
      fake.server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
});

test('supabase backend reports a wrong key clearly', async () => {
  const fake = await startFakeSupabase('right');
  try {
    await assert.rejects(
      createApp({ backend: new SupabaseBackend({ url: fake.url, key: 'wrong', tmpDir: os.tmpdir() }), adminPassword: 'x' }),
      /401/
    );
  } finally {
    fake.server.close();
  }
});

test('supabase backend refuses to start on an unexpected storage error', async () => {
  const http = require('http');
  const server = http.createServer((req, res) => {
    res.writeHead(req.url.endsWith('/bucket') ? 409 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'InvalidRequest' }));
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const backend = new SupabaseBackend({ url: `http://127.0.0.1:${server.address().port}`, key: 'k', tmpDir: os.tmpdir() });
    await assert.rejects(createApp({ backend, adminPassword: 'x' }), /InvalidRequest/);
  } finally {
    server.close();
  }
});
