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
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.run("ALTER TABLE clientes ADD COLUMN tipo_almacenamiento TEXT DEFAULT 'caja'"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN uph INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN tipo_mercancia TEXT DEFAULT 'textil'"); } catch(e) {}
  try { db.run("ALTER TABLE clientes ADD COLUMN fotos_adicionales INTEGER DEFAULT 0"); } catch(e) {}

  // Materializar valores NULL de columnas migradas (sql.js omite undefined en JSON)
  db.run("UPDATE clientes SET tipo_almacenamiento = 'caja'   WHERE tipo_almacenamiento IS NULL");
  db.run("UPDATE clientes SET uph               = 0          WHERE uph IS NULL");
  db.run("UPDATE clientes SET tipo_mercancia    = 'textil'   WHERE tipo_mercancia IS NULL");
  db.run("UPDATE clientes SET fotos_adicionales = 0          WHERE fotos_adicionales IS NULL");

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

  // Recrear tabla retrabajos con nuevo esquema (DROP seguro: migración controlada)
  db.run('DROP TABLE IF EXISTS retrabajos');
  db.run(`
    CREATE TABLE retrabajos (
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
  const { nombre, grado_confianza, porcentaje_muestreo, modulo_calidad, modulo_retrabajo, tipo_almacenamiento, uph, tipo_mercancia, fotos_adicionales } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const id = uuidv4();
  const grado = parseInt(grado_confianza) || 2;
  const fa = grado === 3 ? Math.max(0, Math.min(4, parseInt(fotos_adicionales) || 0)) : 0;
  console.log(`POST /clientes → nombre="${nombre}" grado=${grado} fotos_adicionales=${fa}`);
  const ok = dbRun(`INSERT INTO clientes (id,nombre,grado_confianza,porcentaje_muestreo,modulo_calidad,modulo_retrabajo,tipo_almacenamiento,uph,tipo_mercancia,fotos_adicionales) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, nombre, grado, porcentaje_muestreo || 30, modulo_calidad ? 1 : 0, modulo_retrabajo ? 1 : 0, tipo_almacenamiento || 'caja', uph || 0, tipo_mercancia || 'textil', fa]);
  if (!ok) return res.status(500).json({ error: 'Error al guardar en base de datos' });
  res.json({ id, mensaje: 'Cliente creado' });
});

app.put('/api/clientes/:id', (req, res) => {
  const { nombre, grado_confianza, porcentaje_muestreo, modulo_calidad, modulo_retrabajo, tipo_almacenamiento, uph, tipo_mercancia, fotos_adicionales } = req.body;
  const grado = parseInt(grado_confianza) || 2;
  const fa = grado === 3 ? Math.max(0, Math.min(4, parseInt(fotos_adicionales) || 0)) : 0;
  console.log(`PUT /clientes/${req.params.id} → grado=${grado} fotos_adicionales=${fa}`);
  const ok = dbRun(`UPDATE clientes SET nombre=?,grado_confianza=?,porcentaje_muestreo=?,modulo_calidad=?,modulo_retrabajo=?,tipo_almacenamiento=?,uph=?,tipo_mercancia=?,fotos_adicionales=? WHERE id=?`,
    [nombre, grado, porcentaje_muestreo || 30, modulo_calidad ? 1 : 0, modulo_retrabajo ? 1 : 0, tipo_almacenamiento || 'caja', uph || 0, tipo_mercancia || 'textil', fa, req.params.id]);
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
  const id = uuidv4();
  dbRun(`INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code) VALUES (?,?,?,?,?,?,?)`,
    [id, cliente_id, sku_code, descripcion, pais_origen, insumos, upc_code || null]);
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
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza, c.modulo_calidad, c.modulo_retrabajo, c.porcentaje_muestreo, c.tipo_almacenamiento, c.tipo_mercancia, c.fotos_adicionales
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    ORDER BY t.created_at DESC
  `);
  res.json(rows);
});

app.get('/api/trackings/:id', (req, res) => {
  const row = dbGet(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza, c.modulo_calidad, c.modulo_retrabajo, c.porcentaje_muestreo, c.tipo_almacenamiento, c.tipo_mercancia, c.fotos_adicionales
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE t.id = ?
  `, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Tracking no encontrado' });
  res.json(row);
});

app.post('/api/trackings', (req, res) => {
  const { tracking_number, cliente_id, operador, cantidad_declarada } = req.body;
  if (!tracking_number || !cliente_id) {
    return res.status(400).json({ error: 'tracking_number y cliente_id son requeridos' });
  }

  const existing = dbGet('SELECT id FROM trackings WHERE tracking_number = ?', [tracking_number]);
  if (existing) return res.status(400).json({ error: 'Tracking number ya registrado' });

  const id = uuidv4();
  dbRun(`INSERT INTO trackings (id,tracking_number,cliente_id,caja_id,caja_pallet_id,operador,cantidad_declarada,cantidad_final) VALUES (?,?,?,?,?,?,?,?)`,
    [id, tracking_number, cliente_id, '', null, operador || 'Operador', cantidad_declarada || 0, cantidad_declarada || 0]);
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
    calidad
  } = req.body;

  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  if (tracking.estatus === 'cerrado') return res.status(400).json({ error: 'Tracking cerrado' });

  const id = uuidv4();
  dbRun(`INSERT INTO detalle_skus (id,tracking_id,sku_code,descripcion,cantidad,pais_origen_catalogo,pais_origen_real,pais_coincide,insumos_catalogo,insumos_real,insumos_coincide,calidad)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.params.id, sku_code, descripcion, cantidad || 1,
     pais_origen_catalogo, pais_origen_real || pais_origen_catalogo,
     pais_coincide !== false ? 1 : 0,
     insumos_catalogo, insumos_real || insumos_catalogo,
     insumos_coincide !== false ? 1 : 0,
     calidad || 'Buena']);

  // Actualizar cantidad_final
  const total = dbGet('SELECT SUM(cantidad) as total FROM detalle_skus WHERE tracking_id=?', [req.params.id]);
  dbRun('UPDATE trackings SET cantidad_final=? WHERE id=?', [total?.total || 0, req.params.id]);

  res.json({ id, mensaje: 'SKU registrado' });
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
    SELECT t.tracking_number, t.caja_id,
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

// Iniciar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📦 Sistema Logístico de Inspección v1.0`);
  });
});
