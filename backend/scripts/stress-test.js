#!/usr/bin/env node
/**
 * stress-test.js
 * Prueba de carga concurrente del servidor.
 * Uso: node backend/scripts/stress-test.js [--users 20] [--url http://localhost:3000]
 *
 * Requiere servidor corriendo y un usuario ADMIN existente.
 */

const http = require('http');
const https = require('https');

// ─── config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i+1] ? args[i+1] : def;
};

const BASE_URL  = getArg('--url', 'http://localhost:3000');
const N_USERS   = parseInt(getArg('--users', '20'));
const EMAIL     = getArg('--email', 'admin@sistema.com');
const PASSWORD  = getArg('--password', 'Admin1234!');
const WARN_MS   = parseInt(getArg('--warn', '500'));
const FAIL_MS   = parseInt(getArg('--fail', '2000'));

// ─── http helper ─────────────────────────────────────────────────────────────

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const start = Date.now();

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const ms = Date.now() - start;
        try { resolve({ status: res.statusCode, body: JSON.parse(data), ms }); }
        catch { resolve({ status: res.statusCode, body: data, ms }); }
      });
    });
    req.on('error', err => reject({ error: err.message, ms: Date.now() - start }));
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── resultados acumulados ────────────────────────────────────────────────────

const results = [];
let totalRequests = 0;
let failedRequests = 0;
let warnRequests = 0;

function recordResult(label, ms, status, error) {
  totalRequests++;
  const level = error || status >= 400 ? 'ERROR' : ms >= FAIL_MS ? 'FALLO' : ms >= WARN_MS ? 'WARN' : 'OK';
  if (level === 'FALLO' || level === 'ERROR') failedRequests++;
  if (level === 'WARN') warnRequests++;
  results.push({ label, ms, status, level });
  const icon = { OK: '✓', WARN: '⚠', FALLO: '✕', ERROR: '✗' }[level];
  process.stdout.write(`  ${icon} [${level.padEnd(5)}] ${label} → ${ms}ms (HTTP ${status || 'ERR'})\n`);
}

// ─── secuencia de un usuario ──────────────────────────────────────────────────

async function secuenciaUsuario(userId, token, clienteId, cajaId) {
  const prefix = `U${String(userId).padStart(2,'0')}`;

  // 1. GET /api/trackings
  try {
    const r = await request('GET', '/api/trackings?limit=50', null, token);
    recordResult(`${prefix} GET /trackings`, r.ms, r.status);
  } catch(e) { recordResult(`${prefix} GET /trackings`, e.ms||0, 0, true); }

  // 2. GET /api/skus
  try {
    const r = await request('GET', `/api/skus?cliente_id=${clienteId}`, null, token);
    recordResult(`${prefix} GET /skus`, r.ms, r.status);
  } catch(e) { recordResult(`${prefix} GET /skus`, e.ms||0, 0, true); }

  // 3. POST /api/trackings (crear tracking)
  const trackingNum = `STRESS${Date.now()}${userId}${Math.floor(Math.random()*9999)}`;
  let trackingId = null;
  try {
    const r = await request('POST', '/api/trackings', {
      tracking_number: trackingNum,
      cliente_id: clienteId,
      cantidad_declarada: 5,
    }, token);
    trackingId = r.body?.id;
    recordResult(`${prefix} POST /trackings`, r.ms, r.status);
  } catch(e) { recordResult(`${prefix} POST /trackings`, e.ms||0, 0, true); }

  if (!trackingId) return;

  // 4. POST /api/trackings/:id/detalles × 5
  const skuBase = `STRESS-SKU-${userId}`;
  const detalleIds = [];
  for (let s = 1; s <= 5; s++) {
    try {
      const r = await request('POST', `/api/trackings/${trackingId}/detalles`, {
        sku_code: `${skuBase}-${s}`,
        descripcion: `Producto stress ${s}`,
        cantidad: 1,
        pais_origen_catalogo: 'CN',
        pais_origen_real: 'CN',
        pais_coincide: true,
        insumos_catalogo: '100% Poliéster',
        insumos_real: '100% Poliéster',
        insumos_coincide: true,
        calidad: 'Buena',
        es_nuevo: true,
      }, token);
      if (r.body?.id) detalleIds.push(r.body.id);
      recordResult(`${prefix} POST /detalles #${s}`, r.ms, r.status);
    } catch(e) { recordResult(`${prefix} POST /detalles #${s}`, e.ms||0, 0, true); }
  }

  // 5. GET /api/reportes/resumen
  try {
    const r = await request('GET', '/api/reportes/resumen', null, token);
    recordResult(`${prefix} GET /reportes/resumen`, r.ms, r.status);
  } catch(e) { recordResult(`${prefix} GET /reportes/resumen`, e.ms||0, 0, true); }

  // 6. GET /api/trackings/:id/detalles
  try {
    const r = await request('GET', `/api/trackings/${trackingId}/detalles`, null, token);
    recordResult(`${prefix} GET /detalles`, r.ms, r.status);
  } catch(e) { recordResult(`${prefix} GET /detalles`, e.ms||0, 0, true); }

  // Cerrar tracking (caja_pallet_id va en el body)
  try {
    const r = await request('POST', `/api/trackings/${trackingId}/cerrar`, { caja_pallet_id: cajaId }, token);
    recordResult(`${prefix} POST /cerrar`, r.ms, r.status);
  } catch(e) { recordResult(`${prefix} POST /cerrar`, e.ms||0, 0, true); }
}

// ─── estadísticas ─────────────────────────────────────────────────────────────

function estadisticas() {
  const tiempos = results.filter(r => r.level !== 'ERROR').map(r => r.ms).sort((a,b)=>a-b);
  if (tiempos.length === 0) return { avg:0, min:0, max:0, p95:0 };
  const avg = Math.round(tiempos.reduce((s,t)=>s+t,0) / tiempos.length);
  const p95 = tiempos[Math.ceil(tiempos.length * 0.95) - 1];
  return { avg, min: tiempos[0], max: tiempos[tiempos.length-1], p95 };
}

function reporte() {
  console.log('\n═══════════════════════════════════════════');
  console.log('   RESULTADOS STRESS TEST');
  console.log('═══════════════════════════════════════════');

  const s = estadisticas();
  const byLevel = results.reduce((acc, r) => { acc[r.level] = (acc[r.level]||0)+1; return acc; }, {});

  console.log(`\n  Total requests  : ${totalRequests}`);
  console.log(`  ✓ OK            : ${byLevel.OK || 0}`);
  console.log(`  ⚠ Advertencias  : ${byLevel.WARN || 0}  (>${WARN_MS}ms)`);
  console.log(`  ✕ Fallos        : ${byLevel.FALLO || 0}  (>${FAIL_MS}ms)`);
  console.log(`  ✗ Errores HTTP  : ${byLevel.ERROR || 0}`);
  console.log(`\n  Tiempo promedio : ${s.avg}ms`);
  console.log(`  Tiempo mínimo  : ${s.min}ms`);
  console.log(`  Tiempo máximo  : ${s.max}ms`);
  console.log(`  Percentil 95   : ${s.p95}ms`);

  if (failedRequests > 0 || warnRequests > 0) {
    console.log('\n  Requests con problema:');
    results.filter(r => r.level !== 'OK').forEach(r => {
      const icon = r.level === 'WARN' ? '⚠' : '✕';
      console.log(`    ${icon} ${r.label} → ${r.ms}ms`);
    });
  }

  const verdict = failedRequests > 0 ? '❌ FALLO' : warnRequests > 0 ? '⚠ ADVERTENCIA' : '✅ APROBADO';
  console.log(`\n  Veredicto: ${verdict}`);
  console.log('═══════════════════════════════════════════\n');
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(`   STRESS TEST — ${N_USERS} usuarios simultáneos`);
  console.log(`   Servidor: ${BASE_URL}`);
  console.log(`   Umbral WARN: ${WARN_MS}ms  FALLO: ${FAIL_MS}ms`);
  console.log('═══════════════════════════════════════════\n');

  // Login
  console.log('🔐 Autenticando...');
  let token;
  try {
    const r = await request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
    if (!r.body?.token) { console.error('❌ Login fallido:', r.body); process.exit(1); }
    token = r.body.token;
    console.log(`  ✓ Token obtenido\n`);
  } catch(e) { console.error('❌ No se pudo conectar al servidor:', e.error || e); process.exit(1); }

  // Obtener primer cliente y caja disponibles
  const clientesR = await request('GET', '/api/clientes', null, token);
  const clientes = Array.isArray(clientesR.body) ? clientesR.body : [];
  // Preferir clientes TEST con grado >= 1 que tengan cajas abiertas
  let cliente = null;
  let caja = null;
  const candidatos = clientes.filter(c => c.grado_confianza >= 1);
  for (const c of candidatos) {
    const cajasR2 = await request('GET', `/api/cajas?cliente_id=${c.id}`, null, token);
    const cajas2 = Array.isArray(cajasR2.body) ? cajasR2.body : [];
    const cajaAbierta = cajas2.find(x => x.estatus === 'Abierta');
    if (cajaAbierta) { cliente = c; caja = cajaAbierta; break; }
  }
  if (!cliente || !caja) { console.error('❌ No hay cliente con caja abierta. Corre crear-datos-prueba.js primero.'); process.exit(1); }

  console.log(`📋 Cliente: ${cliente.nombre} (G${cliente.grado_confianza})`);
  console.log(`📦 Caja: ${caja.nombre}\n`);

  // Lanzar N usuarios concurrentes
  console.log(`🚀 Iniciando ${N_USERS} usuarios en paralelo...\n`);
  const start = Date.now();

  await Promise.all(
    Array.from({ length: N_USERS }, (_, i) =>
      secuenciaUsuario(i + 1, token, cliente.id, caja.id)
    )
  );

  const totalMs = Date.now() - start;
  console.log(`\n⏱  Tiempo total: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);

  reporte();
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
