const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');

const app = express();
const PORT = 3000;

const CATALOGO_RETRABAJOS = {
  calzado:    ['Cambio de caja', 'Limpieza', 'Reparación de caja', 'Impresión de etiqueta'],
  textil:     ['Cambio de etiqueta', 'Limpieza', 'Reparación de costura', 'Planchado', 'Re-empaque'],
  traje_bano: ['Cambio de etiqueta', 'Limpieza', 'Re-empaque', 'Revisión de elástico'],
  sombreros:  ['Cambio de etiqueta', 'Limpieza', 'Reparación de forma', 'Re-empaque'],
};

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

// Multer config para fotos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// DB en memoria con persistencia en archivo
const DB_PATH = path.join(__dirname, 'database.bin');
let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      grado_confianza INTEGER NOT NULL DEFAULT 2,
      porcentaje_muestreo REAL DEFAULT 30,
      modulo_calidad INTEGER DEFAULT 0,
      modulo_retrabajo INTEGER DEFAULT 0,
      tipo_almacenamiento TEXT DEFAULT 'caja',
      requiere_orden INTEGER DEFAULT 0,
      requiere_tipo_retorno INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.run("ALTER TABLE clientes ADD COLUMN tipo_almacenamiento TEXT DEFAULT 'caja'"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN uph INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN tipo_mercancia TEXT DEFAULT 'textil'"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN fotos_adicionales INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN requiere_orden INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN requiere_tipo_retorno INTEGER DEFAULT 0"); } catch(e) {}

  // Materializar valores NULL de columnas migradas (sql.js omite undefined en JSON)
  db.run("UPDATE clientes SET tipo_almacenamiento = 'caja'   WHERE tipo_almacenamiento IS NULL");
  db.run("UPDATE clientes SET uph               = 0          WHERE uph IS NULL");
  db.run("UPDATE clientes SET tipo_mercancia    = 'textil'   WHERE tipo_mercancia IS NULL");
  db.run("UPDATE clientes SET fotos_adicionales = 0          WHERE fotos_adicionales IS NULL");
  db.run("UPDATE clientes SET requiere_orden = 0            WHERE requiere_orden IS NULL");
  db.run("UPDATE clientes SET requiere_tipo_retorno = 0     WHERE requiere_tipo_retorno IS NULL");

  console.log('📋 Columnas clientes:', db.exec("PRAGMA table_info(clientes)")[0]?.values.map(r=>r[1]).join(', '));

  db.run(`
    CREATE TABLE IF NOT EXISTS skus (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      descripcion TEXT,
      pais_origen TEXT,
      insumos TEXT,
      upc_code TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);
  // Migración: agregar upc_code si la tabla ya existía sin esa columna
  try { db.run('ALTER TABLE skus ADD COLUMN upc_code TEXT'); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS trackings (
      id TEXT PRIMARY KEY,
      tracking_number TEXT NOT NULL UNIQUE,
      cliente_id TEXT NOT NULL,
      caja_id TEXT NOT NULL,
      operador TEXT DEFAULT 'Operador',
      cantidad_declarada INTEGER DEFAULT 0,
      cantidad_final INTEGER DEFAULT 0,
      estatus TEXT DEFAULT 'abierto',
      numero_orden TEXT,
      tipo_retorno TEXT,
      razon_retorno TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS detalle_skus (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      sku_id TEXT,
      sku_code TEXT NOT NULL,
      descripcion TEXT,
      cantidad INTEGER DEFAULT 1,
      pais_origen_catalogo TEXT,
      pais_origen_real TEXT,
      pais_coincide INTEGER DEFAULT 1,
      insumos_catalogo TEXT,
      insumos_real TEXT,
      insumos_coincide INTEGER DEFAULT 1,
      calidad TEXT DEFAULT 'Buena',
      foto_etiqueta TEXT,
      foto_insumos TEXT,
      foto_pieza TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);

  // Columna impresa en trackings
  try { db.run('ALTER TABLE trackings ADD COLUMN impresa INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run('ALTER TABLE trackings ADD COLUMN numero_orden TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE trackings ADD COLUMN tipo_retorno TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE trackings ADD COLUMN razon_retorno TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN foto_etiqueta TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN foto_insumos TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN foto_pieza TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_1 TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_2 TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_3 TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_4 TEXT'); } catch(e) {}
  // Materializar NULLs de columnas migradas en trackings
  db.run("UPDATE trackings SET impresa = 0 WHERE impresa IS NULL");

  db.run(`
    CREATE TABLE IF NOT EXISTS errores (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      detalle_sku_id TEXT,
      tipo_error TEXT NOT NULL,
      path_fotografia TEXT,
      comentarios TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alertas_discrepancia (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      cantidad_original INTEGER,
      cantidad_corregida INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cajas_pallets (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL,
      nombre TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL,
      consecutivo INTEGER NOT NULL,
      estatus TEXT DEFAULT 'Abierta',
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);
  try { db.run('ALTER TABLE trackings ADD COLUMN caja_pallet_id TEXT'); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS retrabajos (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      detalle_sku_id TEXT,
      cliente_id TEXT NOT NULL,
      sku_code TEXT,
      descripcion_sku TEXT,
      retrabajos_seleccionados TEXT DEFAULT '[]',
      retrabajo_otro TEXT,
      estatus TEXT DEFAULT 'Pendiente',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);
  try { db.run('ALTER TABLE retrabajos ADD COLUMN detalle_sku_id TEXT'); } catch(e) {}
  try { db.run('ALTER TABLE retrabajos ADD COLUMN retrabajo_otro TEXT'); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS foto_sesiones (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      tracking_id TEXT,
      detalle_sku_id TEXT,
      contexto TEXT,
      estatus TEXT DEFAULT 'pendiente',
      url_foto TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);
  db.run("DELETE FROM foto_sesiones WHERE expires_at < datetime('now')");

  db.run(`
    CREATE TABLE IF NOT EXISTS skus_nuevos (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      detalle_sku_id TEXT,
      cliente_id TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      upc TEXT,
      descripcion TEXT,
      pais_origen TEXT,
      insumos TEXT,
      url_foto_etiqueta TEXT,
      url_foto_insumos_origen TEXT,
      url_foto_producto_completo TEXT,
      operador TEXT,
      dado_de_alta INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.run('ALTER TABLE detalle_skus ADD COLUMN es_nuevo INTEGER DEFAULT 0'); } catch(e) {}

  saveDB();

  // Datos demo
  const check = db.exec("SELECT COUNT(*) as cnt FROM clientes");
  if (check[0].values[0][0] === 0) {
    seedData();
  }

  console.log('✅ Base de datos inicializada');
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function seedData() {
  const clientes = [
    { id: uuidv4(), nombre: 'Textiles Express SA', grado: 1, pct: 30, calidad: 0, retrabajo: 0 },
    { id: uuidv4(), nombre: 'Moda Global MX', grado: 2, pct: 30, calidad: 1, retrabajo: 0 },
    { id: uuidv4(), nombre: 'Confecciones Premium', grado: 3, pct: 100, calidad: 1, retrabajo: 1 },
  ];

  clientes.forEach(c => {
    db.run(`INSERT INTO clientes VALUES (?,?,?,?,?,?,datetime('now'))`,
      [c.id, c.nombre, c.grado, c.pct, c.calidad, c.retrabajo]);

    // SKUs demo por cliente
    const skusDemo = [
      { id: uuidv4(), code: `SKU-${c.nombre.substring(0,3).toUpperCase()}-001`, desc: 'Camisa Básica', pais: 'China', insumos: '100% Algodón' },
      { id: uuidv4(), code: `SKU-${c.nombre.substring(0,3).toUpperCase()}-002`, desc: 'Pantalón Slim', pais: 'Bangladesh', insumos: '65% Poliéster 35% Algodón' },
      { id: uuidv4(), code: `SKU-${c.nombre.substring(0,3).toUpperCase()}-003`, desc: 'Vestido Floral', pais: 'Vietnam', insumos: '100% Viscosa' },
    ];
    skusDemo.forEach(s => {
      db.run(`INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code) VALUES (?,?,?,?,?,?,?)`,
        [s.id, c.id, s.code, s.desc, s.pais, s.insumos, null]);
    });
  });

  saveDB();
  console.log('✅ Datos demo insertados');
}

function dbAll(sql, params = []) {
  try {
    const result = db.exec(sql, params);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
  } catch (e) {
    console.error('DB Error:', e.message, sql);
    return [];
  }
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows[0] || null;
}

function dbRun(sql, params = []) {
  try {
    db.run(sql, params);
    saveDB();
    return true;
  } catch (e) {
    console.error('DB Run Error:', e.message);
    return false;
  }
}

function generarNombreCaja(clienteNombre, tipo, consecutivo) {
  const iniciales = clienteNombre.replace(/\s+/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
  const abr = { 'Damage': 'DMG', 'Good Condition': 'GDC', 'Non-brand merchandise': 'NBM' }[tipo] || 'UNK';
  return `${iniciales}-${abr}-${String(consecutivo).padStart(3, '0')}`;
}

// ===================== RUTAS API =====================

// --- CLIENTES ---
app.get('/api/clientes', (req, res) => {
  const rows = dbAll('SELECT * FROM clientes ORDER BY nombre');
  res.json(rows);
});

app.get('/api/clientes/:id', (req, res) => {
  const row = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(row);
});

app.post('/api/clientes', (req, res) => {
  const { nombre, grado_confianza, porcentaje_muestreo, modulo_calidad, modulo_retrabajo, tipo_almacenamiento, uph, tipo_mercancia, fotos_adicionales, requiere_orden, requiere_tipo_retorno } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const id = uuidv4();
  const grado = parseInt(grado_confianza) || 2;
  const fa = grado === 3 ? Math.max(0, Math.min(4, parseInt(fotos_adicionales) || 0)) : 0;
  console.log(`POST /clientes → nombre="${nombre}" grado=${grado} fotos_adicionales=${fa}`);
  const ok = dbRun(`INSERT INTO clientes (id,nombre,grado_confianza,porcentaje_muestreo,modulo_calidad,modulo_retrabajo,tipo_almacenamiento,uph,tipo_mercancia,fotos_adicionales,requiere_orden,requiere_tipo_retorno) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, nombre, grado, porcentaje_muestreo || 30, modulo_calidad ? 1 : 0, modulo_retrabajo ? 1 : 0, tipo_almacenamiento || 'caja', uph || 0, tipo_mercancia || 'textil', fa, requiere_orden ? 1 : 0, requiere_tipo_retorno ? 1 : 0]);
  if (!ok) return res.status(500).json({ error: 'Error al guardar en base de datos' });
  res.json({ id, mensaje: 'Cliente creado' });
});

app.put('/api/clientes/:id', (req, res) => {
  const { nombre, grado_confianza, porcentaje_muestreo, modulo_calidad, modulo_retrabajo, tipo_almacenamiento, uph, tipo_mercancia, fotos_adicionales, requiere_orden, requiere_tipo_retorno } = req.body;
  const grado = parseInt(grado_confianza) || 2;
  const fa = grado === 3 ? Math.max(0, Math.min(4, parseInt(fotos_adicionales) || 0)) : 0;
  console.log(`PUT /clientes/${req.params.id} → grado=${grado} fotos_adicionales=${fa}`);
  const ok = dbRun(`UPDATE clientes SET nombre=?,grado_confianza=?,porcentaje_muestreo=?,modulo_calidad=?,modulo_retrabajo=?,tipo_almacenamiento=?,uph=?,tipo_mercancia=?,fotos_adicionales=?,requiere_orden=?,requiere_tipo_retorno=? WHERE id=?`,
    [nombre, grado, porcentaje_muestreo || 30, modulo_calidad ? 1 : 0, modulo_retrabajo ? 1 : 0, tipo_almacenamiento || 'caja', uph || 0, tipo_mercancia || 'textil', fa, requiere_orden ? 1 : 0, requiere_tipo_retorno ? 1 : 0, req.params.id]);
  if (!ok) return res.status(500).json({ error: 'Error al guardar en base de datos — revisa la consola del servidor' });
  const updated = dbGet('SELECT * FROM clientes WHERE id=?', [req.params.id]);
  console.log(`  → guardado: fotos_adicionales=${updated?.fotos_adicionales}`);
  res.json({ mensaje: 'Cliente actualizado' });
});

app.delete('/api/clientes/:id', (req, res) => {
  const totalTrackings = dbGet('SELECT COUNT(*) as cnt FROM trackings WHERE cliente_id=?', [req.params.id]);
  if ((totalTrackings?.cnt || 0) > 0) {
    return res.status(400).json({ error: `No se puede eliminar: el cliente tiene ${totalTrackings.cnt} tracking(s) registrado(s).` });
  }
  dbRun('DELETE FROM clientes WHERE id=?', [req.params.id]);
  res.json({ mensaje: 'Cliente eliminado' });
});

// --- SKUs ---
app.get('/api/skus', (req, res) => {
  const { cliente_id } = req.query;
  let sql = 'SELECT * FROM skus';
  let params = [];
  if (cliente_id) { sql += ' WHERE cliente_id = ?'; params = [cliente_id]; }
  res.json(dbAll(sql, params));
});

app.get('/api/skus/buscar/:code', (req, res) => {
  const { cliente_id } = req.query;
  const code = req.params.code;
  // Busca por UPC primero, luego por SKU code
  let sql = 'SELECT * FROM skus WHERE (upc_code = ? OR sku_code = ?)';
  let params = [code, code];
  if (cliente_id) { sql += ' AND cliente_id = ?'; params.push(cliente_id); }
  sql += ' ORDER BY (upc_code = ?) DESC LIMIT 1';
  params.push(code);
  const row = dbGet(sql, params);
  res.json(row || null);
});

app.post('/api/skus', (req, res) => {
  const { cliente_id, sku_code, upc_code, descripcion, pais_origen, insumos } = req.body;
  if (!cliente_id || !sku_code) return res.status(400).json({ error: 'cliente_id y sku_code requeridos' });
  const code = (sku_code || '').trim().toUpperCase();
  const existing = dbGet('SELECT id FROM skus WHERE sku_code=? AND cliente_id=?', [code, cliente_id]);
  if (existing) return res.json({ id: existing.id, mensaje: 'SKU ya existe' });
  const id = uuidv4();
  dbRun(`INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code) VALUES (?,?,?,?,?,?,?)`,
    [id, cliente_id, code, descripcion, pais_origen, insumos, upc_code || null]);
  res.json({ id, mensaje: 'SKU creado' });
});

app.post('/api/skus/importar', (req, res) => {
  const { cliente_id, skus } = req.body;
  if (!cliente_id || !Array.isArray(skus) || skus.length === 0)
    return res.status(400).json({ error: 'cliente_id y skus son requeridos' });

  let insertados = 0;
  let omitidos = 0;
  skus.forEach(s => {
    const sku_code = (s.sku_code || '').trim().toUpperCase();
    if (!sku_code) { omitidos++; return; }
    const existe = dbGet('SELECT id FROM skus WHERE sku_code=? AND cliente_id=?', [sku_code, cliente_id]);
    if (existe) { omitidos++; return; }
    const id = uuidv4();
    dbRun('INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code) VALUES (?,?,?,?,?,?,?)', [
      id, cliente_id, sku_code,
      (s.descripcion || '').trim(),
      (s.pais_origen || '').trim(),
      (s.insumos || '').trim(),
      (s.upc_code || '').trim() || null
    ]);
    insertados++;
  });
  res.json({ insertados, omitidos });
});

app.put('/api/skus/:id', (req, res) => {
  const { cliente_id, sku_code, upc_code, descripcion, pais_origen, insumos } = req.body;
  dbRun(`UPDATE skus SET cliente_id=?,sku_code=?,descripcion=?,pais_origen=?,insumos=?,upc_code=? WHERE id=?`,
    [cliente_id, sku_code, descripcion, pais_origen, insumos, upc_code || null, req.params.id]);
  res.json({ mensaje: 'SKU actualizado' });
});

app.delete('/api/skus/:id', (req, res) => {
  dbRun('DELETE FROM skus WHERE id=?', [req.params.id]);
  res.json({ mensaje: 'SKU eliminado' });
});

// --- CAJAS / PALLETS ---
app.get('/api/cajas', (req, res) => {
  const { cliente_id, tipo, estatus } = req.query;
  let sql = `SELECT cp.*, c.nombre as cliente_nombre FROM cajas_pallets cp JOIN clientes c ON cp.cliente_id = c.id WHERE 1=1`;
  const params = [];
  if (cliente_id) { sql += ' AND cp.cliente_id = ?'; params.push(cliente_id); }
  if (tipo)       { sql += ' AND cp.tipo = ?'; params.push(tipo); }
  if (estatus)    { sql += ' AND cp.estatus = ?'; params.push(estatus); }
  sql += ' ORDER BY cp.created_at DESC';
  res.json(dbAll(sql, params));
});

app.get('/api/cajas/validar', (req, res) => {
  const { cliente_id, caja_id } = req.query;
  const caja = dbGet('SELECT * FROM cajas_pallets WHERE id = ?', [caja_id]);
  if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
  if (caja.cliente_id !== cliente_id) return res.status(400).json({ error: 'La caja no pertenece a este cliente' });
  if (caja.estatus !== 'Abierta') return res.status(400).json({ error: 'La caja está cerrada' });
  res.json({ valida: true, caja });
});

app.get('/api/cajas/:id/qr', (req, res) => {
  const caja = dbGet('SELECT nombre FROM cajas_pallets WHERE id = ?', [req.params.id]);
  if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
  res.json({ qr_text: caja.nombre });
});

app.get('/api/cajas/:id', (req, res) => {
  const row = dbGet(`SELECT cp.*, c.nombre as cliente_nombre FROM cajas_pallets cp JOIN clientes c ON cp.cliente_id = c.id WHERE cp.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Caja no encontrada' });
  res.json(row);
});

app.post('/api/cajas', (req, res) => {
  const { cliente_id, tipo } = req.body;
  if (!cliente_id || !tipo) return res.status(400).json({ error: 'cliente_id y tipo son requeridos' });
  if (!['Damage', 'Good Condition', 'Non-brand merchandise'].includes(tipo))
    return res.status(400).json({ error: 'Tipo no válido' });

  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [cliente_id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  const lastCons = dbGet('SELECT MAX(consecutivo) as max FROM cajas_pallets WHERE cliente_id = ? AND tipo = ?', [cliente_id, tipo]);
  const consecutivo = (lastCons?.max || 0) + 1;
  const nombre = generarNombreCaja(cliente.nombre, tipo, consecutivo);

  const id = uuidv4();
  dbRun('INSERT INTO cajas_pallets (id,cliente_id,nombre,tipo,consecutivo,estatus) VALUES (?,?,?,?,?,?)',
    [id, cliente_id, nombre, tipo, consecutivo, 'Abierta']);

  const created = dbGet(`SELECT cp.*, c.nombre as cliente_nombre FROM cajas_pallets cp JOIN clientes c ON cp.cliente_id = c.id WHERE cp.id = ?`, [id]);
  res.json(created);
});

app.put('/api/cajas/:id/cerrar', (req, res) => {
  const caja = dbGet('SELECT * FROM cajas_pallets WHERE id = ?', [req.params.id]);
  if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
  if (caja.estatus === 'Cerrada') return res.status(400).json({ error: 'La caja ya está cerrada' });
  dbRun("UPDATE cajas_pallets SET estatus='Cerrada', closed_at=datetime('now') WHERE id=?", [req.params.id]);
  res.json({ mensaje: 'Caja cerrada' });
});

// Reporte por tipo de caja
app.get('/api/reportes/tipo-caja', (req, res) => {
  const { cliente_id, tipo, fecha_desde, fecha_hasta } = req.query;
  let sql = `
    SELECT cp.id, cp.nombre, cp.tipo, cp.consecutivo, cp.estatus,
           cp.created_at, cp.closed_at,
           c.nombre as cliente_nombre,
           COUNT(DISTINCT t.id)         as num_trackings,
           COUNT(DISTINCT d.id)         as num_skus,
           COALESCE(SUM(d.cantidad), 0) as total_piezas
    FROM cajas_pallets cp
    JOIN clientes c ON cp.cliente_id = c.id
    LEFT JOIN trackings t ON t.caja_pallet_id = cp.id
    LEFT JOIN detalle_skus d ON d.tracking_id = t.id
    WHERE 1=1
  `;
  const params = [];
  if (cliente_id)  { sql += ' AND cp.cliente_id = ?'; params.push(cliente_id); }
  if (tipo)        { sql += ' AND cp.tipo = ?'; params.push(tipo); }
  if (fecha_desde) { sql += " AND date(cp.created_at) >= ?"; params.push(fecha_desde); }
  if (fecha_hasta) { sql += " AND date(cp.created_at) <= ?"; params.push(fecha_hasta); }
  sql += ' GROUP BY cp.id ORDER BY cp.tipo, cp.created_at DESC';
  res.json(dbAll(sql, params));
});

// --- TRACKINGS ---
app.get('/api/trackings', (req, res) => {
  const rows = dbAll(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza, c.modulo_calidad, c.modulo_retrabajo, c.porcentaje_muestreo, c.tipo_almacenamiento, c.tipo_mercancia, c.fotos_adicionales, c.requiere_orden, c.requiere_tipo_retorno
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    ORDER BY t.created_at DESC
  `);
  res.json(rows);
});

app.get('/api/trackings/:id', (req, res) => {
  const row = dbGet(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza, c.modulo_calidad, c.modulo_retrabajo, c.porcentaje_muestreo, c.tipo_almacenamiento, c.tipo_mercancia, c.fotos_adicionales, c.requiere_orden, c.requiere_tipo_retorno
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE t.id = ?
  `, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Tracking no encontrado' });
  res.json(row);
});

app.post('/api/trackings', (req, res) => {
  const { tracking_number, cliente_id, operador, cantidad_declarada, numero_orden, tipo_retorno, razon_retorno } = req.body;
  if (!tracking_number || !cliente_id) {
    return res.status(400).json({ error: 'tracking_number y cliente_id son requeridos' });
  }

  const existing = dbGet('SELECT id FROM trackings WHERE tracking_number = ?', [tracking_number]);
  if (existing) return res.status(400).json({ error: 'Tracking number ya registrado' });

  const id = uuidv4();
  dbRun(`INSERT INTO trackings (id,tracking_number,cliente_id,caja_id,caja_pallet_id,operador,cantidad_declarada,cantidad_final,numero_orden,tipo_retorno,razon_retorno) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tracking_number, cliente_id, '', null, operador || 'Operador', cantidad_declarada || 0, cantidad_declarada || 0, numero_orden || null, tipo_retorno || null, razon_retorno || null]);
  res.json({ id, mensaje: 'Tracking creado' });
});

app.put('/api/trackings/:id', (req, res) => {
  const { cantidad_final, estatus } = req.body;
  dbRun(`UPDATE trackings SET cantidad_final=?, estatus=? WHERE id=?`,
    [cantidad_final, estatus, req.params.id]);
  res.json({ mensaje: 'Tracking actualizado' });
});

// Cerrar tracking
app.post('/api/trackings/:id/cerrar', (req, res) => {
  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });

  // Validar que no esté vacío (SKUs o mercancía ajena)
  const totalSkus = dbGet('SELECT COUNT(*) as cnt FROM detalle_skus WHERE tracking_id=?', [req.params.id]);
  const tieneMercanciaAjena = dbGet(`SELECT id FROM errores WHERE tracking_id=? AND tipo_error='Mercancía ajena' LIMIT 1`, [req.params.id]);
  if ((totalSkus?.cnt || 0) === 0 && !tieneMercanciaAjena) {
    return res.status(400).json({ error: 'No se puede cerrar un tracking vacío. Registra al menos un SKU o marca el producto como no correspondiente al cliente.' });
  }

  // Validar errores sin foto
  const erroresSinFoto = dbAll(`
    SELECT * FROM errores WHERE tracking_id=? AND (path_fotografia IS NULL OR path_fotografia='')
  `, [req.params.id]);

  if (erroresSinFoto.length > 0) {
    return res.status(400).json({ error: 'Hay errores sin fotografía de evidencia. No se puede cerrar.' });
  }

  const { caja_pallet_id } = req.body;
  if (!caja_pallet_id) {
    return res.status(400).json({ error: 'Selecciona una caja/pallet para cerrar el tracking' });
  }
  const caja = dbGet('SELECT * FROM cajas_pallets WHERE id = ?', [caja_pallet_id]);
  if (!caja) return res.status(400).json({ error: 'Caja no encontrada' });
  if (caja.cliente_id !== tracking.cliente_id) return res.status(400).json({ error: 'La caja no pertenece a este cliente' });
  if (caja.estatus !== 'Abierta') return res.status(400).json({ error: 'La caja está cerrada' });

  // Validar que el tipo de caja corresponda al contenido del tracking
  const erroresTracking = dbAll('SELECT tipo_error FROM errores WHERE tracking_id=?', [req.params.id]);
  const tieneDanado  = erroresTracking.some(e => e.tipo_error === 'Calidad' || e.tipo_error === 'Otro');
  const tieneNoMarca = erroresTracking.some(e => e.tipo_error === 'Mercancía ajena');
  const tieneRetrabajos = (dbGet('SELECT COUNT(*) as cnt FROM retrabajos WHERE tracking_id=?', [req.params.id])?.cnt || 0) > 0;
  // Piezas dañadas con retrabajo asignado se corrigen → Good Condition
  const tipoRequerido = (tieneDanado && !tieneRetrabajos) ? 'Damage'
    : tieneNoMarca ? 'Non-brand merchandise'
    : 'Good Condition';

  if (caja.tipo !== tipoRequerido) {
    const labels = { 'Damage': 'Dañado (Damage)', 'Good Condition': 'Buen Estado (Good Condition)', 'Non-brand merchandise': 'Sin Marca (Non-brand)' };
    return res.status(400).json({ error: `Este tracking debe guardarse en una caja de tipo "${labels[tipoRequerido]}" según su contenido. La caja seleccionada es "${labels[caja.tipo]}".` });
  }

  dbRun(`UPDATE trackings SET estatus='cerrado', closed_at=datetime('now'), caja_id=?, caja_pallet_id=? WHERE id=?`,
    [caja.nombre, caja_pallet_id, req.params.id]);
  res.json({ mensaje: 'Tracking cerrado exitosamente' });
});

// --- DETALLE SKUs ---
app.get('/api/trackings/:id/detalles', (req, res) => {
  const rows = dbAll('SELECT * FROM detalle_skus WHERE tracking_id=? ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});

app.post('/api/trackings/:id/detalles', (req, res) => {
  const {
    sku_code, descripcion, cantidad,
    pais_origen_catalogo, pais_origen_real, pais_coincide,
    insumos_catalogo, insumos_real, insumos_coincide,
    calidad, es_nuevo, upc_code
  } = req.body;

  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  if (tracking.estatus === 'cerrado') return res.status(400).json({ error: 'Tracking cerrado' });

  const id = uuidv4();
  const esNuevoFlag = es_nuevo ? 1 : 0;
  dbRun(`INSERT INTO detalle_skus (id,tracking_id,sku_code,descripcion,cantidad,pais_origen_catalogo,pais_origen_real,pais_coincide,insumos_catalogo,insumos_real,insumos_coincide,calidad,es_nuevo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.params.id, sku_code, descripcion, cantidad || 1,
     pais_origen_catalogo, pais_origen_real || pais_origen_catalogo,
     pais_coincide !== false ? 1 : 0,
     insumos_catalogo, insumos_real || insumos_catalogo,
     insumos_coincide !== false ? 1 : 0,
     calidad || 'Buena', esNuevoFlag]);

  if (es_nuevo) {
    const nid = uuidv4();
    dbRun(`INSERT INTO skus_nuevos (id,tracking_id,detalle_sku_id,cliente_id,sku_code,upc,descripcion,pais_origen,insumos,operador)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [nid, req.params.id, id, tracking.cliente_id, sku_code,
       upc_code || null, descripcion || null,
       pais_origen_real || pais_origen_catalogo || null,
       insumos_real || insumos_catalogo || null,
       tracking.operador || null]);
  }

  // Actualizar cantidad_final
  const total = dbGet('SELECT SUM(cantidad) as total FROM detalle_skus WHERE tracking_id=?', [req.params.id]);
  dbRun('UPDATE trackings SET cantidad_final=? WHERE id=?', [total?.total || 0, req.params.id]);

  res.json({ id, mensaje: 'SKU registrado' });
});

app.put('/api/trackings/:tid/detalles/:did', (req, res) => {
  const { descripcion, cantidad, pais_origen_real, insumos_real, calidad } = req.body;
  const updates = [], vals = [];
  if (descripcion  !== undefined) { updates.push('descripcion=?');     vals.push(descripcion  || null); }
  if (cantidad     !== undefined) { updates.push('cantidad=?');         vals.push(parseInt(cantidad) || 1); }
  if (pais_origen_real !== undefined) { updates.push('pais_origen_real=?'); vals.push(pais_origen_real || null); }
  if (insumos_real !== undefined) { updates.push('insumos_real=?');     vals.push(insumos_real || null); }
  if (calidad      !== undefined) { updates.push('calidad=?');          vals.push(calidad || 'Buena'); }
  if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(req.params.did, req.params.tid);
  dbRun(`UPDATE detalle_skus SET ${updates.join(',')} WHERE id=? AND tracking_id=?`, vals);
  // Recalcular cantidad_final
  const total = dbGet('SELECT SUM(cantidad) as total FROM detalle_skus WHERE tracking_id=?', [req.params.tid]);
  dbRun('UPDATE trackings SET cantidad_final=? WHERE id=?', [total?.total || 0, req.params.tid]);
  res.json({ mensaje: 'Detalle actualizado' });
});

app.delete('/api/trackings/:tid/detalles/:did', (req, res) => {
  dbRun('DELETE FROM detalle_skus WHERE id=? AND tracking_id=?', [req.params.did, req.params.tid]);
  // Recalcular
  const total = dbGet('SELECT SUM(cantidad) as total FROM detalle_skus WHERE tracking_id=?', [req.params.tid]);
  dbRun('UPDATE trackings SET cantidad_final=? WHERE id=?', [total?.total || 0, req.params.tid]);
  res.json({ mensaje: 'Detalle eliminado' });
});

// Fotos de evidencia para SKU no registrado en catálogo
app.post('/api/detalles/:id/fotos-evidencia', upload.fields([
  { name: 'etiqueta', maxCount: 1 },
  { name: 'insumos', maxCount: 1 },
  { name: 'pieza', maxCount: 1 }
]), (req, res) => {
  const detalle = dbGet('SELECT id FROM detalle_skus WHERE id=?', [req.params.id]);
  if (!detalle) return res.status(404).json({ error: 'Detalle no encontrado' });

  const updates = [];
  const vals = [];
  if (req.files?.etiqueta) { updates.push('foto_etiqueta=?'); vals.push('/uploads/' + req.files.etiqueta[0].filename); }
  if (req.files?.insumos)  { updates.push('foto_insumos=?');  vals.push('/uploads/' + req.files.insumos[0].filename); }
  if (req.files?.pieza)    { updates.push('foto_pieza=?');    vals.push('/uploads/' + req.files.pieza[0].filename); }

  if (updates.length === 0) return res.status(400).json({ error: 'No se recibieron fotos' });

  vals.push(req.params.id);
  dbRun(`UPDATE detalle_skus SET ${updates.join(',')} WHERE id=?`, vals);
  res.json({ mensaje: 'Fotos guardadas' });
});

// Fotos de evidencia para SKU no registrado vía URL (QR)
app.post('/api/detalles/:id/fotos-evidencia-url', (req, res) => {
  const detalle = dbGet('SELECT id FROM detalle_skus WHERE id=?', [req.params.id]);
  if (!detalle) return res.status(404).json({ error: 'Detalle no encontrado' });

  const updates = [];
  const vals = [];
  if (req.body.url_etiqueta) { updates.push('foto_etiqueta=?'); vals.push(req.body.url_etiqueta); }
  if (req.body.url_insumos)  { updates.push('foto_insumos=?');  vals.push(req.body.url_insumos); }
  if (req.body.url_pieza)    { updates.push('foto_pieza=?');    vals.push(req.body.url_pieza); }

  if (updates.length === 0) return res.status(400).json({ error: 'No se recibieron URLs' });
  vals.push(req.params.id);
  dbRun(`UPDATE detalle_skus SET ${updates.join(',')} WHERE id=?`, vals);
  res.json({ mensaje: 'Fotos de evidencia guardadas' });
});

// Fotos adicionales G3 vía URL (foto ya subida desde móvil vía QR)
app.post('/api/detalles/:id/fotos-adicionales-url', (req, res) => {
  const detalle = dbGet('SELECT id FROM detalle_skus WHERE id=?', [req.params.id]);
  if (!detalle) return res.status(404).json({ error: 'Detalle no encontrado' });

  const updates = [];
  const vals = [];
  for (let i = 1; i <= 4; i++) {
    const url = req.body[`url${i}`];
    if (url) { updates.push(`foto_adicional_${i}=?`); vals.push(url); }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No se recibieron URLs' });
  vals.push(req.params.id);
  dbRun(`UPDATE detalle_skus SET ${updates.join(',')} WHERE id=?`, vals);
  res.json({ mensaje: 'Fotos adicionales guardadas' });
});

// Fotos adicionales para G3
app.post('/api/detalles/:id/fotos-adicionales', upload.fields([
  { name: 'foto1', maxCount: 1 },
  { name: 'foto2', maxCount: 1 },
  { name: 'foto3', maxCount: 1 },
  { name: 'foto4', maxCount: 1 }
]), (req, res) => {
  const detalle = dbGet('SELECT id FROM detalle_skus WHERE id=?', [req.params.id]);
  if (!detalle) return res.status(404).json({ error: 'Detalle no encontrado' });

  const updates = [];
  const vals = [];
  for (let i = 1; i <= 4; i++) {
    const f = req.files?.[`foto${i}`];
    if (f) { updates.push(`foto_adicional_${i}=?`); vals.push('/uploads/' + f[0].filename); }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No se recibieron fotos' });
  vals.push(req.params.id);
  dbRun(`UPDATE detalle_skus SET ${updates.join(',')} WHERE id=?`, vals);
  res.json({ mensaje: 'Fotos adicionales guardadas' });
});

// --- ERRORES ---
app.get('/api/trackings/:id/errores', (req, res) => {
  const rows = dbAll('SELECT * FROM errores WHERE tracking_id=? ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});

app.post('/api/trackings/:id/errores', upload.single('foto'), (req, res) => {
  const { detalle_sku_id, tipo_error, comentarios } = req.body;
  const id = uuidv4();
  const path_foto = req.file ? `/uploads/${req.file.filename}` : null;

  dbRun(`INSERT INTO errores (id,tracking_id,detalle_sku_id,tipo_error,path_fotografia,comentarios) VALUES (?,?,?,?,?,?)`,
    [id, req.params.id, detalle_sku_id || null, tipo_error, path_foto, comentarios]);

  res.json({ id, path_fotografia: path_foto, mensaje: 'Error registrado' });
});

// --- RETRABAJOS ---
app.get('/api/catalogo/retrabajos/:tipo', (req, res) => {
  const tipo = req.params.tipo.toLowerCase();
  res.json(CATALOGO_RETRABAJOS[tipo] || []);
});

app.get('/api/retrabajos', (req, res) => {
  const { estatus, cliente_id, tracking_id } = req.query;
  let sql = `
    SELECT r.*,
           t.tracking_number, t.caja_id, t.operador,
           c.nombre as cliente_nombre, c.tipo_mercancia,
           MIN(e.path_fotografia) as foto_evidencia
    FROM retrabajos r
    JOIN trackings t ON r.tracking_id = t.id
    JOIN clientes c ON r.cliente_id = c.id
    LEFT JOIN errores e ON e.detalle_sku_id = r.detalle_sku_id AND e.tracking_id = r.tracking_id
    WHERE 1=1
  `;
  const params = [];
  if (estatus)     { sql += ' AND r.estatus = ?';     params.push(estatus); }
  if (cliente_id)  { sql += ' AND r.cliente_id = ?';  params.push(cliente_id); }
  if (tracking_id) { sql += ' AND r.tracking_id = ?'; params.push(tracking_id); }
  sql += ' GROUP BY r.id ORDER BY r.created_at DESC';
  res.json(dbAll(sql, params));
});

app.get('/api/trackings/:id/retrabajos', (req, res) => {
  const rows = dbAll('SELECT * FROM retrabajos WHERE tracking_id=? ORDER BY created_at', [req.params.id]);
  res.json(rows);
});

app.post('/api/trackings/:id/retrabajos', (req, res) => {
  const { detalle_sku_id, sku_code, descripcion_sku, retrabajos_seleccionados, retrabajo_otro } = req.body;
  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });

  const id = uuidv4();
  const rtJson = JSON.stringify(Array.isArray(retrabajos_seleccionados) ? retrabajos_seleccionados : []);
  dbRun(`INSERT INTO retrabajos (id,tracking_id,detalle_sku_id,cliente_id,sku_code,descripcion_sku,retrabajos_seleccionados,retrabajo_otro,estatus)
    VALUES (?,?,?,?,?,?,?,?,'Pendiente')`,
    [id, req.params.id, detalle_sku_id || null, tracking.cliente_id,
     sku_code || null, descripcion_sku || null, rtJson, retrabajo_otro || null]);

  res.json({ id, mensaje: 'Retrabajo registrado' });
});

app.put('/api/retrabajos/:id', (req, res) => {
  const { estatus } = req.body;
  if (!estatus) return res.status(400).json({ error: 'estatus requerido' });
  dbRun(`UPDATE retrabajos SET estatus=?, updated_at=datetime('now') WHERE id=?`, [estatus, req.params.id]);
  res.json({ mensaje: 'Estatus actualizado' });
});

// --- DISCREPANCIAS ---
app.post('/api/trackings/:id/discrepancia', (req, res) => {
  const { cantidad_original, cantidad_corregida } = req.body;
  const id = uuidv4();
  dbRun(`INSERT INTO alertas_discrepancia (id,tracking_id,cantidad_original,cantidad_corregida) VALUES (?,?,?,?)`,
    [id, req.params.id, cantidad_original, cantidad_corregida]);
  dbRun(`UPDATE trackings SET cantidad_final=? WHERE id=?`, [cantidad_corregida, req.params.id]);
  res.json({ id, mensaje: 'Discrepancia registrada' });
});

app.get('/api/trackings/:id/discrepancias', (req, res) => {
  const rows = dbAll('SELECT * FROM alertas_discrepancia WHERE tracking_id=? ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});

// --- REPORTES ---
app.get('/api/reportes/resumen', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id } = req.query;

  const whereParts = [];
  const params = [];
  if (fecha_desde) { whereParts.push("date(datetime(t.created_at,'localtime')) >= ?"); params.push(fecha_desde); }
  if (fecha_hasta) { whereParts.push("date(datetime(t.created_at,'localtime')) <= ?"); params.push(fecha_hasta); }
  if (cliente_id)  { whereParts.push("t.cliente_id = ?"); params.push(cliente_id); }
  const where = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';

  const totalTrackings    = dbGet(`SELECT COUNT(*) as cnt FROM trackings t${where}`, params)?.cnt || 0;
  const trackingsCerrados = dbGet(`SELECT COUNT(*) as cnt FROM trackings t${where ? where + " AND t.estatus='cerrado'" : " WHERE t.estatus='cerrado'"}`, params)?.cnt || 0;
  const totalPiezas       = dbGet(`SELECT SUM(t.cantidad_final) as total FROM trackings t${where}`, params)?.total || 0;
  const totalErrores      = dbGet(`SELECT COUNT(*) as cnt FROM errores e JOIN trackings t ON e.tracking_id=t.id${where}`, params)?.cnt || 0;
  const totalDiscrepancias= dbGet(`SELECT COUNT(*) as cnt FROM alertas_discrepancia a JOIN trackings t ON a.tracking_id=t.id${where}`, params)?.cnt || 0;

  res.json({ totalTrackings, trackingsCerrados, totalErrores, totalDiscrepancias, totalPiezas });
});

// Lista de cajas/pallets agrupadas por caja_id
app.get('/api/reportes/cajas', (req, res) => {
  const { cliente_id, fecha_desde, fecha_hasta } = req.query;

  let where = "WHERE t.estatus = 'cerrado' AND t.caja_id != ''";
  const params = [];
  if (cliente_id) { where += ' AND t.cliente_id = ?'; params.push(cliente_id); }
  if (fecha_desde) { where += " AND date(t.closed_at) >= ?"; params.push(fecha_desde); }
  if (fecha_hasta) { where += " AND date(t.closed_at) <= ?"; params.push(fecha_hasta); }

  const sql = `
    SELECT
      t.caja_id,
      t.cliente_id,
      MAX(c.nombre)                AS cliente_nombre,
      MAX(c.tipo_almacenamiento)   AS tipo_almacenamiento,
      MAX(cp.tipo)                 AS tipo_caja,
      MAX(cp.id)                   AS caja_pallet_id,
      COUNT(DISTINCT t.id)         AS num_trackings,
      GROUP_CONCAT(t.id, '|')      AS tracking_ids,
      GROUP_CONCAT(t.tracking_number, ', ') AS tracking_numbers,
      COUNT(DISTINCT d.id)         AS num_skus,
      COALESCE(SUM(d.cantidad), 0) AS total_piezas,
      MAX(t.closed_at)             AS closed_at,
      MAX(t.impresa)               AS impresa
    FROM trackings t
    LEFT JOIN clientes c ON t.cliente_id = c.id
    LEFT JOIN cajas_pallets cp ON cp.nombre = t.caja_id
    LEFT JOIN detalle_skus d ON d.tracking_id = t.id
    ${where}
    GROUP BY t.caja_id, t.cliente_id
    ORDER BY MAX(t.closed_at) DESC
  `;
  res.json(dbAll(sql, params));
});

// Detalle completo de una caja/pallet (todos sus trackings + SKUs + errores)
app.get('/api/reportes/caja-detalle', (req, res) => {
  const { caja_id, cliente_id } = req.query;
  if (!caja_id) return res.status(400).json({ error: 'caja_id requerido' });

  let sql = `
    SELECT t.*, c.nombre as cliente_nombre, c.tipo_almacenamiento, c.grado_confianza
    FROM trackings t
    LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE t.caja_id = ? AND t.estatus = 'cerrado'
  `;
  const params = [caja_id];
  if (cliente_id) { sql += ' AND t.cliente_id = ?'; params.push(cliente_id); }
  sql += ' ORDER BY t.closed_at';

  const trackings = dbAll(sql, params);

  if (trackings.length === 0) return res.status(404).json({ error: 'Caja no encontrada' });

  const tids = trackings.map(t => t.id);
  const ph  = tids.map(() => '?').join(',');

  const detalles = dbAll(`
    SELECT d.*, t.tracking_number
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    WHERE d.tracking_id IN (${ph})
    ORDER BY t.tracking_number, d.created_at
  `, tids);

  const errores = dbAll(`
    SELECT e.*, t.tracking_number
    FROM errores e
    JOIN trackings t ON e.tracking_id = t.id
    WHERE e.tracking_id IN (${ph})
    ORDER BY e.created_at
  `, tids);

  res.json({ trackings, detalles, errores });
});

// CSV: datos por tracking IDs (evita ambigüedad cuando mismo caja_id pertenece a distintos clientes)
app.post('/api/reportes/csv-detalles', (req, res) => {
  const { tracking_ids } = req.body;
  if (!Array.isArray(tracking_ids) || tracking_ids.length === 0)
    return res.status(400).json({ error: 'tracking_ids requerido' });

  const ph = tracking_ids.map(() => '?').join(',');
  const rows = dbAll(`
    SELECT t.tracking_number, t.caja_id, t.numero_orden, t.tipo_retorno, t.razon_retorno,
           d.sku_code, d.cantidad, d.pais_origen_real, d.insumos_real
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    WHERE t.id IN (${ph})
    ORDER BY t.caja_id, t.tracking_number, d.created_at
  `, tracking_ids);
  res.json(rows);
});

// Marcar como impresas (por tracking IDs)
app.post('/api/reportes/marcar-impresa', (req, res) => {
  const { tracking_ids } = req.body;
  if (!Array.isArray(tracking_ids) || tracking_ids.length === 0)
    return res.status(400).json({ error: 'tracking_ids requerido' });
  const ph = tracking_ids.map(() => '?').join(',');
  dbRun(`UPDATE trackings SET impresa = 1 WHERE id IN (${ph})`, tracking_ids);
  res.json({ mensaje: 'Marcadas como impresas' });
});

app.get('/api/reportes/manifiesto/:id', (req, res) => {
  const tracking = dbGet(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE t.id=?
  `, [req.params.id]);

  if (!tracking) return res.status(404).json({ error: 'No encontrado' });

  const detalles = dbAll('SELECT * FROM detalle_skus WHERE tracking_id=? ORDER BY created_at', [req.params.id]);
  const errores = dbAll('SELECT * FROM errores WHERE tracking_id=? ORDER BY created_at', [req.params.id]);
  const discrepancias = dbAll('SELECT * FROM alertas_discrepancia WHERE tracking_id=?', [req.params.id]);
  const retrabajos = dbAll(`
    SELECT r.*, MIN(e.path_fotografia) as foto_evidencia
    FROM retrabajos r
    LEFT JOIN errores e ON e.detalle_sku_id = r.detalle_sku_id AND e.tracking_id = r.tracking_id
    WHERE r.tracking_id=?
    GROUP BY r.id
    ORDER BY r.created_at
  `, [req.params.id]);

  res.json({ tracking, detalles, errores, discrepancias, retrabajos });
});

// Reporte masivo de retrabajos
app.get('/api/reportes/retrabajos', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id, estatus } = req.query;
  let sql = `
    SELECT r.*,
           t.tracking_number, t.caja_id, t.operador,
           c.nombre as cliente_nombre, c.tipo_mercancia
    FROM retrabajos r
    JOIN trackings t ON r.tracking_id = t.id
    JOIN clientes c ON r.cliente_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (fecha_desde) { sql += " AND date(r.created_at) >= ?"; params.push(fecha_desde); }
  if (fecha_hasta) { sql += " AND date(r.created_at) <= ?"; params.push(fecha_hasta); }
  if (cliente_id)  { sql += ' AND r.cliente_id = ?'; params.push(cliente_id); }
  if (estatus)     { sql += ' AND r.estatus = ?'; params.push(estatus); }
  sql += ' ORDER BY r.created_at DESC';
  res.json(dbAll(sql, params));
});

// Dashboard: hora por hora
app.get('/api/dashboard/hora-por-hora', (req, res) => {
  const { fecha_desde, fecha_hasta, operador, cliente_id } = req.query;
  let sql = `
    SELECT strftime('%Y-%m-%d', datetime(d.created_at, 'localtime')) as fecha,
           CAST(strftime('%H', datetime(d.created_at, 'localtime')) AS INTEGER) as hora,
           t.cliente_id,
           c.nombre as cliente_nombre,
           COALESCE(c.uph, 0) as uph,
           SUM(d.cantidad) as unidades,
           COUNT(DISTINCT t.operador) as num_operadores
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    JOIN clientes c ON t.cliente_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (fecha_desde) { sql += ' AND date(datetime(d.created_at, \'localtime\')) >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { sql += ' AND date(datetime(d.created_at, \'localtime\')) <= ?'; params.push(fecha_hasta); }
  if (operador)    { sql += ' AND t.operador = ?'; params.push(operador); }
  if (cliente_id)  { sql += ' AND t.cliente_id = ?'; params.push(cliente_id); }
  sql += ' GROUP BY fecha, hora, t.cliente_id ORDER BY fecha, hora';
  res.json(dbAll(sql, params));
});

app.get('/api/dashboard/operadores', (req, res) => {
  const rows = dbAll("SELECT DISTINCT operador FROM trackings WHERE operador IS NOT NULL AND operador != '' ORDER BY operador");
  res.json(rows.map(r => r.operador));
});

app.get('/api/dashboard/ranking', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id } = req.query;
  let sql = `
    SELECT t.operador,
           SUM(d.cantidad) as total_piezas,
           COUNT(DISTINCT t.id) as total_trackings
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    WHERE 1=1
  `;
  const params = [];
  if (fecha_desde) { sql += ' AND date(datetime(d.created_at, \'localtime\')) >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { sql += ' AND date(datetime(d.created_at, \'localtime\')) <= ?'; params.push(fecha_hasta); }
  if (cliente_id)  { sql += ' AND t.cliente_id = ?'; params.push(cliente_id); }
  sql += ' GROUP BY t.operador ORDER BY total_piezas DESC LIMIT 10';
  res.json(dbAll(sql, params));
});

// --- FOTO SESIONES (Hybrid Web-Mobile) ---

function buildMobilePhotoPage(pageState, token) {
  const stateContent = {
    invalid: `
      <div class="status status-error">❌ Enlace inválido</div>
      <p class="sub">Este enlace no es válido o ya expiró. Genera un nuevo QR desde la estación de trabajo.</p>
    `,
    expired: `
      <div class="status status-warning">⏱ Sesión expirada</div>
      <p class="sub">Este enlace ha caducado. Genera un nuevo QR desde la estación de trabajo.</p>
    `,
    used: `
      <div class="status status-success">✅ Foto ya enviada</div>
      <p class="sub">La fotografía fue recibida correctamente en la estación de trabajo. Puedes cerrar esta pantalla.</p>
    `,
    active: `
      <h1>📸 Capturar Evidencia</h1>
      <p class="sub">Toma la fotografía del defecto o discrepancia encontrada en el producto.</p>
      <img id="preview" class="preview-img" alt="Vista previa">
      <div id="status-msg"></div>
      <label class="btn btn-primary" id="btn-capture">
        📷 Tomar Foto / Seleccionar
        <input type="file" id="foto-input" accept="image/*" capture="environment">
      </label>
      <button class="btn btn-secondary hidden" id="btn-retomar" onclick="retomar()">↩ Retomar foto</button>
      <button class="btn btn-primary hidden" id="btn-enviar" onclick="enviarFoto()">✓ Enviar foto</button>
      <div class="spinner hidden" id="loading-spinner"></div>
    `,
  }[pageState] || '';

  const script = pageState === 'active' ? `
    <script>
      const TOKEN = '${token}';
      let selectedFile = null;

      document.getElementById('foto-input').addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = e => {
          const img = document.getElementById('preview');
          img.src = e.target.result;
          img.style.display = 'block';
        };
        reader.readAsDataURL(file);
        document.getElementById('btn-capture').classList.add('hidden');
        document.getElementById('btn-retomar').classList.remove('hidden');
        document.getElementById('btn-enviar').classList.remove('hidden');
        clearStatus();
      });

      function retomar() {
        selectedFile = null;
        document.getElementById('preview').style.display = 'none';
        document.getElementById('foto-input').value = '';
        document.getElementById('btn-capture').classList.remove('hidden');
        document.getElementById('btn-retomar').classList.add('hidden');
        document.getElementById('btn-enviar').classList.add('hidden');
        clearStatus();
      }

      async function enviarFoto() {
        if (!selectedFile) return;
        const btnEnviar = document.getElementById('btn-enviar');
        const spinner = document.getElementById('loading-spinner');
        btnEnviar.disabled = true;
        btnEnviar.textContent = 'Enviando...';
        document.getElementById('btn-retomar').classList.add('hidden');
        spinner.classList.remove('hidden');
        clearStatus();

        const fd = new FormData();
        fd.append('foto', selectedFile);

        try {
          const res = await fetch('/api/foto-sesion/' + TOKEN + '/upload', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Error al enviar');
          spinner.classList.add('hidden');
          btnEnviar.classList.add('hidden');
          document.getElementById('btn-retomar').classList.add('hidden');
          document.getElementById('btn-capture').classList.add('hidden');
          setStatus('✅ ¡Foto enviada! Puedes cerrar esta pantalla.', 'success');
        } catch(e) {
          spinner.classList.add('hidden');
          btnEnviar.disabled = false;
          btnEnviar.textContent = '✓ Enviar foto';
          document.getElementById('btn-retomar').classList.remove('hidden');
          setStatus('❌ Error: ' + e.message, 'error');
        }
      }

      function setStatus(msg, type) {
        const el = document.getElementById('status-msg');
        el.className = 'status status-' + type;
        el.textContent = msg;
      }
      function clearStatus() {
        const el = document.getElementById('status-msg');
        el.className = '';
        el.textContent = '';
      }
    <\/script>
  ` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Captura de Foto — Sistema Logístico</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0A0E1A;color:#E5E7EB;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 20px}
    .logo{font-size:11px;letter-spacing:.15em;color:#6B7280;text-transform:uppercase;margin-bottom:32px}
    .card{background:#131827;border:1px solid #1E2A3A;border-radius:16px;padding:32px 24px;width:100%;max-width:420px;text-align:center}
    h1{font-size:20px;font-weight:700;margin-bottom:8px}
    .sub{font-size:14px;color:#9CA3AF;margin-bottom:28px;line-height:1.5}
    .btn{display:block;width:100%;padding:18px;border-radius:12px;border:none;font-size:17px;font-weight:700;cursor:pointer;transition:opacity .15s;margin-bottom:12px;text-align:center}
    .btn:active{opacity:.75}
    .btn.hidden{display:none}
    .btn-primary{background:#1D4ED8;color:#fff}
    .btn-secondary{background:#1E2A3A;color:#E5E7EB}
    label.btn{display:block}
    input[type=file]{display:none}
    .preview-img{width:100%;border-radius:12px;margin:16px 0;display:none;object-fit:cover;max-height:320px}
    .status{padding:14px 16px;border-radius:12px;font-size:14px;font-weight:600;margin-bottom:16px;text-align:left;line-height:1.4}
    .status-success{background:rgba(22,163,74,.15);color:#4ADE80;border:1px solid rgba(22,163,74,.3)}
    .status-error{background:rgba(220,38,38,.15);color:#F87171;border:1px solid rgba(220,38,38,.3)}
    .status-warning{background:rgba(202,138,4,.15);color:#FCD34D;border:1px solid rgba(202,138,4,.3)}
    .spinner{width:36px;height:36px;border:3px solid #1E2A3A;border-top-color:#1D4ED8;border-radius:50%;animation:spin .8s linear infinite;margin:16px auto}
    .hidden{display:none}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="logo">Sistema Logístico · Captura Móvil</div>
  <div class="card">
    ${stateContent}
  </div>
  ${script}
</body>
</html>`;
}

app.post('/api/foto-sesion', (req, res) => {
  const { tracking_id, detalle_sku_id, contexto } = req.body;
  const id = uuidv4();
  const token = uuidv4();
  dbRun(
    `INSERT INTO foto_sesiones (id, token, tracking_id, detalle_sku_id, contexto, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`,
    [id, token, tracking_id || null, detalle_sku_id || null, contexto || null]
  );
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const url = `${proto}://${host}/foto/${token}`;
  res.json({ token, url });
});

app.get('/api/foto-sesion/:token', (req, res) => {
  const sesion = dbGet('SELECT estatus, url_foto, expires_at FROM foto_sesiones WHERE token = ?', [req.params.token]);
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json(sesion);
});

app.post('/api/foto-sesion/:token/upload', upload.single('foto'), (req, res) => {
  const sesion = dbGet('SELECT * FROM foto_sesiones WHERE token = ?', [req.params.token]);
  if (!sesion) return res.status(404).json({ error: 'Sesión inválida' });
  if (sesion.estatus === 'completada') return res.status(400).json({ error: 'Esta sesión ya fue utilizada' });
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (sesion.expires_at < now) return res.status(410).json({ error: 'Sesión expirada' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió foto' });
  const url_foto = `/uploads/${req.file.filename}`;
  dbRun("UPDATE foto_sesiones SET estatus = 'completada', url_foto = ? WHERE token = ?",
    [url_foto, req.params.token]);
  res.json({ mensaje: 'Foto recibida', url_foto });
});

app.get('/foto/:token', (req, res) => {
  const sesion = dbGet('SELECT * FROM foto_sesiones WHERE token = ?', [req.params.token]);
  if (!sesion) return res.send(buildMobilePhotoPage('invalid', null));
  if (sesion.estatus === 'completada') return res.send(buildMobilePhotoPage('used', null));
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (sesion.expires_at < now) return res.send(buildMobilePhotoPage('expired', null));
  res.send(buildMobilePhotoPage('active', req.params.token));
});

app.post('/api/trackings/:id/errores-url', (req, res) => {
  const { detalle_sku_id, tipo_error, comentarios, path_fotografia } = req.body;
  if (!path_fotografia) return res.status(400).json({ error: 'path_fotografia requerido' });
  const id = uuidv4();
  dbRun(`INSERT INTO errores (id,tracking_id,detalle_sku_id,tipo_error,path_fotografia,comentarios) VALUES (?,?,?,?,?,?)`,
    [id, req.params.id, detalle_sku_id || null, tipo_error, path_fotografia, comentarios]);
  res.json({ id, path_fotografia, mensaje: 'Error registrado' });
});

// ── Subida genérica de foto ───────────────────────────────────────────────────
app.post('/api/subir-foto', upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió foto' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── SKUs Nuevos en Catálogo ────────────────────────────────────────────────────

function buildSkusNuevosWhere(query) {
  const { cliente_id, fecha_inicio, fecha_fin, solo_sin_completar } = query;
  const where = ['1=1'];
  const vals = [];
  if (cliente_id) { where.push('n.cliente_id=?'); vals.push(cliente_id); }
  if (fecha_inicio) { where.push("date(n.created_at)>=?"); vals.push(fecha_inicio); }
  if (fecha_fin) { where.push("date(n.created_at)<=?"); vals.push(fecha_fin); }
  if (solo_sin_completar === '1') {
    where.push(`(
      COALESCE(n.url_foto_etiqueta, d.foto_etiqueta) IS NULL
      OR COALESCE(n.url_foto_insumos_origen, d.foto_insumos) IS NULL
      OR COALESCE(n.url_foto_producto_completo, d.foto_pieza) IS NULL
    )`);
  }
  return { where: where.join(' AND '), vals };
}

app.get('/api/skus-nuevos/pendientes', (req, res) => {
  const row = dbGet(`
    SELECT COUNT(*) as cnt FROM skus_nuevos n
    LEFT JOIN detalle_skus d ON n.detalle_sku_id=d.id
    WHERE n.dado_de_alta=0
    AND (
      COALESCE(n.url_foto_etiqueta, d.foto_etiqueta) IS NULL
      OR COALESCE(n.url_foto_insumos_origen, d.foto_insumos) IS NULL
      OR COALESCE(n.url_foto_producto_completo, d.foto_pieza) IS NULL
    )
  `, []);
  res.json({ count: row?.cnt || 0 });
});

app.get('/api/skus-nuevos/exportar/csv', (req, res) => {
  const { where, vals } = buildSkusNuevosWhere(req.query);
  const rows = dbAll(`
    SELECT n.id, n.tracking_id, n.detalle_sku_id, n.cliente_id, n.sku_code, n.upc,
      n.descripcion, n.pais_origen, n.insumos, n.operador, n.dado_de_alta, n.created_at,
      COALESCE(n.url_foto_etiqueta, d.foto_etiqueta)             as url_foto_etiqueta,
      COALESCE(n.url_foto_insumos_origen, d.foto_insumos)        as url_foto_insumos_origen,
      COALESCE(n.url_foto_producto_completo, d.foto_pieza)       as url_foto_producto_completo,
      c.nombre as cliente_nombre, t.tracking_number
    FROM skus_nuevos n
    LEFT JOIN clientes c ON n.cliente_id=c.id
    LEFT JOIN trackings t ON n.tracking_id=t.id
    LEFT JOIN detalle_skus d ON n.detalle_sku_id=d.id
    WHERE ${where} ORDER BY n.created_at DESC
  `, vals);
  const base = `${req.protocol}://${req.get('host')}`;
  const toAbs = v => v ? (v.startsWith('http') ? v : base + v) : null;
  const esc = v => v ? `"${String(v).replace(/"/g,'""')}"` : '""';
  const headers = ['Fecha','Cliente','Tracking #','SKU Code','UPC','Descripción','País de Origen','Insumos','URL Fotografía Etiqueta','URL Fotografía Insumos / País de Origen','URL Fotografía Producto Completo','Operador'];
  const lines = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => [
      esc(r.created_at?.substring(0,10)), esc(r.cliente_nombre), esc(r.tracking_number),
      esc(r.sku_code), esc(r.upc), esc(r.descripcion), esc(r.pais_origen), esc(r.insumos),
      esc(toAbs(r.url_foto_etiqueta)), esc(toAbs(r.url_foto_insumos_origen)), esc(toAbs(r.url_foto_producto_completo)),
      esc(r.operador),
    ].join(','))
  ];
  const fecha = new Date().toISOString().substring(0,10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="skus-nuevos-${fecha}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

app.get('/api/skus-nuevos', (req, res) => {
  const { where, vals } = buildSkusNuevosWhere(req.query);
  const rows = dbAll(`
    SELECT n.id, n.tracking_id, n.detalle_sku_id, n.cliente_id, n.sku_code, n.upc,
      n.descripcion, n.pais_origen, n.insumos, n.operador, n.dado_de_alta, n.created_at,
      COALESCE(n.url_foto_etiqueta, d.foto_etiqueta)             as url_foto_etiqueta,
      COALESCE(n.url_foto_insumos_origen, d.foto_insumos)        as url_foto_insumos_origen,
      COALESCE(n.url_foto_producto_completo, d.foto_pieza)       as url_foto_producto_completo,
      c.nombre as cliente_nombre, t.tracking_number
    FROM skus_nuevos n
    LEFT JOIN clientes c ON n.cliente_id=c.id
    LEFT JOIN trackings t ON n.tracking_id=t.id
    LEFT JOIN detalle_skus d ON n.detalle_sku_id=d.id
    WHERE ${where} ORDER BY n.created_at DESC
  `, vals);
  res.json(rows);
});

app.get('/api/skus-nuevos/:id', (req, res) => {
  const row = dbGet(`
    SELECT n.id, n.tracking_id, n.detalle_sku_id, n.cliente_id, n.sku_code, n.upc,
      n.descripcion, n.pais_origen, n.insumos, n.operador, n.dado_de_alta, n.created_at,
      COALESCE(n.url_foto_etiqueta, d.foto_etiqueta)             as url_foto_etiqueta,
      COALESCE(n.url_foto_insumos_origen, d.foto_insumos)        as url_foto_insumos_origen,
      COALESCE(n.url_foto_producto_completo, d.foto_pieza)       as url_foto_producto_completo,
      c.nombre as cliente_nombre, t.tracking_number
    FROM skus_nuevos n
    LEFT JOIN clientes c ON n.cliente_id=c.id
    LEFT JOIN trackings t ON n.tracking_id=t.id
    LEFT JOIN detalle_skus d ON n.detalle_sku_id=d.id
    WHERE n.id=?
  `, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  res.json(row);
});

app.put('/api/skus-nuevos/:id', (req, res) => {
  const { upc, descripcion, pais_origen, insumos, url_foto_etiqueta, url_foto_insumos_origen, url_foto_producto_completo, dado_de_alta } = req.body;
  const updates = [], vals = [];
  if (upc !== undefined)                      { updates.push('upc=?');                       vals.push(upc || null); }
  if (descripcion !== undefined)              { updates.push('descripcion=?');                vals.push(descripcion || null); }
  if (pais_origen !== undefined)              { updates.push('pais_origen=?');                vals.push(pais_origen || null); }
  if (insumos !== undefined)                  { updates.push('insumos=?');                    vals.push(insumos || null); }
  if (url_foto_etiqueta !== undefined)        { updates.push('url_foto_etiqueta=?');          vals.push(url_foto_etiqueta || null); }
  if (url_foto_insumos_origen !== undefined)  { updates.push('url_foto_insumos_origen=?');    vals.push(url_foto_insumos_origen || null); }
  if (url_foto_producto_completo !== undefined){ updates.push('url_foto_producto_completo=?'); vals.push(url_foto_producto_completo || null); }
  if (dado_de_alta !== undefined)             { updates.push('dado_de_alta=?');               vals.push(dado_de_alta ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(req.params.id);
  dbRun(`UPDATE skus_nuevos SET ${updates.join(',')} WHERE id=?`, vals);
  res.json({ mensaje: 'Actualizado' });
});

app.delete('/api/skus-nuevos/:id', (req, res) => {
  dbRun('DELETE FROM skus_nuevos WHERE id=?', [req.params.id]);
  res.json({ mensaje: 'Eliminado' });
});

// Iniciar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📦 Sistema Logístico de Inspección v1.0`);
  });
});
