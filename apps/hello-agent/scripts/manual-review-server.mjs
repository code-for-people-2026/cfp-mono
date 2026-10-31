/** Local-only review store. Immutable answer fingerprints, optimistic revisions, fsynced history. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function createReviewServer({ site, storage, token, hosts = ['127.0.0.1', 'localhost'] }) {
  if (!/^[a-zA-Z0-9_-]{24,}$/.test(token)) throw Error('A random local access token is required');
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  const manifest = JSON.parse(fs.readFileSync(path.join(storage, 'manifest.json'), 'utf8'));
  const allowed = new Map(manifest.map(r => [r.id, r.hash]));
  const journal = path.join(storage, 'history.jsonl');
  const records = new Map();
  if (fs.existsSync(journal)) for (const line of fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line); records.set(`${entry.record.id}:${entry.record.outputSha256}`, entry);
  }
  const prefix = `/${token}/`;
  function publicState() { return { records: Object.fromEntries([...records.values()].filter(e => allowed.get(e.record.id) === e.record.outputSha256).map(e => [e.record.id, e])) }; }
  function append(record, revision) {
    const entry = { record, revision, savedAt: new Date().toISOString() };
    const fd = fs.openSync(journal, 'a', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(entry) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    records.set(`${record.id}:${record.outputSha256}`, entry);
    return entry;
  }
  for (const record of JSON.parse(fs.readFileSync(path.join(storage, 'seed.json'), 'utf8'))) {
    if (allowed.get(record.id) === record.outputSha256 && !records.has(`${record.id}:${record.outputSha256}`)) append(record, 1);
  }
  const server = http.createServer(async (req, res) => {
    const respond = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const host = req.headers.host || '';
      if (!hosts.includes(host.split(':')[0])) return respond(403, { error: '不允许的访问地址' });
      const address = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) && address !== '::1') return respond(403, { error: '仅限本机或家庭局域网' });
      if (!req.url?.startsWith(prefix)) return respond(404, { error: '页面不存在' });
      const route = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]);
      if (route === 'api/state' && req.method === 'GET') return respond(200, publicState());
      if (route === 'api/save' && req.method === 'POST') {
        if (req.headers.origin !== `http://${host}` || !req.headers['content-type']?.startsWith('application/json')) return respond(403, { error: '请在本地评阅页保存' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 32000) return respond(413, { error: '内容过长' }); }
        const { record, revision } = JSON.parse(raw);
        if (!record || allowed.get(record.id) !== record.outputSha256 || !['', '合格', '不合格', '需核查'].includes(record.refusal) || !['', '合格', '合格但需改进', '不合格', '需核查'].includes(record.overall) || typeof record.note !== 'string' || record.note.length > 12000 || typeof record.reviewer !== 'string' || record.reviewer.length > 100) return respond(400, { error: '题目指纹或评阅内容不匹配' });
        const previous = records.get(`${record.id}:${record.outputSha256}`);
        if (revision !== (previous?.revision || 0)) return respond(409, { error: '另一页面已修改本题。请刷新查看最新判断，再修改；本页输入仍暂存在浏览器。' });
        const clean = { id: record.id, outputSha256: record.outputSha256, refusal: record.refusal, overall: record.overall, note: record.note, reviewer: record.reviewer, reviewedAt: new Date().toISOString() };
        return respond(200, append(clean, revision + 1));
      }
      if (req.method !== 'GET') return respond(405, { error: '不支持此操作' });
      if (route && route !== 'index.html' && !/^images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(route) && !['分组分析说明.html', '1398条分组明细-20261031.csv'].includes(route)) return respond(404, { error: '文件不存在' });
      const file = path.join(site, route || 'index.html');
      if (!fs.existsSync(file)) return respond(404, { error: '文件不存在' });
      const type = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.csv': 'text/csv; charset=utf-8' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" });
      fs.createReadStream(file).pipe(res);
    } catch { respond(500, { error: '保存失败，请保留页面并重试；没有确认写入。' }); }
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  createReviewServer(config).listen(config.port, config.bind || '127.0.0.1', () => console.log('Local review ready'));
}
