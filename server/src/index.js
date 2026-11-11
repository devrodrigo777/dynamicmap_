import express from 'express';
import multer from 'multer';
import { imageSize } from 'image-size';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, UPLOAD_DIR } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '../../client/dist');
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---------- utilidades ----------
const httpError = (status, message) => Object.assign(new Error(message), { status });
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    EXT[file.mimetype]
      ? cb(null, true)
      : cb(httpError(400, 'Formato não suportado. Use PNG, JPG, WebP, SVG ou GIF.')),
});

function saveImage(file) {
  if (!file) throw httpError(400, 'Nenhuma imagem enviada.');
  let size;
  try {
    size = imageSize(file.buffer);
  } catch {
    throw httpError(400, 'Não foi possível ler a imagem. O arquivo pode estar corrompido.');
  }
  if (!size?.width || !size?.height) throw httpError(400, 'Não foi possível descobrir o tamanho da imagem.');
  const name = crypto.randomUUID() + EXT[file.mimetype];
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return { image: `/uploads/${name}`, width: size.width, height: size.height };
}

function removeImage(url) {
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(url)));
  } catch {
    /* arquivo já não existe */
  }
}

// ---------- acesso a dados ----------
const q = {
  list: db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM areas a WHERE a.map_id = m.id) AS area_count
    FROM maps m ORDER BY m.is_root DESC, m.name COLLATE NOCASE`),
  one: db.prepare('SELECT * FROM maps WHERE id = ?'),
  root: db.prepare('SELECT * FROM maps ORDER BY is_root DESC, id ASC LIMIT 1'),
  count: db.prepare('SELECT COUNT(*) AS n FROM maps'),
  areas: db.prepare('SELECT * FROM areas WHERE map_id = ? ORDER BY sort_order, id'),
  insertMap: db.prepare('INSERT INTO maps (name, image, width, height, is_root) VALUES (?, ?, ?, ?, ?)'),
  insertArea: db.prepare(`
    INSERT INTO areas (map_id, name, code, description, points, color, opacity, show_label, target_map_id, sort_order)
    VALUES (@map_id, @name, @code, @description, @points, @color, @opacity, @show_label, @target_map_id, @sort_order)`),
};

const mapOut = (m) => ({ ...m, is_root: !!m.is_root });
const areaOut = (a) => ({ ...a, points: JSON.parse(a.points), show_label: !!a.show_label });
const withAreas = (m) => (m ? { ...mapOut(m), areas: q.areas.all(m.id).map(areaOut) } : null);

function cleanArea(a, mapId, validIds, index) {
  const points = (Array.isArray(a.points) ? a.points : [])
    .map((p) => [clamp(Number(p?.[0]), 0, 1), clamp(Number(p?.[1]), 0, 1)])
    .filter((p) => p.every(Number.isFinite));
  if (points.length < 3) throw httpError(400, 'Cada área precisa de pelo menos 3 pontos.');
  const target = Number(a.target_map_id);
  const opacity = Number(a.opacity);
  return {
    map_id: mapId,
    name: String(a.name ?? '').slice(0, 120),
    code: String(a.code ?? '').slice(0, 60),
    description: String(a.description ?? '').slice(0, 4000),
    points: JSON.stringify(points),
    color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#2B5C8F',
    opacity: Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 0.25,
    show_label: a.show_label ? 1 : 0,
    target_map_id: target !== mapId && validIds.has(target) ? target : null,
    sort_order: index,
  };
}

// ---------- rotas ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/maps', (_req, res) => res.json(q.list.all().map(mapOut)));

app.get('/api/maps/root', (_req, res) => res.json(withAreas(q.root.get())));

app.get('/api/maps/:id', (req, res) => {
  const map = withAreas(q.one.get(Number(req.params.id)));
  if (!map) throw httpError(404, 'Planta não encontrada.');
  res.json(map);
});

app.post('/api/maps', upload.single('image'), (req, res) => {
  const img = saveImage(req.file);
  const name = String(req.body.name || 'Nova planta').trim().slice(0, 120) || 'Nova planta';
  const isRoot = q.count.get().n === 0 ? 1 : 0;
  const id = q.insertMap.run(name, img.image, img.width, img.height, isRoot).lastInsertRowid;
  res.status(201).json(withAreas(q.one.get(id)));
});

app.patch('/api/maps/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!q.one.get(id)) throw httpError(404, 'Planta não encontrada.');
  db.transaction(() => {
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      db.prepare("UPDATE maps SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(req.body.name.trim().slice(0, 120), id);
    }
    if (req.body.is_root === true) {
      db.prepare('UPDATE maps SET is_root = 0').run();
      db.prepare('UPDATE maps SET is_root = 1 WHERE id = ?').run(id);
    }
  })();
  res.json(withAreas(q.one.get(id)));
});

app.put('/api/maps/:id/image', upload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  const old = q.one.get(id);
  if (!old) throw httpError(404, 'Planta não encontrada.');
  const img = saveImage(req.file);
  db.prepare("UPDATE maps SET image = ?, width = ?, height = ?, updated_at = datetime('now') WHERE id = ?")
    .run(img.image, img.width, img.height, id);
  removeImage(old.image);
  res.json(withAreas(q.one.get(id)));
});

app.delete('/api/maps/:id', (req, res) => {
  const id = Number(req.params.id);
  const map = q.one.get(id);
  if (!map) throw httpError(404, 'Planta não encontrada.');
  db.transaction(() => {
    db.prepare('DELETE FROM maps WHERE id = ?').run(id);
    if (map.is_root) {
      const next = db.prepare('SELECT id FROM maps ORDER BY id LIMIT 1').get();
      if (next) db.prepare('UPDATE maps SET is_root = 1 WHERE id = ?').run(next.id);
    }
  })();
  removeImage(map.image);
  res.status(204).end();
});

// Substitui todas as áreas da planta de uma vez (o editor salva o conjunto completo).
app.put('/api/maps/:id/areas', (req, res) => {
  const id = Number(req.params.id);
  if (!q.one.get(id)) throw httpError(404, 'Planta não encontrada.');
  if (!Array.isArray(req.body.areas)) throw httpError(400, 'Formato inválido.');
  const validIds = new Set(q.list.all().map((m) => m.id));
  const rows = req.body.areas.map((a, i) => cleanArea(a, id, validIds, i));
  db.transaction(() => {
    db.prepare('DELETE FROM areas WHERE map_id = ?').run(id);
    rows.forEach((r) => q.insertArea.run(r));
    db.prepare("UPDATE maps SET updated_at = datetime('now') WHERE id = ?").run(id);
  })();
  res.json(withAreas(q.one.get(id)));
});

app.use('/api', (_req, _res, next) => next(httpError(404, 'Rota não encontrada.')));

// ---------- arquivos estáticos ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true }));

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/(api|uploads)\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// ---------- erros ----------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status === 500) console.error(err);
  const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
    ? 'Imagem muito grande (máximo 60 MB).'
    : status === 500 ? 'Erro interno do servidor.' : err.message;
  res.status(status).json({ error: message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Mapa da fábrica rodando em http://localhost:${PORT}`);
  console.log(`  Painel admin:           http://localhost:${PORT}/admin`);
  if (!fs.existsSync(CLIENT_DIST)) console.log('  (client/dist não encontrado: rode "npm run build" ou use "npm run dev")');
  console.log();
});
