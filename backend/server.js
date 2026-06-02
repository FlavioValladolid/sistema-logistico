require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const Papa = require('papaparse');
let ResendSDK; try { ResendSDK = require('resend'); } catch(e) { ResendSDK = null; }
let nodeCron; try { nodeCron = require('node-cron'); } catch(e) { nodeCron = null; }

const app = express();
const PORT = process.env.PORT || 3000;

// Returns current local time as "YYYY-MM-DD HH:MM:SS" for SQLite TEXT columns
function localNow() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const CATALOGO_RETRABAJOS = {
  calzado:    ['Cambio de caja', 'Limpieza', 'Reparación de caja', 'Impresión de etiqueta'],
  textil:     ['Cambio de etiqueta', 'Limpieza', 'Reparación de costura', 'Planchado', 'Re-empaque'],
  traje_bano: ['Cambio de etiqueta', 'Limpieza', 'Re-empaque', 'Revisión de elástico'],
  sombreros:  ['Cambio de etiqueta', 'Limpieza', 'Reparación de forma', 'Re-empaque'],
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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
    const ext = path.extname(file.originalname).toLowerCase();
    // HEIC/HEIF → canvas converts to JPEG on frontend; normalize to .jpg
    // Missing/unknown extension → derive from MIME type (covers Android octet-stream uploads)
    const mimeExt = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.jpg', 'image/heif': '.jpg' };
    const safeExt = ['.heic', '.heif'].includes(ext) ? '.jpg' : (ext || mimeExt[file.mimetype] || '.jpg');
    cb(null, `${uuidv4()}${safeExt}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// DB en memoria con persistencia en archivo
const DB_PATH = path.join(__dirname, 'database.bin');
let db;

async function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  try { db.exec("ALTER TABLE clientes ADD COLUMN tipo_almacenamiento TEXT DEFAULT 'caja'"); } catch(e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN uph INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN tipo_mercancia TEXT DEFAULT 'textil'"); } catch(e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN fotos_adicionales INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN requiere_orden INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN requiere_tipo_retorno INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN requiere_nota_credito INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN requiere_nombre_destinatario INTEGER DEFAULT 0"); } catch(e) {}

  // Materializar valores NULL de columnas migradas (sql.js omite undefined en JSON)
  db.exec("UPDATE clientes SET tipo_almacenamiento = 'caja'   WHERE tipo_almacenamiento IS NULL");
  db.exec("UPDATE clientes SET uph               = 0          WHERE uph IS NULL");
  db.exec("UPDATE clientes SET tipo_mercancia    = 'textil'   WHERE tipo_mercancia IS NULL");
  db.exec("UPDATE clientes SET fotos_adicionales = 0          WHERE fotos_adicionales IS NULL");
  db.exec("UPDATE clientes SET requiere_orden = 0            WHERE requiere_orden IS NULL");
  db.exec("UPDATE clientes SET requiere_tipo_retorno = 0     WHERE requiere_tipo_retorno IS NULL");
  db.exec("UPDATE clientes SET requiere_nota_credito = 0     WHERE requiere_nota_credito IS NULL");
  db.exec("UPDATE clientes SET requiere_nombre_destinatario = 0 WHERE requiere_nombre_destinatario IS NULL");

  console.log('📋 Columnas clientes:', db.prepare("PRAGMA table_info(clientes)").all().map(r => r.name).join(', '));

  db.exec(`
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
  try { db.exec('ALTER TABLE skus ADD COLUMN upc_code TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE skus ADD COLUMN created_at TEXT'); } catch(e) {}
  db.exec("UPDATE skus SET created_at = datetime('now','localtime') WHERE created_at IS NULL");

  db.exec(`
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
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      closed_at TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);

  db.exec(`
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
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);

  // Columna impresa en trackings
  try { db.exec('ALTER TABLE trackings ADD COLUMN impresa INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE trackings ADD COLUMN numero_orden TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE trackings ADD COLUMN tipo_retorno TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE trackings ADD COLUMN razon_retorno TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE trackings ADD COLUMN nombre_destinatario TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN foto_etiqueta TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN foto_insumos TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN foto_pieza TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_1 TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_2 TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_3 TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN foto_adicional_4 TEXT'); } catch(e) {}
  // Materializar NULLs de columnas migradas en trackings
  db.exec("UPDATE trackings SET impresa = 0 WHERE impresa IS NULL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS errores (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      detalle_sku_id TEXT,
      tipo_error TEXT NOT NULL,
      path_fotografia TEXT,
      comentarios TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS alertas_discrepancia (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      cantidad_original INTEGER,
      cantidad_corregida INTEGER,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cajas_pallets (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL,
      nombre TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL,
      consecutivo INTEGER NOT NULL,
      estatus TEXT DEFAULT 'Abierta',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      closed_at TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);
  try { db.exec('ALTER TABLE trackings ADD COLUMN caja_pallet_id TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE trackings ADD COLUMN nota_credito TEXT'); } catch(e) {}

  db.exec(`
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
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT,
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);
  try { db.exec('ALTER TABLE retrabajos ADD COLUMN detalle_sku_id TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE retrabajos ADD COLUMN retrabajo_otro TEXT'); } catch(e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS foto_sesiones (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      tracking_id TEXT,
      detalle_sku_id TEXT,
      contexto TEXT,
      estatus TEXT DEFAULT 'pendiente',
      url_foto TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      expires_at TEXT NOT NULL
    )
  `);
  try { db.exec("ALTER TABLE foto_sesiones ADD COLUMN total_fotos INTEGER DEFAULT 1"); } catch(e) {}
  try { db.exec("ALTER TABLE foto_sesiones ADD COLUMN fotos_urls TEXT DEFAULT '[]'"); } catch(e) {}
  try { db.exec("ALTER TABLE foto_sesiones ADD COLUMN fotos_contextos TEXT DEFAULT '[]'"); } catch(e) {}
  db.exec("DELETE FROM foto_sesiones WHERE expires_at < datetime('now')");

  db.exec(`
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
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  try { db.exec('ALTER TABLE detalle_skus ADD COLUMN es_nuevo INTEGER DEFAULT 0'); } catch(e) {}

  // Config table for migration markers
  db.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);

  // Auth tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'OPERADOR',
      activo INTEGER DEFAULT 1,
      ultimo_acceso TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuario_clientes (
      usuario_id TEXT NOT NULL,
      cliente_id TEXT NOT NULL,
      PRIMARY KEY (usuario_id, cliente_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sesiones (
      token TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  db.exec("DELETE FROM sesiones WHERE expires_at < datetime('now','localtime')");

  db.exec(`
    CREATE TABLE IF NOT EXISTS config_smtp (
      id INTEGER PRIMARY KEY DEFAULT 1,
      host TEXT,
      port INTEGER DEFAULT 587,
      user TEXT,
      pass TEXT,
      from_name TEXT DEFAULT 'Sistema Logístico',
      updated_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS correos_enviados (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      nombre_usuario TEXT NOT NULL,
      destinatarios TEXT NOT NULL,
      asunto TEXT NOT NULL,
      mensaje_adicional TEXT,
      total_comentarios_incluidos INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracking_comentarios (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      nombre_usuario TEXT NOT NULL,
      rol_usuario TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);

  // One-time migration: convert all UTC timestamps stored before the localtime fix
  const migDone = db.prepare("SELECT value FROM config WHERE key='utc_to_local_v1'").get();
  if (!migDone) {
    const tsTables = [
      'clientes', 'skus', 'cajas_pallets', 'trackings',
      'detalle_skus', 'skus_nuevos', 'errores', 'retrabajos', 'alertas_discrepancia'
    ];
    tsTables.forEach(t => {
      try { db.exec(`UPDATE ${t} SET created_at = datetime(created_at, 'localtime') WHERE created_at IS NOT NULL`); } catch(e) {}
    });
    try { db.exec("UPDATE trackings SET closed_at = datetime(closed_at, 'localtime') WHERE closed_at IS NOT NULL"); } catch(e) {}
    try { db.exec("UPDATE cajas_pallets SET closed_at = datetime(closed_at, 'localtime') WHERE closed_at IS NOT NULL"); } catch(e) {}
    try { db.exec("UPDATE retrabajos SET updated_at = datetime(updated_at, 'localtime') WHERE updated_at IS NOT NULL"); } catch(e) {}
    db.prepare("INSERT INTO config (key,value) VALUES (?,?)").run('utc_to_local_v1', 'done');
    console.log('✅ Migración UTC→local completada');
  }

  // Migrations: chat resolved state
  try { db.exec('ALTER TABLE trackings ADD COLUMN chat_resuelto INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE trackings ADD COLUMN chat_resuelto_por TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE trackings ADD COLUMN chat_resuelto_at TEXT'); } catch(e) {}

  // Migrations: G0 Procesamiento
  try { db.exec('ALTER TABLE clientes ADD COLUMN validacion_piezas INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE clientes ADD COLUMN validacion_condicion INTEGER DEFAULT 0'); } catch(e) {}
  db.exec("UPDATE clientes SET validacion_piezas = 0 WHERE validacion_piezas IS NULL");
  db.exec("UPDATE clientes SET validacion_condicion = 0 WHERE validacion_condicion IS NULL");

  // Migration: foto de evidencia al registrar SKU nuevo (default 1 = requerida)
  try { db.exec('ALTER TABLE clientes ADD COLUMN requiere_fotos_sku_nuevo INTEGER DEFAULT 1'); } catch(e) {}
  db.exec("UPDATE clientes SET requiere_fotos_sku_nuevo = 1 WHERE requiere_fotos_sku_nuevo IS NULL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS ordenes (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL,
      archivo_nombre TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      total_trackings INTEGER DEFAULT 0,
      total_piezas INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orden_items (
      id TEXT PRIMARY KEY,
      orden_id TEXT NOT NULL,
      cliente_id TEXT NOT NULL,
      order_number TEXT,
      product_title TEXT,
      sku TEXT NOT NULL,
      barcode TEXT,
      quantity INTEGER DEFAULT 1,
      country_of_origin TEXT,
      tracking_number TEXT NOT NULL,
      content TEXT,
      FOREIGN KEY (orden_id) REFERENCES ordenes(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS g0_piezas (
      id TEXT PRIMARY KEY,
      tracking_id TEXT NOT NULL,
      orden_item_id TEXT,
      sku TEXT,
      product_title TEXT,
      order_number TEXT,
      barcode TEXT,
      condicion TEXT DEFAULT 'Buena',
      pais_coincide INTEGER DEFAULT 1,
      pais_real TEXT,
      insumos_coincide INTEGER DEFAULT 1,
      insumos_real TEXT,
      operador TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (tracking_id) REFERENCES trackings(id)
    )
  `);
  try { db.exec('ALTER TABLE g0_piezas ADD COLUMN pais_coincide INTEGER DEFAULT 1'); } catch(e) {}
  try { db.exec('ALTER TABLE g0_piezas ADD COLUMN pais_real TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE g0_piezas ADD COLUMN insumos_coincide INTEGER DEFAULT 1'); } catch(e) {}
  try { db.exec('ALTER TABLE g0_piezas ADD COLUMN insumos_real TEXT'); } catch(e) {}

  // Datos demo
  const check = db.prepare("SELECT COUNT(*) as cnt FROM clientes").get();
  if (check.cnt === 0) {
    seedData();
  }

  // Crear admin por defecto si no existe ningún usuario
  const adminCheck = db.prepare("SELECT COUNT(*) as cnt FROM usuarios").get();
  if (adminCheck.cnt === 0) {
    const hash = await bcrypt.hash('Admin123!', 10);
    db.prepare(`INSERT INTO usuarios (id,nombre,email,password_hash,rol,activo,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(uuidv4(), 'Administrador', 'admin@sistema.com', hash, 'ADMIN', 1, localNow());
    console.log('👤 Usuario admin creado: admin@sistema.com / Admin123!');
  }

  console.log('✅ Base de datos inicializada');
}

function seedData() {
  const clientes = [
    { id: uuidv4(), nombre: 'Textiles Express SA', grado: 1, pct: 30, calidad: 0, retrabajo: 0 },
    { id: uuidv4(), nombre: 'Moda Global MX', grado: 2, pct: 30, calidad: 1, retrabajo: 0 },
    { id: uuidv4(), nombre: 'Confecciones Premium', grado: 3, pct: 100, calidad: 1, retrabajo: 1 },
  ];

  clientes.forEach(c => {
    dbRun(`INSERT INTO clientes VALUES (?,?,?,?,?,?,?)`,
      [c.id, c.nombre, c.grado, c.pct, c.calidad, c.retrabajo, localNow()]);

    // SKUs demo por cliente
    const skusDemo = [
      { id: uuidv4(), code: `SKU-${c.nombre.substring(0,3).toUpperCase()}-001`, desc: 'Camisa Básica', pais: 'China', insumos: '100% Algodón' },
      { id: uuidv4(), code: `SKU-${c.nombre.substring(0,3).toUpperCase()}-002`, desc: 'Pantalón Slim', pais: 'Bangladesh', insumos: '65% Poliéster 35% Algodón' },
      { id: uuidv4(), code: `SKU-${c.nombre.substring(0,3).toUpperCase()}-003`, desc: 'Vestido Floral', pais: 'Vietnam', insumos: '100% Viscosa' },
    ];
    skusDemo.forEach(s => {
      dbRun(`INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code) VALUES (?,?,?,?,?,?,?)`,
        [s.id, c.id, s.code, s.desc, s.pais, s.insumos, null]);
    });
  });

  console.log('✅ Datos demo insertados');
}

function dbAll(sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (e) {
    console.error('DB Error:', e.message, sql);
    return [];
  }
}

function dbGet(sql, params = []) {
  try {
    return db.prepare(sql).get(...params) ?? null;
  } catch (e) {
    console.error('DB Error:', e.message, sql);
    return null;
  }
}

function dbRun(sql, params = []) {
  try {
    db.prepare(sql).run(...params);
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

// ===================== EMAIL =====================

const RESEND_FROM = () => `Retornos <${process.env.SMTP_FROM_EMAIL || 'retornos@updates.flaviovalladolid.shop'}>`;

function escH(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getResendClient() {
  if (!ResendSDK || !process.env.RESEND_API_KEY) return null;
  return new ResendSDK.Resend(process.env.RESEND_API_KEY);
}

function buildEmailHtml({ tracking, errores, comentarios, remitente, mensaje_adicional, asunto }) {
  const ROL_LABELS = { ADMIN:'Admin', SUPERVISOR:'Supervisor', OPERADOR:'Operador', CLIENTE:'Cliente', LOGISTICA:'Logística' };
  const isClosed   = tracking.estatus === 'cerrado';
  const statusColor = isClosed ? '#16a34a' : '#d97706';
  const statusLabel = isClosed ? '✓ Cerrado' : '⟳ Abierto';
  const gradoLabels = { 1:'Grado 1 — Bajo', 2:'Grado 2 — Medio', 3:'Grado 3 — Alto' };
  const gradoLabel  = gradoLabels[tracking.grado_confianza] || `Grado ${tracking.grado_confianza}`;
  const totalErrores = errores.reduce((s, e) => s + (e.total || 0), 0);

  const erroresRows = errores.length > 0
    ? errores.map(e => `<tr><td style="padding:7px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#374151">${escH(e.tipo_error)}</td><td style="padding:7px 14px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-size:13px;color:#dc2626">${e.total}</td></tr>`).join('')
    : '<tr><td colspan="2" style="padding:10px 14px;color:#9ca3af;font-style:italic;font-size:13px">Sin errores registrados</td></tr>';

  const comentariosHtml = comentarios.length > 0
    ? comentarios.map((c, i) => `
        <div style="padding:12px 0;${i > 0 ? 'border-top:1px solid #f0f0f0;' : ''}">
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px">
            <tr>
              <td style="font-size:13px;font-weight:700;color:#1e293b">${escH(c.nombre_usuario)} <span style="font-weight:400;color:#94a3b8;font-size:12px">(${ROL_LABELS[c.rol_usuario] || escH(c.rol_usuario)})</span></td>
              <td style="text-align:right;font-size:11px;color:#94a3b8;white-space:nowrap;font-family:monospace">${escH(c.created_at)}</td>
            </tr>
          </table>
          <div style="font-size:14px;color:#475569;line-height:1.6;white-space:pre-wrap">${escH(c.mensaje)}</div>
        </div>`).join('')
    : '<p style="color:#94a3b8;font-style:italic;font-size:13px">No hay comentarios en este tracking.</p>';

  const mensajeSection = mensaje_adicional
    ? `<div style="margin-bottom:24px;padding:14px 16px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 6px 6px 0">
         <div style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Mensaje de ${escH(remitente.nombre)}</div>
         <div style="font-size:14px;color:#78350f;line-height:1.6">${mensaje_adicional}</div>
       </div>` : '';

  const now = localNow();

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td>
  <table width="600" cellpadding="0" cellspacing="0" align="center" style="max-width:600px;margin:0 auto">

    <!-- HEADER -->
    <tr><td style="background:#0f172a;padding:28px 32px;border-radius:12px 12px 0 0">
      <div style="font-size:10px;letter-spacing:.2em;color:#475569;text-transform:uppercase;margin-bottom:8px">Sistema Logístico de Inspección</div>
      <div style="font-size:22px;font-weight:700;color:#f8fafc;line-height:1.25">${escH(asunto)}</div>
      <div style="height:3px;background:${statusColor};margin-top:18px;border-radius:2px;width:80px"></div>
    </td></tr>

    <!-- TRACKING INFO -->
    <tr><td style="background:#ffffff;padding:28px 32px;border:1px solid #e2e8f0;border-top:none">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.1em;margin-bottom:16px">Información del Tracking</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <tr style="background:#f8fafc"><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;width:40%">Tracking #</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#0f172a;font-family:monospace;border-bottom:1px solid #e2e8f0">${escH(tracking.tracking_number)}</td></tr>
        <tr><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">Cliente</td><td style="padding:10px 14px;font-size:13px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0">${escH(tracking.cliente_nombre)}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">Caja / Pallet</td><td style="padding:10px 14px;font-size:13px;font-family:monospace;color:#0f172a;border-bottom:1px solid #e2e8f0">${tracking.caja_id ? escH(tracking.caja_id) : '—'}</td></tr>
        <tr><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">Grado de confianza</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0">${gradoLabel}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">Estado</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:${statusColor};border-bottom:1px solid #e2e8f0">${statusLabel}</td></tr>
        <tr><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">Piezas declaradas</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0">${tracking.cantidad_declarada || 0}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">Piezas inspeccionadas</td><td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0">${tracking.cantidad_final || 0}</td></tr>
        <tr><td style="padding:10px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">Total errores</td><td style="padding:10px 14px;font-size:13px;font-weight:700;color:${totalErrores > 0 ? '#dc2626' : '#16a34a'};border-bottom:1px solid #e2e8f0">${totalErrores}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:10px 14px;font-size:12px;color:#64748b;${tracking.closed_at ? 'border-bottom:1px solid #e2e8f0;' : ''}">Fecha creación</td><td style="padding:10px 14px;font-size:12px;font-family:monospace;color:#64748b;${tracking.closed_at ? 'border-bottom:1px solid #e2e8f0;' : ''}">${escH(tracking.created_at || '—')}</td></tr>
        ${tracking.closed_at ? `<tr><td style="padding:10px 14px;font-size:12px;color:#64748b">Fecha cierre</td><td style="padding:10px 14px;font-size:12px;font-family:monospace;color:#64748b">${escH(tracking.closed_at)}</td></tr>` : ''}
      </table>

      ${errores.length > 0 ? `
      <div style="margin-top:24px">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">Errores Registrados</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          <tr style="background:#fef2f2"><th style="padding:8px 14px;text-align:left;font-size:11px;color:#dc2626;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0">Tipo de Error</th><th style="padding:8px 14px;text-align:right;font-size:11px;color:#dc2626;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0">Total</th></tr>
          ${erroresRows}
        </table>
      </div>` : ''}
    </td></tr>

    <!-- CONVERSACIÓN -->
    <tr><td style="background:#f8fafc;padding:28px 32px;border:1px solid #e2e8f0;border-top:none">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.1em;margin-bottom:20px">Conversación reciente (${comentarios.length} comentario${comentarios.length !== 1 ? 's' : ''})</div>
      ${mensajeSection}
      ${comentariosHtml}
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:#0f172a;padding:20px 32px;border-radius:0 0 12px 12px">
      <div style="font-size:12px;color:#94a3b8;line-height:1.7">
        Este correo fue enviado por <strong style="color:#e2e8f0">${escH(remitente.nombre)}</strong> (${ROL_LABELS[remitente.rol] || escH(remitente.rol)}) desde el Sistema Logístico.<br>
        Fecha de envío: <span style="font-family:monospace">${now}</span>
      </div>
      <div style="margin-top:10px;font-size:11px;color:#475569">Este es un correo informativo generado automáticamente.</div>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}

// ===================== AUTH MIDDLEWARE =====================

const AUTH_BYPASS = [
  { method: 'POST', path: '/auth/login' },
];

function authMiddleware(req, res, next) {
  // Skip for photo session routes (mobile upload) — path is relative to /api mount
  if (req.path.startsWith('/foto-sesion/')) return next();
  // Check bypass list
  const bypass = AUTH_BYPASS.some(b => b.method === req.method && req.path === b.path);
  if (bypass) return next();

  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  const sesion = dbGet(
    "SELECT s.*, u.id as uid, u.nombre, u.email, u.rol, u.activo FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=? AND s.expires_at > datetime('now','localtime')",
    [token]
  );
  if (!sesion) return res.status(401).json({ error: 'Sesión expirada o inválida' });
  if (!sesion.activo) return res.status(403).json({ error: 'Usuario desactivado' });

  req.usuario = { id: sesion.uid, nombre: sesion.nombre, email: sesion.email, rol: sesion.rol };

  // Block write operations for read-only roles
  if (['CLIENTE', 'LOGISTICA'].includes(sesion.rol) && ['POST','PUT','DELETE'].includes(req.method)) {
    // Allow password change (req.path is relative to /api mount)
    if (req.path === '/auth/cambiar-password') return next();
    // Allow logout
    if (req.path === '/auth/logout') return next();
    // Allow posting comments and toggling chat resolved state
    if (req.method === 'POST' && /^\/trackings\/[^/]+\/comentarios$/.test(req.path)) return next();
    if (req.method === 'POST' && /^\/trackings\/[^/]+\/chat-resuelto$/.test(req.path)) return next();
    // Allow sending email (CLIENTE yes, LOGISTICA no)
    if (req.method === 'POST' && /^\/trackings\/[^/]+\/enviar-correo$/.test(req.path) && sesion.rol === 'CLIENTE') return next();
    // Allow CLIENTE to mark refunded and capture nota de crédito
    if (req.method === 'PUT' && /^\/trackings\/[^/]+\/refunded$/.test(req.path) && sesion.rol === 'CLIENTE') return next();
    if (req.method === 'PUT' && /^\/trackings\/[^/]+\/nota-credito$/.test(req.path) && sesion.rol === 'CLIENTE') return next();
    return res.status(403).json({ error: 'Sin permiso para esta operación' });
  }

  next();
}

function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permiso' });
    next();
  };
}

function getUserClienteIds(usuario_id, rol) {
  if (rol === 'ADMIN' || rol === 'SUPERVISOR') return null; // null = all clients
  const rows = dbAll('SELECT cliente_id FROM usuario_clientes WHERE usuario_id=?', [usuario_id]);
  return rows.map(r => r.cliente_id);
}

// Returns SQL fragment + params to restrict a query to the user's assigned clients.
// alias: table alias that has the column to match (default 't', column default 'cliente_id')
// col: override column name — use 'id' when alias refers to the clientes table itself
function clienteFilter(usuario, alias = 't', col = 'cliente_id') {
  const ids = getUserClienteIds(usuario.id, usuario.rol);
  if (!ids) return { sql: '', params: [] }; // ADMIN/SUPERVISOR ven todo
  if (ids.length === 0) return { sql: ` AND 1=0`, params: [] }; // sin clientes asignados
  const ph = ids.map(() => '?').join(',');
  return { sql: ` AND ${alias}.${col} IN (${ph})`, params: ids };
}

app.use('/api', authMiddleware);

// ===================== RUTAS AUTH =====================

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const user = dbGet('SELECT * FROM usuarios WHERE email=? AND activo=1', [email.toLowerCase().trim()]);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = uuidv4() + '-' + uuidv4();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  const expiresStr = `${expiresAt.getFullYear()}-${p(expiresAt.getMonth()+1)}-${p(expiresAt.getDate())} ${p(expiresAt.getHours())}:${p(expiresAt.getMinutes())}:${p(expiresAt.getSeconds())}`;

  dbRun('INSERT INTO sesiones (token,usuario_id,expires_at,created_at) VALUES (?,?,?,?)',
    [token, user.id, expiresStr, localNow()]);
  dbRun('UPDATE usuarios SET ultimo_acceso=? WHERE id=?', [localNow(), user.id]);

  const clienteRows = dbAll('SELECT cliente_id FROM usuario_clientes WHERE usuario_id=?', [user.id]);
  const clienteIds = (user.rol === 'ADMIN' || user.rol === 'SUPERVISOR') ? null : clienteRows.map(r => r.cliente_id);
  res.json({ token, id: user.id, rol: user.rol, nombre: user.nombre, email: user.email, clienteIds });
});

app.get('/api/auth/me', (req, res) => {
  const u = req.usuario;
  const clienteIds = getUserClienteIds(u.id, u.rol);
  res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, clienteIds });
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) dbRun('DELETE FROM sesiones WHERE token=?', [token]);
  res.json({ mensaje: 'Sesión cerrada' });
});

app.put('/api/auth/cambiar-password', async (req, res) => {
  const { password_actual, password_nuevo } = req.body;
  if (!password_actual || !password_nuevo) return res.status(400).json({ error: 'Campos requeridos' });
  if (password_nuevo.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const user = dbGet('SELECT * FROM usuarios WHERE id=?', [req.usuario.id]);
  const match = await bcrypt.compare(password_actual, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  const hash = await bcrypt.hash(password_nuevo, 10);
  dbRun('UPDATE usuarios SET password_hash=? WHERE id=?', [hash, req.usuario.id]);
  res.json({ mensaje: 'Contraseña actualizada' });
});

// --- USUARIOS (ADMIN only) ---
app.get('/api/usuarios', requireRol('ADMIN'), (req, res) => {
  const users = dbAll('SELECT id,nombre,email,rol,activo,ultimo_acceso,created_at FROM usuarios ORDER BY nombre');
  users.forEach(u => {
    const clientes = dbAll('SELECT c.id,c.nombre FROM usuario_clientes uc JOIN clientes c ON c.id=uc.cliente_id WHERE uc.usuario_id=?', [u.id]);
    u.clientes = clientes;
  });
  res.json(users);
});

app.post('/api/usuarios', requireRol('ADMIN'), async (req, res) => {
  const { nombre, email, password, rol, activo, cliente_ids } = req.body;
  if (!nombre || !email || !password || !rol) return res.status(400).json({ error: 'Campos requeridos: nombre, email, password, rol' });
  const roles = ['ADMIN','SUPERVISOR','OPERADOR','CLIENTE','LOGISTICA'];
  if (!roles.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  const existing = dbGet('SELECT id FROM usuarios WHERE email=?', [email.toLowerCase().trim()]);
  if (existing) return res.status(400).json({ error: 'Email ya registrado' });
  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  dbRun('INSERT INTO usuarios (id,nombre,email,password_hash,rol,activo,created_at) VALUES (?,?,?,?,?,?,?)',
    [id, nombre, email.toLowerCase().trim(), hash, rol, activo !== false ? 1 : 0, localNow()]);
  if (Array.isArray(cliente_ids)) {
    cliente_ids.forEach(cid => {
      dbRun('INSERT OR IGNORE INTO usuario_clientes (usuario_id,cliente_id) VALUES (?,?)', [id, cid]);
    });
  }
  res.json({ id, mensaje: 'Usuario creado' });
});

app.put('/api/usuarios/:id', requireRol('ADMIN'), (req, res) => {
  const { nombre, email, rol, activo } = req.body;
  if (!nombre || !email || !rol) return res.status(400).json({ error: 'Campos requeridos' });
  dbRun('UPDATE usuarios SET nombre=?,email=?,rol=?,activo=? WHERE id=?',
    [nombre, email.toLowerCase().trim(), rol, activo !== false ? 1 : 0, req.params.id]);
  res.json({ mensaje: 'Usuario actualizado' });
});

app.delete('/api/usuarios/:id', requireRol('ADMIN'), (req, res) => {
  if (req.params.id === req.usuario.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  dbRun('DELETE FROM sesiones WHERE usuario_id=?', [req.params.id]);
  dbRun('DELETE FROM usuario_clientes WHERE usuario_id=?', [req.params.id]);
  dbRun('DELETE FROM usuarios WHERE id=?', [req.params.id]);
  res.json({ mensaje: 'Usuario eliminado' });
});

app.put('/api/usuarios/:id/resetear-password', requireRol('ADMIN'), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Contraseña inválida (mínimo 6 caracteres)' });
  const hash = await bcrypt.hash(password, 10);
  dbRun('UPDATE usuarios SET password_hash=? WHERE id=?', [hash, req.params.id]);
  dbRun('DELETE FROM sesiones WHERE usuario_id=?', [req.params.id]);
  res.json({ mensaje: 'Contraseña restablecida' });
});

app.get('/api/usuarios/:id/clientes', requireRol('ADMIN'), (req, res) => {
  const clientes = dbAll('SELECT c.id,c.nombre FROM usuario_clientes uc JOIN clientes c ON c.id=uc.cliente_id WHERE uc.usuario_id=?', [req.params.id]);
  res.json(clientes);
});

app.put('/api/usuarios/:id/clientes', requireRol('ADMIN'), (req, res) => {
  const { cliente_ids } = req.body;
  dbRun('DELETE FROM usuario_clientes WHERE usuario_id=?', [req.params.id]);
  if (Array.isArray(cliente_ids)) {
    cliente_ids.forEach(cid => {
      dbRun('INSERT OR IGNORE INTO usuario_clientes (usuario_id,cliente_id) VALUES (?,?)', [req.params.id, cid]);
    });
  }
  res.json({ mensaje: 'Clientes asignados' });
});

// ===================== RUTAS API =====================

// --- CLIENTES ---
app.get('/api/clientes', (req, res) => {
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 'c', 'id');
  const rows = dbAll(`SELECT * FROM clientes c WHERE 1=1${cf} ORDER BY nombre`, cp);
  res.json(rows);
});

app.get('/api/clientes/:id', (req, res) => {
  const row = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(row);
});

app.post('/api/clientes', (req, res) => {
  const { nombre, grado_confianza, porcentaje_muestreo, modulo_calidad, modulo_retrabajo, tipo_almacenamiento, uph, tipo_mercancia, fotos_adicionales, requiere_orden, requiere_tipo_retorno, requiere_nota_credito, requiere_nombre_destinatario, validacion_piezas, validacion_condicion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const id = uuidv4();
  const grado = grado_confianza !== undefined && grado_confianza !== null && grado_confianza !== '' ? parseInt(grado_confianza) : 2;
  const fa = grado === 3 ? Math.max(0, Math.min(4, parseInt(fotos_adicionales) || 0)) : 0;
  const vp = grado === 0 ? (validacion_piezas ? 1 : 0) : 0;
  const vc = grado === 0 ? (validacion_condicion ? 1 : 0) : 0;
  console.log(`POST /clientes → nombre="${nombre}" grado=${grado}`);
  const { requiere_fotos_sku_nuevo } = req.body;
  const rfn = grado === 0 ? 0 : (requiere_fotos_sku_nuevo ? 1 : 0);
  const ok = dbRun(`INSERT INTO clientes (id,nombre,grado_confianza,porcentaje_muestreo,modulo_calidad,modulo_retrabajo,tipo_almacenamiento,uph,tipo_mercancia,fotos_adicionales,requiere_orden,requiere_tipo_retorno,requiere_nota_credito,requiere_nombre_destinatario,validacion_piezas,validacion_condicion,requiere_fotos_sku_nuevo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, nombre, grado, porcentaje_muestreo || 30, modulo_calidad ? 1 : 0, modulo_retrabajo ? 1 : 0, tipo_almacenamiento || 'caja', uph || 0, tipo_mercancia || 'textil', fa, requiere_orden ? 1 : 0, requiere_tipo_retorno ? 1 : 0, requiere_nota_credito ? 1 : 0, requiere_nombre_destinatario ? 1 : 0, vp, vc, rfn, localNow()]);
  if (!ok) return res.status(500).json({ error: 'Error al guardar en base de datos' });
  res.json({ id, mensaje: 'Cliente creado' });
});

app.put('/api/clientes/:id', (req, res) => {
  const { nombre, grado_confianza, porcentaje_muestreo, modulo_calidad, modulo_retrabajo, tipo_almacenamiento, uph, tipo_mercancia, fotos_adicionales, requiere_orden, requiere_tipo_retorno, requiere_nota_credito, requiere_nombre_destinatario, validacion_piezas, validacion_condicion, requiere_fotos_sku_nuevo } = req.body;
  const grado = grado_confianza !== undefined && grado_confianza !== null && grado_confianza !== '' ? parseInt(grado_confianza) : 2;
  const fa = grado === 3 ? Math.max(0, Math.min(4, parseInt(fotos_adicionales) || 0)) : 0;
  const vp = grado === 0 ? (validacion_piezas ? 1 : 0) : 0;
  const vc = grado === 0 ? (validacion_condicion ? 1 : 0) : 0;
  const rfn = grado === 0 ? 0 : (requiere_fotos_sku_nuevo ? 1 : 0);
  console.log(`PUT /clientes/${req.params.id} → grado=${grado}`);
  const ok = dbRun(`UPDATE clientes SET nombre=?,grado_confianza=?,porcentaje_muestreo=?,modulo_calidad=?,modulo_retrabajo=?,tipo_almacenamiento=?,uph=?,tipo_mercancia=?,fotos_adicionales=?,requiere_orden=?,requiere_tipo_retorno=?,requiere_nota_credito=?,requiere_nombre_destinatario=?,validacion_piezas=?,validacion_condicion=?,requiere_fotos_sku_nuevo=? WHERE id=?`,
    [nombre, grado, porcentaje_muestreo || 30, modulo_calidad ? 1 : 0, modulo_retrabajo ? 1 : 0, tipo_almacenamiento || 'caja', uph || 0, tipo_mercancia || 'textil', fa, requiere_orden ? 1 : 0, requiere_tipo_retorno ? 1 : 0, requiere_nota_credito ? 1 : 0, requiere_nombre_destinatario ? 1 : 0, vp, vc, rfn, req.params.id]);
  if (!ok) return res.status(500).json({ error: 'Error al guardar en base de datos — revisa la consola del servidor' });
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
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 's');
  let sql = `SELECT * FROM skus s WHERE 1=1${cf}`;
  let params = [...cp];
  if (cliente_id) { sql += ' AND s.cliente_id = ?'; params.push(cliente_id); }
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
  dbRun(`INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code,created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [id, cliente_id, code, descripcion, pais_origen, insumos, upc_code || null, localNow()]);
  res.json({ id, mensaje: 'SKU creado' });
});

app.post('/api/skus/importar', (req, res) => {
  const { cliente_id, skus } = req.body;
  if (!cliente_id || !Array.isArray(skus) || skus.length === 0)
    return res.status(400).json({ error: 'cliente_id y skus son requeridos' });

  let insertados = 0;
  let actualizados = 0;
  let omitidos = 0;
  skus.forEach(s => {
    const sku_code = (s.sku_code || '').trim().toUpperCase();
    if (!sku_code) { omitidos++; return; }
    const pais       = (s.pais_origen || '').trim();
    const upc        = (s.upc_code   || '').trim() || null;
    const descripcion = (s.descripcion || '').trim();
    const insumos    = (s.insumos    || '').trim();

    // If SKU + cliente + país already exists → overwrite descripcion, insumos, upc
    const existeClave = dbGet(
      'SELECT id FROM skus WHERE sku_code=? AND cliente_id=? AND COALESCE(pais_origen,"")=?',
      [sku_code, cliente_id, pais]
    );
    if (existeClave) {
      // UPC conflict: if new UPC is already used by a DIFFERENT record, keep old UPC
      let nuevoUpc = upc;
      if (upc) {
        const upcEnOtro = dbGet('SELECT id FROM skus WHERE upc_code=? AND cliente_id=? AND id!=?', [upc, cliente_id, existeClave.id]);
        if (upcEnOtro) nuevoUpc = null; // don't overwrite UPC to avoid conflict
      }
      dbRun('UPDATE skus SET descripcion=?,insumos=?,upc_code=? WHERE id=?',
        [descripcion, insumos, nuevoUpc !== null ? nuevoUpc : upc, existeClave.id]);
      actualizados++;
      return;
    }

    // New record: check UPC uniqueness within the same client before inserting
    if (upc) {
      const existeUPC = dbGet('SELECT id FROM skus WHERE upc_code=? AND cliente_id=?', [upc, cliente_id]);
      if (existeUPC) { omitidos++; return; }
    }
    dbRun('INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code,created_at) VALUES (?,?,?,?,?,?,?,?)', [
      uuidv4(), cliente_id, sku_code, descripcion, pais, insumos, upc, localNow()
    ]);
    insertados++;
  });
  res.json({ insertados, actualizados, omitidos });
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
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 'cp');
  let sql = `SELECT cp.*, c.nombre as cliente_nombre FROM cajas_pallets cp JOIN clientes c ON cp.cliente_id = c.id WHERE 1=1${cf}`;
  const params = [...cp];
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

  // Generate nombre; increment consecutive until the name is globally unique
  const iniciales = cliente.nombre.replace(/\s+/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
  const abr = { 'Damage': 'DMG', 'Good Condition': 'GDC', 'Non-brand merchandise': 'NBM' }[tipo] || 'UNK';
  const prefix = `${iniciales}-${abr}-`;

  const lastCons = dbGet('SELECT MAX(consecutivo) as max FROM cajas_pallets WHERE cliente_id = ? AND tipo = ?', [cliente_id, tipo]);
  let consecutivo = (lastCons?.max || 0) + 1;
  let nombre = `${prefix}${String(consecutivo).padStart(3, '0')}`;

  // If the name is already taken (by another client with same initials), find next free slot globally
  while (dbGet('SELECT id FROM cajas_pallets WHERE nombre = ?', [nombre])) {
    consecutivo += 1;
    nombre = `${prefix}${String(consecutivo).padStart(3, '0')}`;
  }

  const id = uuidv4();
  dbRun('INSERT INTO cajas_pallets (id,cliente_id,nombre,tipo,consecutivo,estatus,created_at) VALUES (?,?,?,?,?,?,?)',
    [id, cliente_id, nombre, tipo, consecutivo, 'Abierta', localNow()]);

  const created = dbGet(`SELECT cp.*, c.nombre as cliente_nombre FROM cajas_pallets cp JOIN clientes c ON cp.cliente_id = c.id WHERE cp.id = ?`, [id]);
  res.json(created);
});

app.put('/api/cajas/:id/cerrar', (req, res) => {
  const caja = dbGet('SELECT * FROM cajas_pallets WHERE id = ?', [req.params.id]);
  if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
  if (caja.estatus === 'Cerrada') return res.status(400).json({ error: 'La caja ya está cerrada' });
  dbRun("UPDATE cajas_pallets SET estatus='Cerrada', closed_at=datetime('now', 'localtime') WHERE id=?", [req.params.id]);
  res.json({ mensaje: 'Caja cerrada' });
});

// Reporte por tipo de caja
app.get('/api/reportes/tipo-caja', (req, res) => {
  const { cliente_id, tipo, fecha_desde, fecha_hasta } = req.query;
  let sql = `
    SELECT cp.id, cp.nombre, cp.tipo, cp.consecutivo, cp.estatus,
           cp.created_at, cp.closed_at,
           c.nombre as cliente_nombre,
           COUNT(DISTINCT t.id)          as num_trackings,
           COALESCE(agg.num_skus,    0)  as num_skus,
           COALESCE(agg.total_piezas,0)  as total_piezas
    FROM cajas_pallets cp
    JOIN clientes c ON cp.cliente_id = c.id
    LEFT JOIN trackings t ON t.caja_pallet_id = cp.id
    LEFT JOIN (
      SELECT caja_pallet_id,
             COUNT(DISTINCT sku_key) as num_skus,
             SUM(piezas)             as total_piezas
      FROM (
        SELECT t2.caja_pallet_id, 'D:'||d.sku_code as sku_key, d.cantidad as piezas
        FROM detalle_skus d JOIN trackings t2 ON d.tracking_id = t2.id
        UNION ALL
        SELECT t2.caja_pallet_id, 'G:'||g.sku as sku_key, 1 as piezas
        FROM g0_piezas g JOIN trackings t2 ON g.tracking_id = t2.id
      ) combined
      GROUP BY caja_pallet_id
    ) agg ON agg.caja_pallet_id = cp.id
    WHERE 1=1${clienteFilter(req.usuario, 'cp').sql}
  `;
  const params = [...clienteFilter(req.usuario, 'cp').params];
  if (cliente_id)  { sql += ' AND cp.cliente_id = ?'; params.push(cliente_id); }
  if (tipo)        { sql += ' AND cp.tipo = ?'; params.push(tipo); }
  if (fecha_desde) { sql += " AND date(cp.created_at) >= ?"; params.push(fecha_desde); }
  if (fecha_hasta) { sql += " AND date(cp.created_at) <= ?"; params.push(fecha_hasta); }
  sql += ' GROUP BY cp.id ORDER BY cp.tipo, cp.created_at DESC';
  res.json(dbAll(sql, params));
});

// --- TRACKINGS ---
app.get('/api/trackings', (req, res) => {
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');
  const extraWhere = [];
  const extraParams = [];
  if (req.query.numero_orden) { extraWhere.push('t.numero_orden = ?'); extraParams.push(req.query.numero_orden); }
  if (req.query.grado)        { extraWhere.push('c.grado_confianza = ?'); extraParams.push(req.query.grado); }
  if (req.query.estatus)      { extraWhere.push("t.estatus = ?"); extraParams.push(req.query.estatus); }
  const extraSql = extraWhere.length ? ' AND ' + extraWhere.join(' AND ') : '';

  const rows = dbAll(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza, c.modulo_calidad, c.modulo_retrabajo, c.porcentaje_muestreo, c.tipo_almacenamiento, c.tipo_mercancia, c.fotos_adicionales, c.requiere_orden, c.requiere_tipo_retorno, c.requiere_nota_credito, c.requiere_nombre_destinatario, c.validacion_piezas, c.validacion_condicion, c.requiere_fotos_sku_nuevo,
      COALESCE((SELECT COUNT(*) FROM tracking_comentarios tc WHERE tc.tracking_id = t.id), 0) as total_comentarios,
      CASE WHEN COALESCE((SELECT COUNT(*) FROM tracking_comentarios tc WHERE tc.tracking_id = t.id), 0) > 0 AND COALESCE(t.chat_resuelto, 0) = 0 THEN 1 ELSE 0 END as tiene_comentarios
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE 1=1${cf}${extraSql}
    ORDER BY t.created_at DESC
  `, [...cp, ...extraParams]);
  res.json(rows);
});

app.get('/api/trackings/:id', (req, res) => {
  const row = dbGet(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza, c.modulo_calidad, c.modulo_retrabajo, c.porcentaje_muestreo, c.tipo_almacenamiento, c.tipo_mercancia, c.fotos_adicionales, c.requiere_orden, c.requiere_tipo_retorno, c.requiere_nota_credito, c.requiere_nombre_destinatario, c.validacion_piezas, c.validacion_condicion, c.requiere_fotos_sku_nuevo
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE t.id = ?
  `, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Tracking no encontrado' });
  res.json(row);
});

// ── Comentarios de Tracking ────────────────────────────────────────────────────
app.get('/api/trackings/:id/comentarios', (req, res) => {
  const rows = dbAll(
    `SELECT * FROM tracking_comentarios WHERE tracking_id = ? ORDER BY created_at ASC`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/trackings/:id/comentarios', (req, res) => {
  const { mensaje } = req.body;
  if (!mensaje || !mensaje.trim()) return res.status(400).json({ error: 'Mensaje requerido' });
  const tracking = dbGet('SELECT id, chat_resuelto FROM trackings WHERE id = ?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  const id = uuidv4();
  dbRun(
    `INSERT INTO tracking_comentarios (id,tracking_id,usuario_id,nombre_usuario,rol_usuario,mensaje,created_at) VALUES (?,?,?,?,?,?,?)`,
    [id, req.params.id, req.usuario.id, req.usuario.nombre, req.usuario.rol, mensaje.trim(), localNow()]
  );
  const reactivado = !!tracking.chat_resuelto;
  if (reactivado) {
    dbRun('UPDATE trackings SET chat_resuelto=0, chat_resuelto_por=NULL, chat_resuelto_at=NULL WHERE id=?', [req.params.id]);
  }
  res.json({ id, mensaje: 'Comentario agregado', reactivado });
});

app.delete('/api/trackings/:id/comentarios/:cid', requireRol('ADMIN'), (req, res) => {
  dbRun('DELETE FROM tracking_comentarios WHERE id = ? AND tracking_id = ?', [req.params.cid, req.params.id]);
  res.json({ ok: true });
});

app.post('/api/trackings/:id/chat-resuelto', (req, res) => {
  const tracking = dbGet('SELECT id, chat_resuelto FROM trackings WHERE id = ?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  const nuevoEstado = tracking.chat_resuelto ? 0 : 1;
  if (nuevoEstado === 1) {
    dbRun('UPDATE trackings SET chat_resuelto=1, chat_resuelto_por=?, chat_resuelto_at=? WHERE id=?',
      [req.usuario.nombre, localNow(), req.params.id]);
  } else {
    dbRun('UPDATE trackings SET chat_resuelto=0, chat_resuelto_por=NULL, chat_resuelto_at=NULL WHERE id=?',
      [req.params.id]);
  }
  res.json({ resuelto: nuevoEstado === 1, nombre: req.usuario.nombre, at: localNow() });
});

app.post('/api/trackings', (req, res) => {
  const { tracking_number, cliente_id, cantidad_declarada, tipo_retorno, razon_retorno, nombre_destinatario } = req.body;
  let { numero_orden } = req.body;
  if (!tracking_number || !cliente_id) {
    return res.status(400).json({ error: 'tracking_number y cliente_id son requeridos' });
  }

  const existing = dbGet('SELECT id FROM trackings WHERE tracking_number = ?', [tracking_number]);
  if (existing) return res.status(400).json({ error: 'Tracking number ya registrado' });

  // Para clientes G0: auto-set numero_orden desde orden_items si no viene en el body
  if (!numero_orden) {
    const clienteData = dbGet('SELECT grado_confianza FROM clientes WHERE id = ?', [cliente_id]);
    if (parseInt(clienteData?.grado_confianza) === 0) {
      const oi = dbGet(
        'SELECT order_number FROM orden_items WHERE tracking_number = ? AND order_number IS NOT NULL LIMIT 1',
        [tracking_number]
      );
      if (oi?.order_number) numero_orden = oi.order_number;
    }
  }

  const operador = req.usuario.email;
  const id = uuidv4();
  dbRun(`INSERT INTO trackings (id,tracking_number,cliente_id,caja_id,caja_pallet_id,operador,cantidad_declarada,cantidad_final,numero_orden,tipo_retorno,razon_retorno,nombre_destinatario,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tracking_number, cliente_id, '', null, operador, cantidad_declarada || 0, cantidad_declarada || 0, numero_orden || null, tipo_retorno || null, razon_retorno || null, nombre_destinatario || null, localNow()]);
  res.json({ id, mensaje: 'Tracking creado' });
});

app.put('/api/trackings/:id', (req, res) => {
  const { cantidad_final, estatus } = req.body;
  dbRun(`UPDATE trackings SET cantidad_final=?, estatus=? WHERE id=?`,
    [cantidad_final, estatus, req.params.id]);
  res.json({ mensaje: 'Tracking actualizado' });
});

app.put('/api/trackings/:id/refunded', (req, res) => {
  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  if (tracking.estatus === 'refunded') return res.json({ mensaje: 'Ya está en estatus refunded' });
  if (tracking.estatus !== 'cerrado') return res.status(400).json({ error: 'El tracking debe estar cerrado antes de marcarlo como refunded' });
  dbRun("UPDATE trackings SET estatus='refunded' WHERE id=?", [req.params.id]);
  res.json({ mensaje: 'Estatus actualizado a refunded' });
});

app.put('/api/trackings/:id/nota-credito', (req, res) => {
  const { nota_credito } = req.body;
  if (!nota_credito?.trim()) return res.status(400).json({ error: 'Número de nota de crédito requerido' });
  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  const duplicate = dbGet(
    'SELECT id, tracking_number FROM trackings WHERE nota_credito=? AND cliente_id=? AND id!=?',
    [nota_credito.trim(), tracking.cliente_id, tracking.id]
  );
  dbRun('UPDATE trackings SET nota_credito=? WHERE id=?', [nota_credito.trim(), tracking.id]);
  res.json({ mensaje: 'Nota de crédito guardada', duplicate: duplicate ? { tracking_number: duplicate.tracking_number } : null });
});

// Cerrar tracking
app.post('/api/trackings/:id/cerrar', (req, res) => {
  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  if (tracking.estatus !== 'abierto') return res.status(400).json({ error: `El tracking ya está en estatus "${tracking.estatus}"` });

  // Validar que no esté vacío (SKUs, G0 piezas o mercancía ajena)
  const totalSkus    = dbGet('SELECT COUNT(*) as cnt FROM detalle_skus WHERE tracking_id=?', [req.params.id]);
  const totalG0      = dbGet('SELECT COUNT(*) as cnt FROM g0_piezas WHERE tracking_id=?', [req.params.id]);
  const tieneMercanciaAjena = dbGet(`SELECT id FROM errores WHERE tracking_id=? AND tipo_error='Mercancía ajena' LIMIT 1`, [req.params.id]);
  if ((totalSkus?.cnt || 0) === 0 && (totalG0?.cnt || 0) === 0 && !tieneMercanciaAjena) {
    return res.status(400).json({ error: 'No se puede cerrar un tracking vacío. Registra al menos un SKU o marca el producto como no correspondiente al cliente.' });
  }

  // Validar errores sin foto
  const erroresSinFoto = dbAll(`
    SELECT * FROM errores WHERE tracking_id=? AND (path_fotografia IS NULL OR path_fotografia='')
  `, [req.params.id]);

  if (erroresSinFoto.length > 0) {
    return res.status(400).json({ error: 'Hay errores sin fotografía de evidencia. No se puede cerrar.' });
  }

  const { caja_pallet_id, numero_orden, nombre_destinatario } = req.body;
  if (!caja_pallet_id) {
    return res.status(400).json({ error: 'Selecciona una caja/pallet para cerrar el tracking' });
  }
  const caja = dbGet('SELECT * FROM cajas_pallets WHERE id = ?', [caja_pallet_id]);
  if (!caja) return res.status(400).json({ error: 'Caja no encontrada' });
  if (caja.cliente_id !== tracking.cliente_id) return res.status(400).json({ error: 'La caja no pertenece a este cliente' });
  if (caja.estatus !== 'Abierta') return res.status(400).json({ error: 'La caja está cerrada' });

  // Validar campos requeridos por configuración del cliente
  const cliente = dbGet('SELECT requiere_orden, requiere_nombre_destinatario FROM clientes WHERE id=?', [tracking.cliente_id]);
  const ordenFinal = (numero_orden || '').trim() || tracking.numero_orden || null;
  const destFinal  = (nombre_destinatario || '').trim() || tracking.nombre_destinatario || null;
  if (cliente?.requiere_orden && !ordenFinal) {
    return res.status(400).json({ error: 'El número de orden es requerido para este cliente' });
  }
  if (cliente?.requiere_nombre_destinatario && !destFinal) {
    return res.status(400).json({ error: 'El nombre del destinatario es requerido para este cliente' });
  }

  // Validar que el tipo de caja corresponda al contenido del tracking
  const erroresTracking = dbAll('SELECT tipo_error FROM errores WHERE tracking_id=?', [req.params.id]);
  const tieneDanado  = erroresTracking.some(e => e.tipo_error === 'Calidad' || e.tipo_error === 'Otro');
  const tieneNoMarca = erroresTracking.some(e => e.tipo_error === 'Mercancía ajena');
  const tieneRetrabajos = (dbGet('SELECT COUNT(*) as cnt FROM retrabajos WHERE tracking_id=?', [req.params.id])?.cnt || 0) > 0;
  const tipoRequerido = (tieneDanado && !tieneRetrabajos) ? 'Damage'
    : tieneNoMarca ? 'Non-brand merchandise'
    : 'Good Condition';

  if (caja.tipo !== tipoRequerido) {
    const labels = { 'Damage': 'Dañado (Damage)', 'Good Condition': 'Buen Estado (Good Condition)', 'Non-brand merchandise': 'Sin Marca (Non-brand)' };
    return res.status(400).json({ error: `Este tracking debe guardarse en una caja de tipo "${labels[tipoRequerido]}" según su contenido. La caja seleccionada es "${labels[caja.tipo]}".` });
  }

  dbRun(
    `UPDATE trackings SET estatus='cerrado', closed_at=datetime('now', 'localtime'), caja_id=?, caja_pallet_id=?, numero_orden=?, nombre_destinatario=? WHERE id=?`,
    [caja.nombre, caja_pallet_id, ordenFinal, destFinal, req.params.id]
  );
  res.json({ mensaje: 'Tracking cerrado exitosamente' });
});

app.put('/api/trackings/:id/orden-destinatario', (req, res) => {
  const tracking = dbGet('SELECT id FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  const { numero_orden, nombre_destinatario } = req.body;
  dbRun(
    `UPDATE trackings SET numero_orden=?, nombre_destinatario=? WHERE id=?`,
    [(numero_orden || '').trim() || null, (nombre_destinatario || '').trim() || null, req.params.id]
  );
  res.json({ mensaje: 'Actualizado correctamente' });
});

// Reasignar caja/pallet a un tracking ya cerrado (o pre-asignar a uno abierto)
app.put('/api/trackings/:id/caja', (req, res) => {
  const tracking = dbGet('SELECT * FROM trackings WHERE id=?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });

  const { caja_pallet_id } = req.body;
  if (!caja_pallet_id) return res.status(400).json({ error: 'caja_pallet_id requerido' });

  const caja = dbGet('SELECT * FROM cajas_pallets WHERE id=?', [caja_pallet_id]);
  if (!caja) return res.status(400).json({ error: 'Caja no encontrada' });
  if (caja.cliente_id !== tracking.cliente_id) return res.status(400).json({ error: 'La caja no pertenece a este cliente' });
  if (caja.estatus !== 'Abierta') return res.status(400).json({ error: 'La caja está cerrada' });

  dbRun('UPDATE trackings SET caja_id=?, caja_pallet_id=? WHERE id=?', [caja.nombre, caja_pallet_id, req.params.id]);
  res.json({ mensaje: 'Caja reasignada', caja_id: caja.nombre, caja_pallet_id });
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
  if (tracking.estatus !== 'abierto') return res.status(400).json({ error: `El tracking está en estatus "${tracking.estatus}" y no acepta nuevos SKUs` });

  const id = uuidv4();
  const esNuevoFlag = es_nuevo ? 1 : 0;
  dbRun(`INSERT INTO detalle_skus (id,tracking_id,sku_code,descripcion,cantidad,pais_origen_catalogo,pais_origen_real,pais_coincide,insumos_catalogo,insumos_real,insumos_coincide,calidad,es_nuevo,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.params.id, sku_code, descripcion, cantidad || 1,
     pais_origen_catalogo, pais_origen_real || pais_origen_catalogo,
     pais_coincide !== false ? 1 : 0,
     insumos_catalogo, insumos_real || insumos_catalogo,
     insumos_coincide !== false ? 1 : 0,
     calidad || 'Buena', esNuevoFlag, localNow()]);

  if (es_nuevo) {
    // Agregar al catálogo de SKUs si no existe ya
    const skuExistente = dbGet('SELECT id FROM skus WHERE sku_code=? AND cliente_id=?', [sku_code, tracking.cliente_id]);
    if (!skuExistente) {
      dbRun(`INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code,created_at) VALUES (?,?,?,?,?,?,?,?)`,
        [uuidv4(), tracking.cliente_id, sku_code,
         descripcion || null,
         pais_origen_real || pais_origen_catalogo || null,
         insumos_real || insumos_catalogo || null,
         upc_code || null, localNow()]);
    }

    // Registrar en SKUs Nuevos en Catálogo para revisión
    const nid = uuidv4();
    dbRun(`INSERT INTO skus_nuevos (id,tracking_id,detalle_sku_id,cliente_id,sku_code,upc,descripcion,pais_origen,insumos,operador,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [nid, req.params.id, id, tracking.cliente_id, sku_code,
       upc_code || null, descripcion || null,
       pais_origen_real || pais_origen_catalogo || null,
       insumos_real || insumos_catalogo || null,
       tracking.operador || null, localNow()]);
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
  // Borrar errores y retrabajos asociados antes de eliminar el detalle
  dbRun('DELETE FROM errores WHERE detalle_sku_id=? AND tracking_id=?', [req.params.did, req.params.tid]);
  dbRun('DELETE FROM retrabajos WHERE detalle_sku_id=? AND tracking_id=?', [req.params.did, req.params.tid]);
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

  dbRun(`INSERT INTO errores (id,tracking_id,detalle_sku_id,tipo_error,path_fotografia,comentarios,created_at) VALUES (?,?,?,?,?,?,?)`,
    [id, req.params.id, detalle_sku_id || null, tipo_error, path_foto, comentarios, localNow()]);

  res.json({ id, path_fotografia: path_foto, mensaje: 'Error registrado' });
});

// --- RETRABAJOS ---
app.get('/api/catalogo/retrabajos/:tipo', (req, res) => {
  const tipo = req.params.tipo.toLowerCase();
  res.json(CATALOGO_RETRABAJOS[tipo] || []);
});

app.get('/api/retrabajos', (req, res) => {
  const { estatus, cliente_id, tracking_id } = req.query;
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 'r');
  let sql = `
    SELECT r.*,
           t.tracking_number, t.caja_id, t.operador,
           COALESCE(cp.nombre, t.caja_id) as caja_nombre,
           c.nombre as cliente_nombre, c.tipo_mercancia,
           MIN(e.path_fotografia) as foto_evidencia
    FROM retrabajos r
    JOIN trackings t ON r.tracking_id = t.id
    JOIN clientes c ON r.cliente_id = c.id
    LEFT JOIN cajas_pallets cp ON cp.nombre = t.caja_id OR cp.id = t.caja_id
    LEFT JOIN errores e ON e.detalle_sku_id = r.detalle_sku_id AND e.tracking_id = r.tracking_id
    WHERE 1=1${cf}
  `;
  const params = [...cp];
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
  dbRun(`INSERT INTO retrabajos (id,tracking_id,detalle_sku_id,cliente_id,sku_code,descripcion_sku,retrabajos_seleccionados,retrabajo_otro,estatus,created_at)
    VALUES (?,?,?,?,?,?,?,?,'Pendiente',?)`,
    [id, req.params.id, detalle_sku_id || null, tracking.cliente_id,
     sku_code || null, descripcion_sku || null, rtJson, retrabajo_otro || null, localNow()]);

  res.json({ id, mensaje: 'Retrabajo registrado' });
});

app.put('/api/retrabajos/:id', (req, res) => {
  const { estatus } = req.body;
  if (!estatus) return res.status(400).json({ error: 'estatus requerido' });
  dbRun(`UPDATE retrabajos SET estatus=?, updated_at=datetime('now', 'localtime') WHERE id=?`, [estatus, req.params.id]);
  res.json({ mensaje: 'Estatus actualizado' });
});

app.delete('/api/retrabajos/:id', (req, res) => {
  dbRun('DELETE FROM retrabajos WHERE id=?', [req.params.id]);
  res.json({ mensaje: 'Retrabajo eliminado' });
});

// --- DISCREPANCIAS ---
app.post('/api/trackings/:id/discrepancia', (req, res) => {
  const { cantidad_original, cantidad_corregida } = req.body;
  const id = uuidv4();
  dbRun(`INSERT INTO alertas_discrepancia (id,tracking_id,cantidad_original,cantidad_corregida,created_at) VALUES (?,?,?,?,?)`,
    [id, req.params.id, cantidad_original, cantidad_corregida, localNow()]);
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
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');

  const whereParts = [`1=1${cf}`];
  const params = [...cp];
  if (fecha_desde) { whereParts.push("date(t.created_at) >= ?"); params.push(fecha_desde); }
  if (fecha_hasta) { whereParts.push("date(t.created_at) <= ?"); params.push(fecha_hasta); }
  if (cliente_id)  { whereParts.push("t.cliente_id = ?"); params.push(cliente_id); }
  const where = ' WHERE ' + whereParts.join(' AND ');

  const totalTrackings    = dbGet(`SELECT COUNT(*) as cnt FROM trackings t${where}`, params)?.cnt || 0;
  const trackingsCerrados = dbGet(`SELECT COUNT(*) as cnt FROM trackings t${where ? where + " AND t.estatus='cerrado'" : " WHERE t.estatus='cerrado'"}`, params)?.cnt || 0;
  const totalPiezas       = dbGet(`SELECT SUM(t.cantidad_final) as total FROM trackings t${where}`, params)?.total || 0;
  const totalErrores      = dbGet(`SELECT COUNT(*) as cnt FROM errores e JOIN trackings t ON e.tracking_id=t.id${where}`, params)?.cnt || 0;
  const totalDiscrepancias= dbGet(`SELECT COUNT(*) as cnt FROM alertas_discrepancia a JOIN trackings t ON a.tracking_id=t.id${where}`, params)?.cnt || 0;

  const { sql: cfG0, params: cpG0 } = clienteFilter(req.usuario, 't');
  const g0TrackingsAbiertos = dbGet(
    `SELECT COUNT(*) as cnt FROM trackings t JOIN clientes c ON t.cliente_id=c.id WHERE t.estatus='abierto' AND c.grado_confianza=0${cfG0}`,
    cpG0
  )?.cnt || 0;

  const unidadesPorCliente = dbAll(
    `SELECT c.nombre as cliente_nombre, SUM(t.cantidad_final) as total_unidades
     FROM trackings t JOIN clientes c ON t.cliente_id = c.id${where}
     GROUP BY t.cliente_id ORDER BY total_unidades DESC LIMIT 10`,
    params
  );

  const pendienteRefund = dbGet(
    `SELECT COUNT(*) as cnt FROM trackings t${where} AND t.estatus='cerrado'`,
    params
  )?.cnt || 0;

  const chatActivos = dbGet(
    `SELECT COUNT(*) as cnt FROM trackings t${where} AND COALESCE(t.chat_resuelto,0)=0 AND EXISTS (SELECT 1 FROM tracking_comentarios tc WHERE tc.tracking_id=t.id)`,
    params
  )?.cnt || 0;

  res.json({ totalTrackings, trackingsCerrados, totalErrores, totalDiscrepancias, totalPiezas, g0TrackingsAbiertos, unidadesPorCliente, pendienteRefund, chatActivos });
});

// Lista de cajas/pallets agrupadas por caja_id
app.get('/api/reportes/cajas', (req, res) => {
  const { cliente_id, fecha_desde, fecha_hasta } = req.query;
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 'cp', 'cliente_id');

  let where = `WHERE 1=1${cf}`;
  const whereParams = [...cp];
  if (cliente_id) { where += ' AND cp.cliente_id = ?'; whereParams.push(cliente_id); }

  const having = [];
  const havingParams = [];
  if (fecha_desde) { having.push("date(MAX(t.closed_at)) >= ?"); havingParams.push(fecha_desde); }
  if (fecha_hasta) { having.push("date(MAX(t.closed_at)) <= ?"); havingParams.push(fecha_hasta); }

  const sql = `
    SELECT
      cp.nombre                    AS caja_id,
      cp.cliente_id,
      c.nombre                     AS cliente_nombre,
      c.tipo_almacenamiento,
      cp.tipo                      AS tipo_caja,
      cp.id                        AS caja_pallet_id,
      COUNT(DISTINCT CASE WHEN t.estatus IN ('cerrado','refunded') THEN t.id END) AS num_trackings,
      COUNT(DISTINCT CASE WHEN t.estatus IN ('cerrado','refunded') THEN t.id END) AS num_cerrados,
      COUNT(DISTINCT CASE WHEN t.estatus='abierto' THEN t.id END) AS num_abiertos,
      GROUP_CONCAT(t.id, '|')                                     AS tracking_ids,
      GROUP_CONCAT(t.tracking_number, ', ')                       AS tracking_numbers,
      COALESCE(agg.num_skus,    0) AS num_skus,
      COALESCE(agg.total_piezas,0) AS total_piezas,
      MAX(t.closed_at)             AS closed_at,
      MAX(t.impresa)               AS impresa
    FROM cajas_pallets cp
    LEFT JOIN clientes c ON cp.cliente_id = c.id
    LEFT JOIN trackings t ON t.caja_id = cp.nombre
    LEFT JOIN (
      SELECT caja_id, cliente_id,
             COUNT(DISTINCT sku_key) as num_skus,
             SUM(piezas)             as total_piezas
      FROM (
        SELECT t2.caja_id, t2.cliente_id, 'D:'||d.sku_code as sku_key, d.cantidad as piezas
        FROM detalle_skus d
        JOIN trackings t2 ON d.tracking_id = t2.id AND t2.caja_id != '' AND t2.estatus IN ('cerrado','refunded')
        UNION ALL
        SELECT t2.caja_id, t2.cliente_id, 'G:'||g.sku as sku_key, 1 as piezas
        FROM g0_piezas g
        JOIN trackings t2 ON g.tracking_id = t2.id AND t2.caja_id != '' AND t2.estatus IN ('cerrado','refunded')
      ) combined
      GROUP BY caja_id, cliente_id
    ) agg ON agg.caja_id = cp.nombre AND agg.cliente_id = cp.cliente_id
    ${where}
    GROUP BY cp.nombre, cp.cliente_id
    ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
    ORDER BY MAX(t.closed_at) DESC NULLS LAST, cp.nombre ASC
  `;
  res.json(dbAll(sql, [...whereParams, ...havingParams]));
});

// Detalle completo de una caja/pallet (todos sus trackings + SKUs + errores)
app.get('/api/reportes/caja-detalle', (req, res) => {
  const { caja_id, cliente_id } = req.query;
  if (!caja_id) return res.status(400).json({ error: 'caja_id requerido' });

  let sql = `
    SELECT t.*, c.nombre as cliente_nombre, c.tipo_almacenamiento, c.grado_confianza
    FROM trackings t
    LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE t.caja_id = ? AND t.estatus IN ('cerrado','refunded')
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

  // Append G0 piezas (normalized to detalle shape) for G0 trackings
  const g0Ids = trackings.filter(t => parseInt(t.grado_confianza) === 0).map(t => t.id);
  if (g0Ids.length > 0) {
    const g0ph = g0Ids.map(() => '?').join(',');
    const g0rows = dbAll(`
      SELECT p.*, t.tracking_number, oi.country_of_origin, oi.content as item_content,
             COALESCE(t.numero_orden,
               (SELECT oi2.order_number FROM orden_items oi2
                WHERE oi2.tracking_number = t.tracking_number LIMIT 1)) as canonical_order
      FROM g0_piezas p
      JOIN trackings t ON p.tracking_id = t.id
      LEFT JOIN orden_items oi ON p.orden_item_id = oi.id
      WHERE p.tracking_id IN (${g0ph})
      ORDER BY t.tracking_number, p.created_at
    `, g0Ids);
    for (const p of g0rows) {
      detalles.push({
        ...p,
        sku_code: p.sku,
        descripcion: p.product_title,
        cantidad: 1,
        calidad: p.condicion,
        pais_origen_real: p.pais_real || p.country_of_origin || null,
        pais_coincide: p.pais_coincide !== 0 ? 1 : 0,
        orden_number: p.canonical_order || null,
        insumos_real: p.insumos_real || p.item_content || null,
        insumos_coincide: p.insumos_coincide !== 0 ? 1 : 0,
        pais_coincide: 1,
        insumos_coincide: 1,
        foto_etiqueta: null,
        tipo_pieza: 'g0',
      });
    }
  }

  res.json({ trackings, detalles, errores });
});

// CSV: datos por tracking IDs (evita ambigüedad cuando mismo caja_id pertenece a distintos clientes)
app.post('/api/reportes/csv-detalles', (req, res) => {
  const { tracking_ids } = req.body;
  if (!Array.isArray(tracking_ids) || tracking_ids.length === 0)
    return res.status(400).json({ error: 'tracking_ids requerido' });

  const ph = tracking_ids.map(() => '?').join(',');

  // Standard trackings (detalle_skus)
  const rows = dbAll(`
    SELECT t.tracking_number, t.caja_id, t.numero_orden as order_number, t.tipo_retorno, t.razon_retorno,
           d.sku_code as sku, d.cantidad as qty, d.pais_origen_real as country_of_origin, d.insumos_real as materials,
           NULL as barcode, NULL as condicion, 'standard' as tipo_pieza
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    WHERE t.id IN (${ph})
    ORDER BY t.caja_id, t.tracking_number, d.created_at
  `, tracking_ids);

  // G0 trackings (g0_piezas) — JOIN orden_items for country_of_origin and content
  // Use canonical order_number from the tracking (not per-piece, which can differ for mis-scanned items)
  const g0rows = dbAll(`
    SELECT t.tracking_number, t.caja_id,
           COALESCE(t.numero_orden,
             (SELECT oi2.order_number FROM orden_items oi2
              WHERE oi2.tracking_number = t.tracking_number LIMIT 1)) as order_number,
           NULL as tipo_retorno, NULL as razon_retorno,
           p.sku, 1 as qty,
           COALESCE(p.pais_real, oi.country_of_origin) as country_of_origin,
           COALESCE(p.insumos_real, oi.content) as materials,
           p.barcode, p.condicion, 'g0' as tipo_pieza
    FROM g0_piezas p
    JOIN trackings t ON p.tracking_id = t.id
    LEFT JOIN orden_items oi ON p.orden_item_id = oi.id
    WHERE t.id IN (${ph})
    ORDER BY t.caja_id, t.tracking_number, p.created_at
  `, tracking_ids);

  res.json([...rows, ...g0rows]);
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

  // For G0 trackings append g0_piezas normalized as detalles
  if (parseInt(tracking.grado_confianza) === 0) {
    const g0rows = dbAll(`
      SELECT p.*, oi.country_of_origin, oi.content as item_content,
             COALESCE(t.numero_orden,
               (SELECT oi2.order_number FROM orden_items oi2
                WHERE oi2.tracking_number = t.tracking_number LIMIT 1)) as canonical_order
      FROM g0_piezas p
      JOIN trackings t ON p.tracking_id = t.id
      LEFT JOIN orden_items oi ON p.orden_item_id = oi.id
      WHERE p.tracking_id=? ORDER BY p.created_at
    `, [req.params.id]);
    for (const p of g0rows) {
      detalles.push({
        ...p,
        sku_code: p.sku,
        descripcion: p.product_title,
        cantidad: 1,
        calidad: p.condicion,
        pais_origen_real: p.pais_real || p.country_of_origin || null,
        pais_coincide: p.pais_coincide !== 0 ? 1 : 0,
        orden_number: p.canonical_order || null,
        insumos_real: p.insumos_real || p.item_content || null,
        insumos_coincide: p.insumos_coincide !== 0 ? 1 : 0,
        pais_coincide: 1,
        insumos_coincide: 1,
        foto_etiqueta: null,
        tipo_pieza: 'g0',
      });
    }
  }

  res.json({ tracking, detalles, errores, discrepancias, retrabajos });
});

// Reporte de calidad por cliente
app.get('/api/reportes/calidad', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id } = req.query;
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');

  let conds = `t.estatus IN ('cerrado','refunded')${cf}`;
  const bp = [...cp];
  if (fecha_desde) { conds += ' AND date(d.created_at) >= ?'; bp.push(fecha_desde); }
  if (fecha_hasta) { conds += ' AND date(d.created_at) <= ?'; bp.push(fecha_hasta); }
  if (cliente_id)  { conds += ' AND t.cliente_id = ?';        bp.push(cliente_id); }

  let condErr = `1=1${cf}`;
  const ep = [...cp];
  if (fecha_desde) { condErr += ' AND date(t.closed_at) >= ?'; ep.push(fecha_desde); }
  if (fecha_hasta) { condErr += ' AND date(t.closed_at) <= ?'; ep.push(fecha_hasta); }
  if (cliente_id)  { condErr += ' AND t.cliente_id = ?';        ep.push(cliente_id); }

  const porCliente = dbAll(`
    SELECT c.id as cliente_id, c.nombre as cliente_nombre,
      SUM(d.cantidad) as total_piezas,
      SUM(CASE WHEN d.calidad='Buena' THEN d.cantidad ELSE 0 END) as piezas_buenas,
      SUM(CASE WHEN d.calidad!='Buena' THEN d.cantidad ELSE 0 END) as piezas_malas,
      COUNT(DISTINCT d.tracking_id) as num_trackings
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    JOIN clientes c ON t.cliente_id = c.id
    WHERE ${conds}
    GROUP BY c.id ORDER BY total_piezas DESC
  `, bp);

  const tiposError = dbAll(`
    SELECT e.tipo_error, c.nombre as cliente_nombre, c.id as cliente_id,
      COUNT(*) as total
    FROM errores e
    JOIN trackings t ON e.tracking_id = t.id
    JOIN clientes c ON t.cliente_id = c.id
    WHERE ${condErr}
    GROUP BY e.tipo_error, c.id ORDER BY total DESC
  `, ep);

  const tendencia = dbAll(`
    SELECT strftime('%Y-%m', d.created_at) as mes,
      c.nombre as cliente_nombre, c.id as cliente_id,
      SUM(d.cantidad) as total_piezas,
      SUM(CASE WHEN d.calidad='Buena' THEN d.cantidad ELSE 0 END) as buenas,
      ROUND(100.0 * SUM(CASE WHEN d.calidad='Buena' THEN d.cantidad ELSE 0 END)
            / NULLIF(SUM(d.cantidad), 0), 1) as pct_buenas
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    JOIN clientes c ON t.cliente_id = c.id
    WHERE ${conds}
    GROUP BY mes, c.id ORDER BY mes DESC LIMIT 60
  `, bp);

  const paises = dbAll(`
    SELECT d.pais_origen_real as pais,
      c.nombre as cliente_nombre, c.id as cliente_id,
      SUM(d.cantidad) as total,
      SUM(CASE WHEN d.pais_coincide=0 THEN d.cantidad ELSE 0 END) as disc_pais,
      SUM(CASE WHEN d.insumos_coincide=0 THEN d.cantidad ELSE 0 END) as disc_insumos
    FROM detalle_skus d
    JOIN trackings t ON d.tracking_id = t.id
    JOIN clientes c ON t.cliente_id = c.id
    WHERE ${conds} AND d.pais_origen_real IS NOT NULL AND d.pais_origen_real != ''
    GROUP BY d.pais_origen_real, c.id
    HAVING disc_pais > 0 OR disc_insumos > 0
    ORDER BY (disc_pais + disc_insumos) DESC LIMIT 20
  `, bp);

  res.json({ porCliente, tiposError, tendencia, paises });
});

// Reporte de piezas procesadas por operador
app.get('/api/reportes/piezas-usuario', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id, operador } = req.query;
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');
  let sql = `
    SELECT
      t.operador,
      c.nombre          AS cliente_nombre,
      date(t.closed_at) AS fecha,
      time(t.closed_at) AS hora_cierre,
      t.tracking_number,
      COALESCE(cp.nombre, t.caja_id) AS caja_nombre,
      t.cantidad_final  AS piezas
    FROM trackings t
    JOIN clientes c ON t.cliente_id = c.id
    LEFT JOIN cajas_pallets cp ON cp.nombre = t.caja_id OR cp.id = t.caja_id
    WHERE t.estatus IN ('cerrado','refunded') AND t.closed_at IS NOT NULL${cf}
  `;
  const params = [...cp];
  if (fecha_desde) { sql += ' AND date(t.closed_at) >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { sql += ' AND date(t.closed_at) <= ?'; params.push(fecha_hasta); }
  if (cliente_id)  { sql += ' AND t.cliente_id = ?';       params.push(cliente_id); }
  if (operador)    { sql += ' AND t.operador = ?';          params.push(operador); }
  sql += ' ORDER BY t.operador, t.closed_at DESC';
  res.json(dbAll(sql, params));
});

// Reporte masivo de retrabajos
app.get('/api/reportes/retrabajos', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id, estatus } = req.query;
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 'r');
  let sql = `
    SELECT r.*,
           t.tracking_number, t.caja_id, t.operador,
           c.nombre as cliente_nombre, c.tipo_mercancia
    FROM retrabajos r
    JOIN trackings t ON r.tracking_id = t.id
    JOIN clientes c ON r.cliente_id = c.id
    WHERE 1=1${cf}
  `;
  const params = [...cp];
  if (fecha_desde) { sql += " AND date(r.created_at) >= ?"; params.push(fecha_desde); }
  if (fecha_hasta) { sql += " AND date(r.created_at) <= ?"; params.push(fecha_hasta); }
  if (cliente_id)  { sql += ' AND r.cliente_id = ?'; params.push(cliente_id); }
  if (estatus)     { sql += ' AND r.estatus = ?'; params.push(estatus); }
  sql += ' ORDER BY r.created_at DESC';
  res.json(dbAll(sql, params));
});

// Dashboard: hora por hora
app.get('/api/dashboard/hora-por-hora', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id, operador } = req.query;
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');

  // Build shared WHERE conditions (applied to both detalle_skus and g0_piezas subqueries)
  let conds = `1=1${cf}`;
  const baseParams = [...cp];
  if (fecha_desde) { conds += ' AND date(src.created_at) >= ?'; baseParams.push(fecha_desde); }
  if (fecha_hasta) { conds += ' AND date(src.created_at) <= ?'; baseParams.push(fecha_hasta); }
  if (cliente_id)  { conds += ' AND t.cliente_id = ?';          baseParams.push(cliente_id); }
  if (operador)    { conds += ' AND t.operador = ?';             baseParams.push(operador); }

  const sql = `
    SELECT fecha, hora, cliente_id, cliente_nombre, uph,
           SUM(unidades) as unidades,
           COUNT(DISTINCT operador) as num_operadores
    FROM (
      SELECT strftime('%Y-%m-%d', src.created_at) as fecha,
             CAST(strftime('%H', src.created_at) AS INTEGER) as hora,
             t.cliente_id, t.operador,
             c.nombre as cliente_nombre, COALESCE(c.uph, 0) as uph,
             src.cantidad as unidades
      FROM detalle_skus src
      JOIN trackings t ON src.tracking_id = t.id
      JOIN clientes c ON t.cliente_id = c.id
      WHERE ${conds}
      UNION ALL
      SELECT strftime('%Y-%m-%d', src.created_at) as fecha,
             CAST(strftime('%H', src.created_at) AS INTEGER) as hora,
             t.cliente_id, t.operador,
             c.nombre as cliente_nombre, COALESCE(c.uph, 0) as uph,
             1 as unidades
      FROM g0_piezas src
      JOIN trackings t ON src.tracking_id = t.id
      JOIN clientes c ON t.cliente_id = c.id
      WHERE ${conds}
    ) combined
    GROUP BY fecha, hora, cliente_id
    ORDER BY fecha, hora
  `;
  res.json(dbAll(sql, [...baseParams, ...baseParams]));
});

app.get('/api/dashboard/operadores', (req, res) => {
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');
  const rows = dbAll(`SELECT DISTINCT t.operador FROM trackings t WHERE t.operador IS NOT NULL AND t.operador != ''${cf} ORDER BY t.operador`, cp);
  res.json(rows.map(r => r.operador));
});

app.get('/api/dashboard/ranking', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id } = req.query;
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');

  let conds = `1=1${cf}`;
  const baseParams = [...cp];
  if (fecha_desde) { conds += ' AND date(src.created_at) >= ?'; baseParams.push(fecha_desde); }
  if (fecha_hasta) { conds += ' AND date(src.created_at) <= ?'; baseParams.push(fecha_hasta); }
  if (cliente_id)  { conds += ' AND t.cliente_id = ?';          baseParams.push(cliente_id); }

  const sql = `
    SELECT operador,
           SUM(piezas) as total_piezas,
           COUNT(DISTINCT tracking_id) as total_trackings
    FROM (
      SELECT t.operador, src.cantidad as piezas, src.tracking_id
      FROM detalle_skus src
      JOIN trackings t ON src.tracking_id = t.id
      WHERE ${conds}
      UNION ALL
      SELECT t.operador, 1 as piezas, src.tracking_id
      FROM g0_piezas src
      JOIN trackings t ON src.tracking_id = t.id
      WHERE ${conds}
    ) combined
    GROUP BY operador ORDER BY total_piezas DESC LIMIT 10
  `;
  res.json(dbAll(sql, [...baseParams, ...baseParams]));
});

// --- FOTO SESIONES (Hybrid Web-Mobile) ---

function buildMobilePhotoPage(pageState, token, sesion) {
  const staticStates = {
    invalid: `
      <div class="status status-error">❌ Enlace inválido</div>
      <p class="sub">Este enlace no es válido o ya expiró. Genera un nuevo QR desde la estación de trabajo.</p>
    `,
    expired: `
      <div class="status status-warning">⏱ Sesión expirada</div>
      <p class="sub">Este enlace ha caducado. Genera un nuevo QR desde la estación de trabajo.</p>
    `,
    used: `
      <div class="status status-success">✅ Fotos enviadas</div>
      <p class="sub">Todas las fotografías fueron recibidas correctamente. Puedes cerrar esta pantalla.</p>
    `,
  };

  if (pageState !== 'active') {
    const content = staticStates[pageState] || '';
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>Captura de Foto — Sistema Logístico</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0A0E1A;color:#E5E7EB;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 20px}.logo{font-size:11px;letter-spacing:.15em;color:#6B7280;text-transform:uppercase;margin-bottom:32px}.card{background:#131827;border:1px solid #1E2A3A;border-radius:16px;padding:32px 24px;width:100%;max-width:420px;text-align:center}.sub{font-size:14px;color:#9CA3AF;margin-bottom:8px;line-height:1.5}.status{padding:14px 16px;border-radius:12px;font-size:14px;font-weight:600;margin-bottom:16px;text-align:left;line-height:1.4}.status-success{background:rgba(22,163,74,.15);color:#4ADE80;border:1px solid rgba(22,163,74,.3)}.status-error{background:rgba(220,38,38,.15);color:#F87171;border:1px solid rgba(220,38,38,.3)}.status-warning{background:rgba(202,138,4,.15);color:#FCD34D;border:1px solid rgba(202,138,4,.3)}</style></head><body><div class="logo">Sistema Logístico · Captura Móvil</div><div class="card">${content}</div></body></html>`;
  }

  const totalFotos = sesion?.total_fotos || 1;
  const fotosUrlsInit = JSON.parse(sesion?.fotos_urls || '[]');
  const fotosContextos = JSON.parse(sesion?.fotos_contextos || '[]');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Captura de Foto — Sistema Logístico</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0A0E1A;color:#E5E7EB;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px}
    .logo{font-size:11px;letter-spacing:.15em;color:#6B7280;text-transform:uppercase;margin-bottom:20px}
    .card{background:#131827;border:1px solid #1E2A3A;border-radius:16px;padding:24px 20px;width:100%;max-width:440px}
    .progress-wrap{margin-bottom:18px}
    .progress-bar{height:6px;background:#1E2A3A;border-radius:3px;overflow:hidden;margin-bottom:8px}
    .progress-fill{height:100%;background:#1D4ED8;border-radius:3px;transition:width .4s ease}
    .progress-text{font-size:13px;font-weight:700;color:#9CA3AF;text-align:center;letter-spacing:.05em}
    .thumbs-row{display:flex;gap:8px;justify-content:center;margin-bottom:18px;flex-wrap:wrap}
    .thumb{width:64px;height:64px;border-radius:10px;overflow:hidden;position:relative;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;cursor:default;transition:transform .15s}
    .thumb-done{border:2px solid #16A34A;background:#0d1f10}
    .thumb-done img{width:100%;height:100%;object-fit:cover}
    .thumb-done .thumb-check{position:absolute;bottom:2px;right:2px;background:#16A34A;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;font-weight:900}
    .thumb-current{border:2px solid #1D4ED8;background:#0d1626;animation:pulse-border 1.5s ease-in-out infinite}
    .thumb-pending{border:2px solid #374151;background:#0f1523;color:#4B5563}
    .thumb-num{font-size:18px}
    @keyframes pulse-border{0%,100%{border-color:#1D4ED8}50%{border-color:#60A5FA}}
    .foto-descripcion{text-align:center;margin-bottom:18px}
    .foto-label{font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
    .foto-contexto-text{font-size:18px;font-weight:700;color:#E5E7EB;line-height:1.3}
    .preview-img{width:100%;border-radius:12px;margin:12px 0;object-fit:cover;max-height:300px;display:none}
    .status-msg{padding:12px 14px;border-radius:10px;font-size:14px;font-weight:600;margin-bottom:12px;line-height:1.4}
    .status-success{background:rgba(22,163,74,.15);color:#4ADE80;border:1px solid rgba(22,163,74,.3)}
    .status-error{background:rgba(220,38,38,.15);color:#F87171;border:1px solid rgba(220,38,38,.3)}
    .status-warning{background:rgba(202,138,4,.15);color:#FCD34D;border:1px solid rgba(202,138,4,.3)}
    .btn{display:block;width:100%;padding:18px;border-radius:12px;border:none;font-size:17px;font-weight:700;cursor:pointer;transition:opacity .15s;margin-bottom:10px;text-align:center}
    .btn:active{opacity:.75}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .btn-primary{background:#1D4ED8;color:#fff}
    .btn-secondary{background:#1E2A3A;color:#E5E7EB}
    .btn-success{background:#16A34A;color:#fff}
    .hidden{display:none}
    input[type=file]{display:none}
    .spinner{width:32px;height:32px;border:3px solid #1E2A3A;border-top-color:#1D4ED8;border-radius:50%;animation:spin .8s linear infinite;margin:12px auto}
    @keyframes spin{to{transform:rotate(360deg)}}
    .completado-card{text-align:center;padding:8px 0}
    .completado-icon{font-size:56px;margin-bottom:12px}
    .completado-title{font-size:22px;font-weight:800;color:#4ADE80;margin-bottom:8px}
    .completado-sub{font-size:14px;color:#9CA3AF;line-height:1.5;margin-bottom:20px}
    .completado-thumbs{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
    .completado-thumb{text-align:center;flex:1;min-width:80px;max-width:120px}
    .completado-thumb img{width:100%;border-radius:10px;aspect-ratio:1;object-fit:cover}
    .completado-thumb-label{font-size:10px;color:#6B7280;margin-top:4px;word-break:break-word}
  </style>
</head>
<body>
  <div class="logo">Sistema Logístico · Captura Móvil</div>
  <div class="card">

    <!-- VISTA CAPTURA -->
    <div id="main-captura">
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
        <div class="progress-text" id="progress-text"></div>
      </div>

      <div class="thumbs-row" id="thumbs-row"></div>

      <div class="foto-descripcion">
        <div class="foto-label">Fotografía requerida</div>
        <div class="foto-contexto-text" id="foto-contexto-text"></div>
      </div>

      <img id="preview" class="preview-img" alt="Vista previa">
      <div id="status-msg" class="status-msg hidden"></div>

      <input type="file" id="foto-input-camera"  accept="image/*" capture="environment">
      <input type="file" id="foto-input-gallery" accept="image/*">

      <div id="btn-wrap">
        <button class="btn btn-primary"   onclick="triggerInput('camera')">📷 Abrir Cámara</button>
        <button class="btn btn-secondary" onclick="triggerInput('gallery')">🖼 Elegir de Galería</button>
      </div>
      <button class="btn btn-success hidden" id="btn-enviar" onclick="enviarFoto()">✓ Usar esta foto</button>
      <button class="btn btn-secondary hidden" id="btn-retomar" onclick="retomar()">↩ Retomar foto</button>
      <div class="spinner hidden" id="loading-spinner"></div>
    </div>

    <!-- VISTA COMPLETADO -->
    <div id="main-completado" class="hidden completado-card">
      <div class="completado-icon">✅</div>
      <div class="completado-title">¡Listo!</div>
      <div class="completado-sub">Todas las fotos fueron enviadas correctamente.<br>Puedes cerrar esta ventana.</div>
      <div class="completado-thumbs" id="completado-thumbs"></div>
    </div>

  </div>

  <script>
    var TOKEN = ${JSON.stringify(token)};
    var TOTAL_FOTOS = ${totalFotos};
    var FOTOS_CONTEXTOS = ${JSON.stringify(fotosContextos)};
    var fotosUrls = ${JSON.stringify(fotosUrlsInit)};
    // ensure array has TOTAL_FOTOS slots
    while (fotosUrls.length < TOTAL_FOTOS) fotosUrls.push(null);

    var currentIdx = 0;
    var selectedFile = null;

    function init() {
      currentIdx = fotosUrls.findIndex(function(u) { return !u; });
      if (currentIdx === -1) { mostrarCompletado(); return; }
      renderProgress();
    }

    function renderProgress() {
      var done = fotosUrls.filter(Boolean).length;
      document.getElementById('progress-fill').style.width = (done / TOTAL_FOTOS * 100) + '%';
      document.getElementById('progress-text').textContent = 'Foto ' + (currentIdx + 1) + ' de ' + TOTAL_FOTOS;
      document.getElementById('foto-contexto-text').textContent = FOTOS_CONTEXTOS[currentIdx] || ('Foto ' + (currentIdx + 1));
      renderThumbs();
    }

    function renderThumbs() {
      if (TOTAL_FOTOS <= 1) { document.getElementById('thumbs-row').innerHTML = ''; return; }
      var html = '';
      for (var i = 0; i < TOTAL_FOTOS; i++) {
        var url = fotosUrls[i];
        if (url) {
          html += '<div class="thumb thumb-done" onclick="verThumb(' + i + ')">'
            + '<img src="' + url + '" alt="">'
            + '<div class="thumb-check">✓</div></div>';
        } else if (i === currentIdx) {
          html += '<div class="thumb thumb-current"><div class="thumb-num">📷</div></div>';
        } else {
          html += '<div class="thumb thumb-pending"><div class="thumb-num">' + (i + 1) + '</div></div>';
        }
      }
      document.getElementById('thumbs-row').innerHTML = html;
    }

    function verThumb(i) {
      var url = fotosUrls[i];
      if (!url) return;
      window.open(url, '_blank');
    }

    function triggerInput(type) {
      document.getElementById('foto-input-' + type).click();
    }

    function onFileSelected(file) {
      if (!file) return;
      selectedFile = file;
      var objUrl = URL.createObjectURL(file);
      var img = document.getElementById('preview');
      img.onload = function() { URL.revokeObjectURL(objUrl); };
      img.onerror = function() { URL.revokeObjectURL(objUrl); img.style.display = 'none'; };
      img.src = objUrl;
      img.style.display = 'block';
      document.getElementById('btn-wrap').classList.add('hidden');
      document.getElementById('btn-enviar').classList.remove('hidden');
      document.getElementById('btn-retomar').classList.remove('hidden');
      clearStatus();
    }

    document.getElementById('foto-input-camera').addEventListener('change', function() { onFileSelected(this.files[0]); });
    document.getElementById('foto-input-gallery').addEventListener('change', function() { onFileSelected(this.files[0]); });

    function retomar() {
      selectedFile = null;
      var img = document.getElementById('preview');
      img.src = ''; img.style.display = 'none';
      try { document.getElementById('foto-input-camera').value  = ''; } catch(e) {}
      try { document.getElementById('foto-input-gallery').value = ''; } catch(e) {}
      document.getElementById('btn-wrap').classList.remove('hidden');
      document.getElementById('btn-enviar').classList.add('hidden');
      document.getElementById('btn-retomar').classList.add('hidden');
      document.getElementById('btn-enviar').disabled = false;
      clearStatus();
    }

    function comprimirImagen(file) {
      return new Promise(function(resolve) {
        if (file.size <= 5 * 1024 * 1024) { resolve(file); return; }
        var objUrl = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function() {
          URL.revokeObjectURL(objUrl);
          var MAX = 1920, w = img.naturalWidth, h = img.naturalHeight;
          if (w > MAX || h > MAX) {
            if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
            else        { w = Math.round(w * MAX / h); h = MAX; }
          }
          try {
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob(function(blob) {
              if (!blob) { resolve(file); return; }
              resolve(new File([blob], 'foto.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
            }, 'image/jpeg', 0.80);
          } catch(e) { resolve(file); }
        };
        img.onerror = function() { URL.revokeObjectURL(objUrl); resolve(file); };
        img.src = objUrl;
      });
    }

    async function enviarFoto() {
      if (!selectedFile) return;
      var btnEnviar = document.getElementById('btn-enviar');
      btnEnviar.disabled = true;
      document.getElementById('btn-retomar').classList.add('hidden');
      document.getElementById('loading-spinner').classList.remove('hidden');

      try {
        setStatus('Procesando imagen…', 'warning');
        var fileToUpload = await comprimirImagen(selectedFile);
        setStatus('Enviando…', 'warning');

        var fd = new FormData();
        fd.append('foto', fileToUpload, fileToUpload.name || 'foto.jpg');
        fd.append('foto_index', String(currentIdx));

        var res  = await fetch('/api/foto-sesion/' + TOKEN + '/upload', { method: 'POST', body: fd });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al enviar');

        fotosUrls[currentIdx] = data.url;
        document.getElementById('loading-spinner').classList.add('hidden');
        clearStatus();

        if (data.completada) {
          setTimeout(function() { mostrarCompletado(); }, 400);
        } else {
          // Advance to next missing photo
          currentIdx = fotosUrls.findIndex(function(u) { return !u; });
          retomar();
          renderProgress();
          // Brief success flash
          setStatus('✅ Foto ' + data.total_subidas + '/' + data.total_requeridas + ' recibida — siguiente foto', 'success');
          setTimeout(function() { clearStatus(); }, 2000);
        }
      } catch(e) {
        document.getElementById('loading-spinner').classList.add('hidden');
        btnEnviar.disabled = false;
        document.getElementById('btn-retomar').classList.remove('hidden');
        setStatus('❌ Error: ' + (e.message || 'Intenta de nuevo'), 'error');
      }
    }

    function mostrarCompletado() {
      document.getElementById('main-captura').classList.add('hidden');
      document.getElementById('main-completado').classList.remove('hidden');
      var thumbsEl = document.getElementById('completado-thumbs');
      if (TOTAL_FOTOS > 1) {
        thumbsEl.innerHTML = fotosUrls.filter(Boolean).map(function(url, i) {
          return '<div class="completado-thumb">'
            + '<img src="' + url + '" alt="">'
            + '<div class="completado-thumb-label">' + (FOTOS_CONTEXTOS[i] || ('Foto ' + (i + 1))) + '</div>'
            + '</div>';
        }).join('');
      } else {
        thumbsEl.innerHTML = '';
      }
    }

    function setStatus(msg, type) {
      var el = document.getElementById('status-msg');
      el.className = 'status-msg status-' + type;
      el.textContent = msg;
    }
    function clearStatus() {
      var el = document.getElementById('status-msg');
      el.className = 'status-msg hidden';
      el.textContent = '';
    }

    init();
  <\/script>
</body>
</html>`;
}

app.post('/api/foto-sesion', (req, res) => {
  const { tracking_id, detalle_sku_id, contexto, total_fotos, contextos } = req.body;
  const id = uuidv4();
  const token = uuidv4();
  const n = Math.max(1, parseInt(total_fotos) || 1);
  const ctxArray = Array.isArray(contextos) && contextos.length > 0
    ? contextos.slice(0, n)
    : Array.from({ length: n }, (_, i) => `Foto ${i + 1}`);
  dbRun(
    `INSERT INTO foto_sesiones (id, token, tracking_id, detalle_sku_id, contexto, total_fotos, fotos_urls, fotos_contextos, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`,
    [id, token, tracking_id || null, detalle_sku_id || null, contexto || null, n, '[]', JSON.stringify(ctxArray)]
  );
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const url = `${proto}://${host}/foto/${token}`;
  res.json({ token, url, total_fotos: n });
});

app.get('/api/foto-sesion/:token', (req, res) => {
  const sesion = dbGet('SELECT estatus, url_foto, expires_at, total_fotos, fotos_urls, fotos_contextos FROM foto_sesiones WHERE token = ?', [req.params.token]);
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
  sesion.total_fotos = sesion.total_fotos || 1;
  sesion.fotos_urls = JSON.parse(sesion.fotos_urls || '[]');
  sesion.fotos_contextos = JSON.parse(sesion.fotos_contextos || '[]');
  res.json(sesion);
});

app.post('/api/foto-sesion/:token/upload', (req, res, next) => {
  upload.single('foto')(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La foto excede el límite de 50 MB' });
      return res.status(400).json({ error: err.message || 'Error al procesar el archivo' });
    }
    next();
  });
}, (req, res) => {
  const sesion = dbGet('SELECT * FROM foto_sesiones WHERE token = ?', [req.params.token]);
  if (!sesion) return res.status(404).json({ error: 'Sesión inválida' });
  if (sesion.estatus === 'completada') return res.status(400).json({ error: 'Esta sesión ya fue completada' });
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (sesion.expires_at < now) return res.status(410).json({ error: 'Sesión expirada' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió foto' });

  const url_foto = `/uploads/${req.file.filename}`;
  const total = sesion.total_fotos || 1;
  const foto_index = Math.max(0, Math.min(parseInt(req.body.foto_index) || 0, total - 1));

  const fotos_urls = JSON.parse(sesion.fotos_urls || '[]');
  fotos_urls[foto_index] = url_foto;

  const total_subidas = fotos_urls.filter(u => u != null).length;
  const completada = total_subidas >= total;

  if (completada) {
    dbRun("UPDATE foto_sesiones SET estatus = 'completada', url_foto = ?, fotos_urls = ?, expires_at = datetime('now', '+10 minutes') WHERE token = ?",
      [fotos_urls[0], JSON.stringify(fotos_urls), req.params.token]);
  } else {
    dbRun("UPDATE foto_sesiones SET estatus = 'en_progreso', fotos_urls = ?, expires_at = datetime('now', '+10 minutes') WHERE token = ?",
      [JSON.stringify(fotos_urls), req.params.token]);
  }

  res.json({ foto_index, url: url_foto, total_subidas, total_requeridas: total, completada });
});

app.get('/foto/:token', (req, res) => {
  const sesion = dbGet('SELECT * FROM foto_sesiones WHERE token = ?', [req.params.token]);
  if (!sesion) return res.send(buildMobilePhotoPage('invalid', null, null));
  if (sesion.estatus === 'completada') return res.send(buildMobilePhotoPage('used', null, null));
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (sesion.expires_at < now) return res.send(buildMobilePhotoPage('expired', null, null));
  res.send(buildMobilePhotoPage('active', req.params.token, sesion));
});

app.post('/api/trackings/:id/errores-url', (req, res) => {
  const { detalle_sku_id, tipo_error, comentarios, path_fotografia } = req.body;
  if (!path_fotografia) return res.status(400).json({ error: 'path_fotografia requerido' });
  const id = uuidv4();
  dbRun(`INSERT INTO errores (id,tracking_id,detalle_sku_id,tipo_error,path_fotografia,comentarios,created_at) VALUES (?,?,?,?,?,?,?)`,
    [id, req.params.id, detalle_sku_id || null, tipo_error, path_fotografia, comentarios, localNow()]);
  res.json({ id, path_fotografia, mensaje: 'Error registrado' });
});

// ── Subida genérica de foto ───────────────────────────────────────────────────
app.post('/api/subir-foto', upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió foto' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── SKUs Nuevos en Catálogo ────────────────────────────────────────────────────

function buildSkusNuevosWhere(query, usuario) {
  const { cliente_id, fecha_inicio, fecha_fin, solo_sin_completar } = query;
  const { sql: cf, params: cp } = usuario ? clienteFilter(usuario, 'n') : { sql: '', params: [] };
  const where = [`1=1${cf}`];
  const vals = [...cp];
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
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 'n');
  const row = dbGet(`
    SELECT COUNT(*) as cnt FROM skus_nuevos n
    LEFT JOIN detalle_skus d ON n.detalle_sku_id=d.id
    WHERE n.dado_de_alta=0${cf}
    AND (
      COALESCE(n.url_foto_etiqueta, d.foto_etiqueta) IS NULL
      OR COALESCE(n.url_foto_insumos_origen, d.foto_insumos) IS NULL
      OR COALESCE(n.url_foto_producto_completo, d.foto_pieza) IS NULL
    )
  `, cp);
  res.json({ count: row?.cnt || 0 });
});

app.get('/api/skus-nuevos/exportar/csv', (req, res) => {
  const { where, vals } = buildSkusNuevosWhere(req.query, req.usuario);
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
  const { where, vals } = buildSkusNuevosWhere(req.query, req.usuario);
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

  // When marking as dado_de_alta, sync updated info to the SKU catalog
  if (dado_de_alta) {
    const sn = dbGet('SELECT * FROM skus_nuevos WHERE id=?', [req.params.id]);
    if (sn) {
      const skuExistente = dbGet('SELECT id FROM skus WHERE sku_code=? AND cliente_id=?', [sn.sku_code, sn.cliente_id]);
      if (skuExistente) {
        dbRun(`UPDATE skus SET descripcion=?, pais_origen=?, insumos=?, upc_code=? WHERE id=?`,
          [sn.descripcion || null, sn.pais_origen || null, sn.insumos || null, sn.upc || null, skuExistente.id]);
      }
    }
  }

  res.json({ mensaje: 'Actualizado' });
});

app.delete('/api/skus-nuevos/:id', (req, res) => {
  dbRun('DELETE FROM skus_nuevos WHERE id=?', [req.params.id]);
  res.json({ mensaje: 'Eliminado' });
});

app.post('/api/skus-nuevos/:id/fotos-evidencia', upload.fields([
  { name: 'etiqueta', maxCount: 1 },
  { name: 'insumos',  maxCount: 1 },
  { name: 'pieza',    maxCount: 1 },
]), (req, res) => {
  const sn = dbGet('SELECT id FROM skus_nuevos WHERE id=?', [req.params.id]);
  if (!sn) return res.status(404).json({ error: 'SKU nuevo no encontrado' });

  const updates = [], vals = [];
  if (req.files?.etiqueta) { updates.push('url_foto_etiqueta=?');         vals.push('/uploads/' + req.files.etiqueta[0].filename); }
  if (req.files?.insumos)  { updates.push('url_foto_insumos_origen=?');   vals.push('/uploads/' + req.files.insumos[0].filename); }
  if (req.files?.pieza)    { updates.push('url_foto_producto_completo=?');vals.push('/uploads/' + req.files.pieza[0].filename); }

  if (updates.length === 0) return res.status(400).json({ error: 'No se recibieron fotos' });
  vals.push(req.params.id);
  dbRun(`UPDATE skus_nuevos SET ${updates.join(',')} WHERE id=?`, vals);
  res.json({ mensaje: 'Fotos guardadas' });
});

app.post('/api/skus-nuevos/:id/fotos-evidencia-url', (req, res) => {
  const sn = dbGet('SELECT id FROM skus_nuevos WHERE id=?', [req.params.id]);
  if (!sn) return res.status(404).json({ error: 'SKU nuevo no encontrado' });

  const updates = [], vals = [];
  if (req.body.url_etiqueta) { updates.push('url_foto_etiqueta=?');         vals.push(req.body.url_etiqueta); }
  if (req.body.url_insumos)  { updates.push('url_foto_insumos_origen=?');   vals.push(req.body.url_insumos); }
  if (req.body.url_pieza)    { updates.push('url_foto_producto_completo=?');vals.push(req.body.url_pieza); }

  if (updates.length === 0) return res.status(400).json({ error: 'No se recibieron URLs' });
  vals.push(req.params.id);
  dbRun(`UPDATE skus_nuevos SET ${updates.join(',')} WHERE id=?`, vals);
  res.json({ mensaje: 'Fotos guardadas' });
});

// ===================== CORREO =====================

app.post('/api/trackings/:id/enviar-correo', async (req, res) => {
  const { destinatarios, asunto, mensaje_adicional, incluir_comentarios } = req.body;

  if (!Array.isArray(destinatarios) || destinatarios.length === 0)
    return res.status(400).json({ error: 'Se requiere al menos un destinatario' });
  if (destinatarios.length > 10)
    return res.status(400).json({ error: 'Máximo 10 destinatarios por envío' });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid = destinatarios.filter(e => !emailRe.test(String(e).trim()));
  if (invalid.length) return res.status(400).json({ error: `Emails inválidos: ${invalid.join(', ')}` });

  // Rate limit: max 10 per tracking per hour
  const recent = dbGet(
    `SELECT COUNT(*) as cnt FROM correos_enviados WHERE tracking_id=? AND created_at > datetime('now','-1 hour','localtime')`,
    [req.params.id]
  );
  if ((recent?.cnt || 0) >= 10)
    return res.status(429).json({ error: 'Límite de 10 correos por hora para este tracking alcanzado' });

  const resend = getResendClient();
  if (!resend) return res.status(503).json({ error: 'Configura la API Key de Resend en el panel de administración' });

  const tracking = dbGet(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza
    FROM trackings t JOIN clientes c ON c.id=t.cliente_id WHERE t.id=?
  `, [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });

  const errores = dbAll(
    `SELECT tipo_error, COUNT(*) as total FROM errores WHERE tracking_id=? GROUP BY tipo_error`,
    [req.params.id]
  );

  const nLim = incluir_comentarios === 'todos' ? 9999 : (parseInt(incluir_comentarios) || 10);
  const comentarios = dbAll(
    `SELECT * FROM tracking_comentarios WHERE tracking_id=? ORDER BY created_at DESC LIMIT ?`,
    [req.params.id, nLim]
  ).reverse();

  const asuntoFinal = (asunto || '').trim()
    || `Seguimiento: Tracking ${tracking.tracking_number} — ${tracking.cliente_nombre}`;

  // Sanitize mensaje_adicional for HTML
  const msgHtml = mensaje_adicional
    ? escH(mensaje_adicional.trim()).replace(/\n/g, '<br>')
    : null;

  const html = buildEmailHtml({
    tracking, errores, comentarios,
    remitente: req.usuario,
    mensaje_adicional: msgHtml,
    asunto: asuntoFinal,
  });

  try {
    const { error } = await resend.emails.send({
      from: RESEND_FROM(),
      to: destinatarios.map(e => String(e).trim()),
      subject: asuntoFinal,
      html,
    });
    if (error) return res.status(500).json({ error: `Error al enviar correo: ${error.message}` });
  } catch(e) {
    return res.status(500).json({ error: `Error al enviar correo: ${e.message}` });
  }

  dbRun(
    `INSERT INTO correos_enviados (id,tracking_id,usuario_id,nombre_usuario,destinatarios,asunto,mensaje_adicional,total_comentarios_incluidos,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [uuidv4(), req.params.id, req.usuario.id, req.usuario.nombre, JSON.stringify(destinatarios), asuntoFinal, mensaje_adicional || null, comentarios.length, localNow()]
  );
  res.json({ ok: true, enviados: destinatarios.length });
});

app.get('/api/trackings/:id/correos-enviados', requireRol('ADMIN', 'SUPERVISOR'), (req, res) => {
  const rows = dbAll(
    `SELECT id, nombre_usuario, destinatarios, asunto, total_comentarios_incluidos, created_at FROM correos_enviados WHERE tracking_id=? ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(rows.map(r => ({ ...r, destinatarios: JSON.parse(r.destinatarios || '[]') })));
});

// ── ÓRDENES G0 ──────────────────────────────────────────────────────────────

const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.get('/api/ordenes', (req, res) => {
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 'o', 'cliente_id');
  const rows = dbAll(`
    SELECT o.*, c.nombre as cliente_nombre
    FROM ordenes o LEFT JOIN clientes c ON o.cliente_id = c.id
    WHERE 1=1${cf}
    ORDER BY o.created_at DESC
  `, cp);
  res.json(rows);
});

app.get('/api/ordenes/:id/items', (req, res) => {
  const items = dbAll('SELECT * FROM orden_items WHERE orden_id = ? ORDER BY order_number, sku', [req.params.id]);
  res.json(items);
});

app.post('/api/ordenes/upload', requireRol('ADMIN', 'SUPERVISOR', 'CLIENTE'), uploadCsv.single('csv'), (req, res) => {
  const { cliente_id } = req.body;
  if (!cliente_id) return res.status(400).json({ error: 'cliente_id requerido' });
  if (!req.file) return res.status(400).json({ error: 'Archivo CSV requerido' });

  const cliente = dbGet('SELECT id, grado_confianza FROM clientes WHERE id = ?', [cliente_id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (parseInt(cliente.grado_confianza) !== 0) return res.status(400).json({ error: 'El cliente debe ser G0 para subir órdenes' });

  const csvText = req.file.buffer.toString('utf8');
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return res.status(400).json({ error: 'Error al parsear el CSV: ' + parsed.errors[0].message });
  }

  const headers = parsed.meta.fields || [];
  const required = ['tracking_number', 'sku'];
  const missing = required.filter(col => !headers.includes(col));
  if (missing.length > 0) {
    return res.status(400).json({ error: `El CSV no tiene las columnas requeridas: ${missing.join(', ')}` });
  }

  const rows = parsed.data.map(r => {
    const out = {};
    Object.entries(r).forEach(([k, v]) => { out[k] = (v || '').trim(); });
    return out;
  }).filter(r => r.tracking_number && r.sku);
  if (rows.length === 0) return res.status(400).json({ error: 'El CSV no tiene filas válidas (tracking_number y sku son requeridos)' });

  const trackingsUnicos = new Set(rows.map(r => r.tracking_number)).size;
  const totalPiezas = rows.reduce((s, r) => s + (parseInt(r.quantity) || 1), 0);

  const ordenId = uuidv4();
  dbRun(`INSERT INTO ordenes (id,cliente_id,archivo_nombre,usuario_id,total_trackings,total_piezas,created_at) VALUES (?,?,?,?,?,?,?)`,
    [ordenId, cliente_id, req.file.originalname, req.usuario.id, trackingsUnicos, totalPiezas, localNow()]);

  const stmt = db.prepare(`INSERT INTO orden_items (id,orden_id,cliente_id,order_number,product_title,sku,barcode,quantity,country_of_origin,tracking_number,content) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertMany = db.transaction(items => {
    for (const r of items) {
      stmt.run(uuidv4(), ordenId, cliente_id, r.order_number || null, r.product_title || null, r.sku.toUpperCase(), r.barcode || null, parseInt(r.quantity) || 1, r.country_of_origin || null, r.tracking_number, r.content || null);
    }
  });
  insertMany(rows);

  res.json({ id: ordenId, trackings: trackingsUnicos, piezas: totalPiezas, items: rows.length });
});

app.delete('/api/ordenes/:id', requireRol('ADMIN', 'SUPERVISOR'), (req, res) => {
  const orden = dbGet('SELECT id FROM ordenes WHERE id = ?', [req.params.id]);
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  dbRun('DELETE FROM orden_items WHERE orden_id = ?', [req.params.id]);
  dbRun('DELETE FROM ordenes WHERE id = ?', [req.params.id]);
  res.json({ mensaje: 'Orden eliminada' });
});

function enrichOrdenItem(item) {
  const cid = item.cliente_id;
  let sku_resuelto = (item.sku && item.sku.trim()) ? item.sku.trim() : null;
  let datos_catalogo = null;
  let requiere_alta = false;

  if (sku_resuelto) {
    const cat = dbGet('SELECT * FROM skus WHERE cliente_id=? AND UPPER(sku_code)=UPPER(?)', [cid, sku_resuelto]);
    if (cat) datos_catalogo = { pais_origen: cat.pais_origen, insumos: cat.insumos, descripcion: cat.descripcion };
  } else {
    // Sin SKU en CSV: buscar en catálogo por UPC o product_title
    const byUpc = item.barcode
      ? dbGet('SELECT * FROM skus WHERE cliente_id=? AND upc_code=?', [cid, item.barcode])
      : null;
    if (byUpc) {
      sku_resuelto = byUpc.sku_code;
      datos_catalogo = { pais_origen: byUpc.pais_origen, insumos: byUpc.insumos, descripcion: byUpc.descripcion };
    } else if (item.product_title) {
      const byTitle = dbGet('SELECT * FROM skus WHERE cliente_id=? AND descripcion LIKE ?',
        [cid, `%${item.product_title.slice(0, 25)}%`]);
      if (byTitle) {
        sku_resuelto = byTitle.sku_code;
        datos_catalogo = { pais_origen: byTitle.pais_origen, insumos: byTitle.insumos, descripcion: byTitle.descripcion };
      }
    }
    if (!sku_resuelto) requiere_alta = true;
  }
  return { ...item, sku_resuelto, datos_catalogo, requiere_alta };
}

app.get('/api/ordenes/buscar-tracking', (req, res) => {
  const { codigo, cliente_id } = req.query;
  if (!codigo) return res.status(400).json({ error: 'codigo requerido' });

  // 1. Exact barcode match
  const byBarcode = dbGet('SELECT * FROM orden_items WHERE barcode = ? LIMIT 1', [codigo]);
  if (byBarcode) return res.json({ type: 'single', item: enrichOrdenItem(byBarcode) });

  // 2. Exact SKU match
  const bySku = dbGet('SELECT * FROM orden_items WHERE UPPER(sku) = UPPER(?) LIMIT 1', [codigo]);
  if (bySku) return res.json({ type: 'single', item: enrichOrdenItem(bySku) });

  // 3. Tracking number match (exact or substring) — return ALL items for that tracking
  const byTracking = dbAll(`
    SELECT * FROM orden_items
    WHERE length(tracking_number) > 0
      AND (tracking_number = ? OR instr(?, tracking_number) > 0)
    ORDER BY order_number, sku
  `, [codigo, codigo]);
  if (byTracking.length > 0) return res.json({ type: 'tracking', items: byTracking.map(enrichOrdenItem) });

  // 4. Fallback: search skus catalog by upc_code (product is known but not in this order's CSV)
  if (cliente_id) {
    const fromCatalog = dbGet('SELECT * FROM skus WHERE cliente_id = ? AND upc_code = ?', [cliente_id, codigo])
      || dbGet('SELECT * FROM skus WHERE cliente_id = ? AND UPPER(sku_code) = UPPER(?)', [cliente_id, codigo]);
    if (fromCatalog) {
      return res.json({
        type: 'single',
        item: {
          id: null, orden_id: null, cliente_id,
          order_number: null, product_title: fromCatalog.descripcion,
          sku: fromCatalog.sku_code, barcode: codigo,
          quantity: 1, country_of_origin: fromCatalog.pais_origen,
          tracking_number: null, content: null,
          sku_resuelto: fromCatalog.sku_code,
          datos_catalogo: { pais_origen: fromCatalog.pais_origen, insumos: fromCatalog.insumos, descripcion: fromCatalog.descripcion },
          requiere_alta: false,
          _from_catalog: true,
        },
      });
    }
  }

  res.json(null);
});

app.get('/api/ordenes/items-por-tracking', (req, res) => {
  const { tracking_number, cliente_id } = req.query;
  if (!tracking_number) return res.status(400).json({ error: 'tracking_number requerido' });
  // Search by tracking_number only — numbers are globally unique, so cliente_id is not needed
  const items = dbAll(
    'SELECT * FROM orden_items WHERE tracking_number = ? ORDER BY order_number, sku',
    [tracking_number]
  );
  res.json(items);
});

// ── RESUMEN DE ORDEN POR NÚMERO ──────────────────────────────────────────────

app.get('/api/ordenes/resumen-por-numero', (req, res) => {
  const { numero_orden } = req.query;
  if (!numero_orden) return res.status(400).json({ error: 'numero_orden requerido' });
  const { sql: cf, params: cp } = clienteFilter(req.usuario, 't');

  const trackings = dbAll(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE t.numero_orden = ?${cf}
    ORDER BY t.created_at DESC
  `, [numero_orden, ...cp]);

  const piezasEsperadas = dbAll(
    'SELECT SUM(quantity) as total FROM orden_items WHERE tracking_number IN (' +
    trackings.map(() => '?').join(',') + ')',
    trackings.map(t => t.tracking_number)
  )[0]?.total || 0;

  const abiertos = trackings.filter(t => t.estatus === 'abierto').length;
  const cerrados = trackings.filter(t => t.estatus !== 'abierto').length;
  const piezasConfirmadas = trackings.reduce((s, t) => s + (t.cantidad_final || 0), 0);

  res.json({
    numero_orden,
    trackings,
    stats: {
      total: trackings.length,
      abiertos,
      cerrados,
      piezas_esperadas: piezasEsperadas,
      piezas_confirmadas: piezasConfirmadas,
    },
  });
});

// ── G0 CONFIRMAR RECEPCIÓN (validacion_piezas=false) ────────────────────────

app.post('/api/trackings/:id/confirmar-recepcion-g0', (req, res) => {
  const tracking = dbGet('SELECT * FROM trackings WHERE id = ?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  if (tracking.estatus !== 'abierto') return res.status(400).json({ error: `El tracking ya está en estatus "${tracking.estatus}"` });

  const { caja_pallet_id } = req.body;
  if (!caja_pallet_id) return res.status(400).json({ error: 'caja_pallet_id requerido' });

  const caja = dbGet('SELECT * FROM cajas_pallets WHERE id = ?', [caja_pallet_id]);
  if (!caja) return res.status(404).json({ error: 'Caja/pallet no encontrada' });

  // Auto-crear g0_piezas desde orden_items si no hay ninguna registrada
  const existentes = dbGet('SELECT COUNT(*) as cnt FROM g0_piezas WHERE tracking_id = ?', [req.params.id]);
  if ((existentes?.cnt || 0) === 0) {
    const items = dbAll('SELECT * FROM orden_items WHERE tracking_number = ?', [tracking.tracking_number]);
    if (items.length === 0) return res.status(400).json({ error: 'No hay items de orden para este tracking. Sube el CSV primero.' });

    const stmt = db.prepare(`INSERT INTO g0_piezas
      (id,tracking_id,orden_item_id,sku,product_title,order_number,barcode,condicion,pais_coincide,pais_real,insumos_coincide,insumos_real,operador,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertAll = db.transaction(rows => {
      for (const r of rows) {
        for (let i = 0; i < (r.quantity || 1); i++) {
          stmt.run(uuidv4(), req.params.id, r.id, r.sku, r.product_title, r.order_number, r.barcode,
            'Buena', 1, null, 1, null, req.usuario?.email || null, localNow());
        }
      }
    });
    insertAll(items);
  }

  const totalG0 = dbGet('SELECT COUNT(*) as cnt FROM g0_piezas WHERE tracking_id = ?', [req.params.id]);
  dbRun(`UPDATE trackings SET estatus='cerrado', closed_at=datetime('now','localtime'), caja_id=?, caja_pallet_id=?, cantidad_final=? WHERE id=?`,
    [caja.nombre, caja_pallet_id, totalG0?.cnt || 0, req.params.id]);

  res.json({ mensaje: 'Tracking cerrado correctamente', piezas: totalG0?.cnt || 0 });
});

// ── G0 PIEZAS ────────────────────────────────────────────────────────────────

app.get('/api/trackings/:id/g0-piezas', (req, res) => {
  const rows = dbAll('SELECT * FROM g0_piezas WHERE tracking_id = ? ORDER BY created_at ASC', [req.params.id]);
  res.json(rows);
});

app.post('/api/trackings/:id/g0-piezas', (req, res) => {
  const tracking = dbGet('SELECT * FROM trackings WHERE id = ?', [req.params.id]);
  if (!tracking) return res.status(404).json({ error: 'Tracking no encontrado' });
  if (tracking.estatus === 'cerrado') return res.status(400).json({ error: 'El tracking ya está cerrado' });

  const { orden_item_id, sku, product_title, order_number, barcode, condicion,
          pais_coincide, pais_real, insumos_coincide, insumos_real,
          es_nuevo, pais_origen, insumos } = req.body;
  const id = uuidv4();
  dbRun(`INSERT INTO g0_piezas (id,tracking_id,orden_item_id,sku,product_title,order_number,barcode,condicion,pais_coincide,pais_real,insumos_coincide,insumos_real,operador,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.params.id, orden_item_id || null, sku || null, product_title || null, order_number || null,
     barcode || null, condicion || 'Buena',
     pais_coincide !== false ? 1 : 0, pais_real || null,
     insumos_coincide !== false ? 1 : 0, insumos_real || null,
     req.usuario.nombre, localNow()]);

  // Si es un SKU nuevo: registrar en catálogo y en skus_nuevos para revisión
  let skus_nuevo_id = null;
  if (es_nuevo && sku && tracking.cliente_id) {
    const existing = dbGet('SELECT id FROM skus WHERE cliente_id=? AND UPPER(sku_code)=UPPER(?)', [tracking.cliente_id, sku]);
    if (!existing) {
      dbRun('INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [uuidv4(), tracking.cliente_id, sku.toUpperCase(), product_title || null, pais_origen || null, insumos || null, barcode || null, localNow()]);
    }
    skus_nuevo_id = uuidv4();
    dbRun(`INSERT INTO skus_nuevos (id,tracking_id,detalle_sku_id,cliente_id,sku_code,upc,descripcion,pais_origen,insumos,operador,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [skus_nuevo_id, req.params.id, null, tracking.cliente_id, sku.toUpperCase(), barcode || null,
       product_title || null, pais_origen || null, insumos || null, req.usuario.nombre, localNow()]);
  }

  const cnt = dbGet('SELECT COUNT(*) as n FROM g0_piezas WHERE tracking_id = ?', [req.params.id]);
  dbRun('UPDATE trackings SET cantidad_final = ? WHERE id = ?', [cnt.n, req.params.id]);

  res.json({ id, skus_nuevo_id, mensaje: 'Pieza registrada' });
});

app.delete('/api/trackings/:id/g0-piezas/:pid', (req, res) => {
  const pieza = dbGet('SELECT id FROM g0_piezas WHERE id = ? AND tracking_id = ?', [req.params.pid, req.params.id]);
  if (!pieza) return res.status(404).json({ error: 'Pieza no encontrada' });
  dbRun('DELETE FROM g0_piezas WHERE id = ?', [req.params.pid]);
  const cnt = dbGet('SELECT COUNT(*) as n FROM g0_piezas WHERE tracking_id = ?', [req.params.id]);
  dbRun('UPDATE trackings SET cantidad_final = ? WHERE id = ?', [cnt.n, req.params.id]);
  res.json({ mensaje: 'Pieza eliminada' });
});

// ── BACKUP AUTOMÁTICO ────────────────────────────────────────────────────────

const BACKUP_DIR = process.env.BACKUP_DIR || '/root/backups';
const BACKUP_KEEP = 7; // número de backups a conservar

async function hacerBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `database-${ts}.bin`);
    await db.backup(dest);
    console.log(`💾 Backup DB → ${dest}`);
    // Rotar: eliminar los más antiguos si se superan BACKUP_KEEP
    const archivos = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('database-') && f.endsWith('.bin'))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    while (archivos.length > BACKUP_KEEP) {
      const viejo = archivos.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, viejo.f));
      console.log(`🗑  Backup antiguo eliminado: ${viejo.f}`);
    }
  } catch (err) {
    console.error('⚠️  Error en backup DB:', err.message);
  }
}

// ── CIERRE GRACEFUL ───────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n🛑 ${signal} recibido — cerrando DB...`);
  try { db.close(); } catch(e) { /* ya cerrada */ }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit',    () => { try { db.close(); } catch(e) { /* ya cerrada */ } });

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL — RESUMEN SEMANAL
// ══════════════════════════════════════════════════════════════════════════════

function emailBase(titulo, contenido) {
  const fromName = 'RETORNOS';
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <!-- HEADER -->
      <tr><td style="background:#00a854;padding:28px 32px;text-align:center">
        <div style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:3px">${fromName}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">Sistema de Retornos</div>
      </td></tr>
      <!-- TÍTULO -->
      <tr><td style="padding:28px 32px 0">
        <div style="font-size:20px;font-weight:700;color:#1a1a1a;border-bottom:2px solid #00a854;padding-bottom:12px">${titulo}</div>
      </td></tr>
      <!-- CONTENIDO -->
      <tr><td style="padding:24px 32px">${contenido}</td></tr>
      <!-- CTA -->
      <tr><td style="padding:0 32px 24px;text-align:center">
        <a href="https://flaviovalladolid.shop" style="display:inline-block;background:#00a854;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:700;font-size:14px">Ir al Sistema →</a>
      </td></tr>
      <!-- FOOTER -->
      <tr><td style="background:#f4f6f8;padding:16px 32px;text-align:center;border-top:1px solid #e0e0e0">
        <div style="font-size:11px;color:#888">Sistema de Retornos — <a href="https://flaviovalladolid.shop" style="color:#00a854;text-decoration:none">flaviovalladolid.shop</a></div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function obtenerDestinatariosAdminSupervisor() {
  return dbAll(`SELECT email, nombre FROM usuarios WHERE rol IN ('ADMIN','SUPERVISOR') AND activo=1 AND email IS NOT NULL AND email != ''`)
    .map(u => ({ email: u.email, name: u.nombre }));
}

async function enviarResumenSemanal() {
  const resend = getResendClient();
  if (!resend) {
    console.log('Email: RESEND_API_KEY no configurada, omitiendo resumen semanal');
    return;
  }
  const destinatarios = obtenerDestinatariosAdminSupervisor();
  if (!destinatarios.length) {
    console.log('Email: sin destinatarios ADMIN/SUPERVISOR configurados');
    return;
  }

  // Rango: lunes a domingo de la semana más recientemente completada
  // diaSemana%7 = días transcurridos desde el último domingo (dom=0,lun=1…sáb=6)
  const ahora = new Date();
  const diaSemana = ahora.getDay() === 0 ? 7 : ahora.getDay();
  const domingo = new Date(ahora); domingo.setDate(ahora.getDate() - (diaSemana % 7));
  const lunes = new Date(domingo); lunes.setDate(domingo.getDate() - 6);
  const fmtFecha = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Tijuana' });
  const fmtISO   = d => d.toISOString().slice(0, 10);

  const desde = fmtISO(lunes);
  const hasta = fmtISO(domingo);
  const labelDesde = fmtFecha(lunes);
  const labelHasta = fmtFecha(domingo);

  // Estadísticas de la semana
  const creados   = dbGet(`SELECT COUNT(*) as cnt FROM trackings WHERE date(created_at) BETWEEN ? AND ?`, [desde, hasta])?.cnt || 0;
  const cerrados  = dbGet(`SELECT COUNT(*) as cnt FROM trackings WHERE date(closed_at) BETWEEN ? AND ? AND estatus IN ('cerrado','refunded')`, [desde, hasta])?.cnt || 0;
  const abiertos  = dbGet(`SELECT COUNT(*) as cnt FROM trackings WHERE estatus='abierto'`)?.cnt || 0;
  const piezas    = dbGet(`SELECT COALESCE(SUM(d.cantidad),0) as total FROM detalle_skus d JOIN trackings t ON d.tracking_id=t.id WHERE date(d.created_at) BETWEEN ? AND ?`, [desde, hasta])?.total || 0;
  const errores   = dbGet(`SELECT COUNT(*) as cnt FROM errores WHERE date(created_at) BETWEEN ? AND ?`, [desde, hasta])?.cnt || 0;
  const tasaError = piezas > 0 ? ((errores / piezas) * 100).toFixed(1) : '0.0';

  const topClientes = dbAll(`
    SELECT c.nombre, COUNT(t.id) as total
    FROM trackings t JOIN clientes c ON t.cliente_id=c.id
    WHERE date(t.created_at) BETWEEN ? AND ?
    GROUP BY c.id ORDER BY total DESC LIMIT 3
  `, [desde, hasta]);

  const trackingsSemana = dbAll(`
    SELECT t.tracking_number, c.nombre as cliente, t.cantidad_final as piezas,
           t.estatus, t.operador,
           (SELECT COUNT(*) FROM errores e WHERE e.tracking_id=t.id) as num_errores
    FROM trackings t JOIN clientes c ON t.cliente_id=c.id
    WHERE date(t.created_at) BETWEEN ? AND ?
    ORDER BY t.created_at DESC LIMIT 50
  `, [desde, hasta]);

  // ── Construir contenido HTML ──
  const tdH = 'style="background:#f4f6f8;padding:8px 10px;font-size:11px;font-weight:700;color:#555;text-align:left;border-bottom:2px solid #e0e0e0"';
  const tdC = 'style="padding:8px 10px;font-size:12px;color:#333;border-bottom:1px solid #f0f0f0"';
  const statCard = (label, val, color='#1a1a1a') =>
    `<td style="text-align:center;padding:0 8px">
      <div style="background:#f9f9f9;border:1px solid #e8e8e8;border-radius:6px;padding:14px 10px">
        <div style="font-size:26px;font-weight:900;color:${color}">${val}</div>
        <div style="font-size:10px;color:#888;margin-top:2px;text-transform:uppercase;letter-spacing:.5px">${label}</div>
      </div>
    </td>`;

  let contenido = '';

  if (creados === 0 && piezas === 0) {
    contenido = `<p style="color:#888;text-align:center;padding:32px 0;font-size:14px">Sin actividad registrada esta semana.</p>`;
  } else {
    contenido = `
      <!-- Stats -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr>
          ${statCard('Trackings creados', creados, '#00a854')}
          ${statCard('Trackings cerrados', cerrados, '#007bff')}
          ${statCard('Pendientes', abiertos, '#ff8c00')}
        </tr>
        <tr><td colspan="3" style="padding-top:8px"></td></tr>
        <tr>
          ${statCard('Piezas inspeccionadas', piezas.toLocaleString('es-MX'), '#00a854')}
          ${statCard('Errores registrados', errores, errores > 0 ? '#e53935' : '#00a854')}
          ${statCard('Tasa de error', tasaError + '%', parseFloat(tasaError) > 5 ? '#e53935' : parseFloat(tasaError) > 2 ? '#ff8c00' : '#00a854')}
        </tr>
      </table>

      ${topClientes.length ? `
      <!-- Top clientes -->
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:8px">Top clientes con más actividad</div>
        ${topClientes.map((c, i) => `
          <div style="display:flex;align-items:center;margin-bottom:6px">
            <span style="display:inline-block;width:20px;height:20px;background:#00a854;color:#fff;border-radius:50%;font-size:10px;font-weight:700;line-height:20px;text-align:center;margin-right:8px">${i+1}</span>
            <span style="font-size:13px;color:#333">${c.nombre}</span>
            <span style="margin-left:auto;font-size:12px;color:#888">${c.total} tracking${c.total !== 1 ? 's' : ''}</span>
          </div>
        `).join('')}
      </div>` : ''}

      ${trackingsSemana.length ? `
      <!-- Tabla trackings -->
      <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:8px">Trackings de la semana</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
        <thead>
          <tr>
            <th ${tdH}>Tracking</th>
            <th ${tdH}>Cliente</th>
            <th ${tdH} style="text-align:right">Piezas</th>
            <th ${tdH} style="text-align:right">Errores</th>
            <th ${tdH}>Estado</th>
            <th ${tdH}>Operador</th>
          </tr>
        </thead>
        <tbody>
          ${trackingsSemana.map(t => {
            const color = t.estatus === 'cerrado' ? '#00a854' : t.estatus === 'refunded' ? '#007bff' : '#ff8c00';
            return `<tr>
              <td ${tdC} style="font-family:monospace;color:#333">${t.tracking_number}</td>
              <td ${tdC}>${t.cliente}</td>
              <td ${tdC} style="text-align:right">${t.piezas || 0}</td>
              <td ${tdC} style="text-align:right;color:${t.num_errores > 0 ? '#e53935' : '#888'}">${t.num_errores}</td>
              <td ${tdC}><span style="color:${color};font-weight:700;font-size:11px">${t.estatus}</span></td>
              <td ${tdC} style="color:#888;font-size:11px">${(t.operador || '').split('@')[0]}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
    `;
  }

  const asunto = `Resumen semanal — ${labelDesde} al ${labelHasta} — Retornos`;
  const html = emailBase(`Resumen semanal: ${labelDesde} al ${labelHasta}`, contenido);

  for (const dest of destinatarios) {
    try {
      const { error } = await resend.emails.send({ from: RESEND_FROM(), to: dest.email, subject: asunto, html });
      if (error) console.error(`Error enviando email a ${dest.email}:`, error.message);
      else console.log(`Email enviado a ${dest.email}`);
    } catch (err) {
      console.error(`Error enviando email a ${dest.email}:`, err.message);
    }
  }
}

// ── Config SMTP (solo ADMIN) ────────────────────────────────────────────────
const ENV_PATH = path.join(__dirname, '.env');

function leerEnv() {
  try {
    return fs.readFileSync(ENV_PATH, 'utf8');
  } catch { return ''; }
}

function escribirEnv(vars) {
  const lines = leerEnv().split('\n').filter(l => l.trim());
  const map = new Map(lines.map(l => {
    const i = l.indexOf('='); return i > 0 ? [l.slice(0, i), l.slice(i + 1)] : [l, ''];
  }));
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) map.set(k, v);
  }
  const content = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  // Recargar en process.env
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
}

app.get('/api/email/config', (req, res) => {
  if (req.usuario?.rol !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
  res.json({ RESEND_API_KEY_SET: !!(process.env.RESEND_API_KEY) });
});

app.put('/api/email/config', (req, res) => {
  if (req.usuario?.rol !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
  const { RESEND_API_KEY } = req.body;
  const updates = {};
  if (RESEND_API_KEY) updates.RESEND_API_KEY = RESEND_API_KEY;
  try {
    escribirEnv(updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Endpoint de prueba (solo ADMIN) ────────────────────────────────────────
app.post('/api/email/test-semanal', async (req, res) => {
  if (req.usuario?.rol !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
  try {
    await enviarResumenSemanal();
    res.json({ ok: true, mensaje: 'Resumen semanal enviado' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error enviando email' });
  }
});

// ── INICIAR SERVIDOR ──────────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📦 Sistema Logístico de Inspección v1.0`);
  });
  // Backup inicial y luego cada 6 horas
  hacerBackup();
  setInterval(hacerBackup, 6 * 60 * 60 * 1000);

  // Cron: resumen semanal lunes 8am hora Tijuana
  if (nodeCron) {
    nodeCron.schedule('0 8 * * 1', () => {
      console.log('Cron: enviando resumen semanal...');
      enviarResumenSemanal().catch(err => console.error('Cron email error:', err.message));
    }, { timezone: 'America/Tijuana' });
    console.log('📧 Cron resumen semanal: lunes 8:00am (America/Tijuana)');
  }
});
