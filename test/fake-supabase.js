// Minimal stand-in for the Supabase Storage REST API, used by the tests.
const http = require('http');

function startFakeSupabase(key) {
  const buckets = new Set();
  const objects = new Map(); // "bucket/path" -> { body, type }

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.headers.apikey !== key) return send(401, { error: 'bad key' });

    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (req.method === 'POST' && p === '/storage/v1/bucket') {
      const { id } = JSON.parse(body);
      if (buckets.has(id)) return send(400, { error: 'Duplicate' });
      buckets.add(id);
      return send(200, { name: id });
    }
    let m = p.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (m) {
      const [, bucket, obj] = m;
      if (!buckets.has(bucket)) return send(404, { error: 'Bucket not found' });
      const k = `${bucket}/${obj}`;
      if (req.method === 'POST') {
        if (objects.has(k) && req.headers['x-upsert'] !== 'true') return send(400, { error: 'Duplicate' });
        objects.set(k, { body, type: req.headers['content-type'] });
        return send(200, { Key: k });
      }
      if (req.method === 'GET') {
        const o = objects.get(k);
        if (!o) return send(400, { error: 'not_found' });
        res.writeHead(200, { 'Content-Type': o.type });
        return res.end(o.body);
      }
    }
    m = p.match(/^\/storage\/v1\/object\/([^/]+)$/);
    if (m && req.method === 'DELETE') {
      for (const prefix of JSON.parse(body).prefixes) objects.delete(`${m[1]}/${prefix}`);
      return send(200, []);
    }
    send(404, { error: 'unknown route' });
  });

  return new Promise((resolve) =>
    server.listen(0, () => resolve({ server, objects, url: `http://127.0.0.1:${server.address().port}` }))
  );
}

module.exports = { startFakeSupabase };
