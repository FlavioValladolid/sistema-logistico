#!/usr/bin/env node
/**
 * crear-datos-prueba.js
 * Crea datos de prueba completos para todos los grados de confianza.
 * Uso: node backend/scripts/crear-datos-prueba.js
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../database.bin');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── helpers ────────────────────────────────────────────────────────────────

function localNow(offsetSeconds = 0) {
  const d = new Date(Date.now() - offsetSeconds * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function pastDate(daysAgo, hoursOffset = 0) {
  return localNow((daysAgo * 86400) + (hoursOffset * 3600));
}
function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function padN(n) { return String(n).padStart(6, '0'); }

const PAISES = ['CN', 'VN', 'BD', 'MX', 'IN', 'KH'];
const PAISES_NOMBRE = { CN:'China', VN:'Vietnam', BD:'Bangladesh', MX:'México', IN:'India', KH:'Cambodia' };
const INSUMOS = [
  '100% Algodón',
  '100% Poliéster',
  '65% Poliéster 35% Algodón',
  '95% Algodón 5% Elastano',
  '78% Poliamida 22% Elastano',
  'Shell:78% Recycled Polyamide 22% Elastane / Lining:90% Recycled Nylon 10% Spandex',
];
const COLORES = ['Rojo', 'Azul', 'Verde', 'Negro', 'Blanco', 'Gris', 'Amarillo', 'Morado'];
const TIPOS_PRENDA = ['Camisa', 'Pantalón', 'Vestido', 'Blusa', 'Short', 'Falda', 'Chamarra', 'Traje de baño', 'Zapato', 'Sandalia'];
const TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '6', '7', '8', '9', '10'];

// ─── limpieza de datos de prueba anteriores ──────────────────────────────────

function limpiarDatosPrevios() {
  console.log('\n🧹 Limpiando datos de prueba anteriores...');
  const prefijos = ['TEST-G0', 'TEST-G1', 'TEST-G2', 'TEST-G3'];
  for (const pref of prefijos) {
    const cliente = db.prepare("SELECT id FROM clientes WHERE nombre LIKE ?").get(`${pref}%`);
    if (!cliente) continue;
    const cid = cliente.id;
    // borrar en cascada
    const trackings = db.prepare('SELECT id FROM trackings WHERE cliente_id=?').all(cid);
    for (const t of trackings) {
      db.prepare('DELETE FROM detalle_skus WHERE tracking_id=?').run(t.id);
      db.prepare('DELETE FROM errores WHERE tracking_id=?').run(t.id);
      db.prepare('DELETE FROM retrabajos WHERE tracking_id=?').run(t.id);
      db.prepare('DELETE FROM alertas_discrepancia WHERE tracking_id=?').run(t.id);
      db.prepare('DELETE FROM g0_piezas WHERE tracking_id=?').run(t.id);
    }
    db.prepare('DELETE FROM trackings WHERE cliente_id=?').run(cid);
    db.prepare('DELETE FROM cajas_pallets WHERE cliente_id=?').run(cid);
    db.prepare('DELETE FROM skus WHERE cliente_id=?').run(cid);
    const ordenes = db.prepare('SELECT id FROM ordenes WHERE cliente_id=?').all(cid);
    for (const o of ordenes) {
      db.prepare('DELETE FROM orden_items WHERE orden_id=?').run(o.id);
    }
    db.prepare('DELETE FROM ordenes WHERE cliente_id=?').run(cid);
    db.prepare('DELETE FROM clientes WHERE id=?').run(cid);
    console.log(`  ✓ Limpiado: ${pref}`);
  }
}

// ─── crear cliente ────────────────────────────────────────────────────────────

function crearCliente(datos) {
  const id = uuidv4();
  db.prepare(`INSERT INTO clientes
    (id,nombre,grado_confianza,porcentaje_muestreo,modulo_calidad,modulo_retrabajo,
     tipo_almacenamiento,uph,tipo_mercancia,fotos_adicionales,requiere_orden,
     requiere_tipo_retorno,requiere_nota_credito,validacion_piezas,validacion_condicion,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, datos.nombre, datos.grado_confianza, datos.porcentaje_muestreo || 30,
      datos.modulo_calidad ? 1 : 0, datos.modulo_retrabajo ? 1 : 0,
      datos.tipo_almacenamiento || 'caja', datos.uph || 0,
      datos.tipo_mercancia || 'textil', datos.fotos_adicionales || 0,
      datos.requiere_orden ? 1 : 0, datos.requiere_tipo_retorno ? 1 : 0,
      datos.requiere_nota_credito ? 1 : 0,
      datos.validacion_piezas ? 1 : 0, datos.validacion_condicion ? 1 : 0,
      localNow());
  return id;
}

// ─── crear SKUs para un cliente ──────────────────────────────────────────────

function crearSkus(clienteId, cantidad = 10) {
  const skus = [];
  for (let i = 1; i <= cantidad; i++) {
    const id = uuidv4();
    const pais = rnd(PAISES);
    const insumos = rnd(INSUMOS);
    const tipo = rnd(TIPOS_PRENDA);
    const color = rnd(COLORES);
    const talla = rnd(TALLAS);
    const sku_code = `SKU-${String(i).padStart(3,'0')}-${clienteId.slice(0,4).toUpperCase()}`;
    const upc = String(100000000000 + i).slice(0, 12);
    const descripcion = `${tipo} ${color} Talla ${talla}`;
    db.prepare(`INSERT INTO skus (id,cliente_id,sku_code,descripcion,pais_origen,insumos,upc_code,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, clienteId, sku_code, descripcion, pais, insumos, upc, localNow());
    skus.push({ id, sku_code, descripcion, pais, insumos, upc });
  }
  return skus;
}

// ─── crear cajas ─────────────────────────────────────────────────────────────

function crearCajas(clienteId, clienteNombre) {
  const tipos = ['Good Condition', 'Good Condition', 'Damage', 'Non-brand merchandise'];
  const abrs = { 'Damage': 'DMG', 'Good Condition': 'GDC', 'Non-brand merchandise': 'NBM' };
  const tag = clienteId.slice(0, 6).toUpperCase();
  const cajas = [];
  for (let i = 0; i < tipos.length; i++) {
    const tipo = tipos[i];
    const abr = abrs[tipo];
    const consecutivo = i + 1;
    const nombre = `TST-${tag}-${abr}-${String(consecutivo).padStart(3,'0')}`;
    const id = uuidv4();
    db.prepare(`INSERT INTO cajas_pallets (id,cliente_id,nombre,tipo,consecutivo,estatus,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(id, clienteId, nombre, tipo, consecutivo, 'Abierta', localNow());
    cajas.push({ id, nombre, tipo });
  }
  return cajas;
}

// ─── crear tracking con detalles ─────────────────────────────────────────────

function crearTracking({ clienteId, cajaId, skus, config, daysAgo = 0 }) {
  const trackingNum = `TEST${Date.now()}${padN(rndInt(1, 999999))}`;
  const id = uuidv4();
  const cantDeclarada = config.cantDeclarada || rndInt(3, 15);
  const estatus = config.cerrar ? 'cerrado' : 'abierto';

  db.prepare(`INSERT INTO trackings
    (id,tracking_number,cliente_id,caja_id,operador,cantidad_declarada,cantidad_final,estatus,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, trackingNum, clienteId, cajaId, 'test@sistema.com',
      cantDeclarada, cantDeclarada, 'abierto', pastDate(daysAgo));

  let cantFinal = 0;
  const detallesIds = [];

  for (const sku of skus) {
    const cantidad = config.cantPorSku || 1;
    const paisCoincide = config.paisIncorrecto ? 0 : 1;
    const insumosCoincide = config.insumosIncorrecto ? 0 : 1;
    const paisReal = paisCoincide ? sku.pais : rnd(PAISES.filter(p => p !== sku.pais));
    const insumosReal = insumosCoincide ? sku.insumos : rnd(INSUMOS.filter(ins => ins !== sku.insumos));
    const calidad = config.calidadMala ? 'Mala' : 'Buena';

    const did = uuidv4();
    db.prepare(`INSERT INTO detalle_skus
      (id,tracking_id,sku_code,descripcion,cantidad,pais_origen_catalogo,pais_origen_real,pais_coincide,
       insumos_catalogo,insumos_real,insumos_coincide,calidad,es_nuevo,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(did, id, sku.sku_code, sku.descripcion, cantidad,
        sku.pais, paisReal, paisCoincide,
        sku.insumos, insumosReal, insumosCoincide,
        calidad, 0, pastDate(daysAgo));

    detallesIds.push({ did, sku, calidad, paisCoincide, insumosCoincide });
    cantFinal += cantidad;

    // Errores cuando hay discrepancias
    if (!paisCoincide || !insumosCoincide || calidad === 'Mala') {
      const tipos = [];
      if (!paisCoincide) tipos.push('Origen');
      if (!insumosCoincide) tipos.push('Insumo');
      if (calidad === 'Mala') tipos.push('Calidad');
      for (const tipo of tipos) {
        db.prepare(`INSERT INTO errores (id,tracking_id,detalle_sku_id,tipo_error,path_fotografia,comentarios,created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(uuidv4(), id, did, tipo, null, `Error de ${tipo} en ${sku.sku_code}`, pastDate(daysAgo));
      }
    }

    // Retrabajo si calidad mala y cliente tiene módulo
    if (calidad === 'Mala' && config.conRetrabajo) {
      db.prepare(`INSERT INTO retrabajos (id,tracking_id,detalle_sku_id,cliente_id,sku_code,descripcion_sku,retrabajos_seleccionados,retrabajo_otro,estatus,created_at)
        VALUES (?,?,?,?,?,?,?,?,'Pendiente',?)`)
        .run(uuidv4(), id, did, clienteId, sku.sku_code, sku.descripcion,
          JSON.stringify(['Limpieza', 'Re-empaque']), null, pastDate(daysAgo));
    }
  }

  // Discrepancia si cantFinal != cantDeclarada
  if (config.conDiscrepancia || cantFinal !== cantDeclarada) {
    const cantCorr = cantFinal;
    db.prepare(`INSERT INTO alertas_discrepancia (id,tracking_id,cantidad_original,cantidad_corregida,created_at) VALUES (?,?,?,?,?)`)
      .run(uuidv4(), id, cantDeclarada, cantCorr, pastDate(daysAgo));
    db.prepare('UPDATE trackings SET cantidad_final=? WHERE id=?').run(cantCorr, id);
  } else {
    db.prepare('UPDATE trackings SET cantidad_final=? WHERE id=?').run(cantFinal, id);
  }

  if (estatus === 'cerrado') {
    db.prepare("UPDATE trackings SET estatus='cerrado', closed_at=? WHERE id=?").run(pastDate(daysAgo), id);
  }

  return { id, trackingNum, detallesIds };
}

// ─── G1 — Flujo Rápido (20 trackings) ──────────────────────────────────────

function crearEscenarioG1(clienteId, skus, cajas) {
  console.log('\n📦 Creando escenario G1 (20 trackings)...');
  let n = 0;

  // 5 cantidad correcta, sin discrepancia, cerrados
  for (let i = 0; i < 5; i++) {
    crearTracking({ clienteId, cajaId: cajas[0].id, skus: [rnd(skus)],
      config: { cantDeclarada: 1, cantPorSku: 1, cerrar: true }, daysAgo: rndInt(1,30) });
    n++;
  }
  // 5 con discrepancia (declarada != real)
  for (let i = 0; i < 5; i++) {
    const skuSel = [rnd(skus), rnd(skus)];
    crearTracking({ clienteId, cajaId: cajas[1].id, skus: skuSel,
      config: { cantDeclarada: 5, cantPorSku: 1, conDiscrepancia: true, cerrar: true }, daysAgo: rndInt(1,30) });
    n++;
  }
  // 5 cerrados normalmente
  for (let i = 0; i < 5; i++) {
    crearTracking({ clienteId, cajaId: cajas[0].id, skus: [rnd(skus), rnd(skus)],
      config: { cantPorSku: 1, cerrar: true }, daysAgo: rndInt(1,15) });
    n++;
  }
  // 5 abiertos
  for (let i = 0; i < 5; i++) {
    crearTracking({ clienteId, cajaId: cajas[1].id, skus: [rnd(skus)],
      config: { cantPorSku: 1, cerrar: false }, daysAgo: rndInt(0,3) });
    n++;
  }
  console.log(`  ✓ ${n} trackings G1 creados`);
}

// ─── G2 — Muestreo (20 trackings) ──────────────────────────────────────────

function crearEscenarioG2(clienteId, skus, cajas) {
  console.log('\n📦 Creando escenario G2 (20 trackings)...');
  let n = 0;

  // 5 todo correcto
  for (let i = 0; i < 5; i++) {
    const skuSel = skus.slice(0, 3);
    crearTracking({ clienteId, cajaId: cajas[0].id, skus: skuSel,
      config: { cantPorSku: 2, cerrar: true }, daysAgo: rndInt(1,30) });
    n++;
  }
  // 5 con país incorrecto
  for (let i = 0; i < 5; i++) {
    const skuSel = [rnd(skus), rnd(skus)];
    crearTracking({ clienteId, cajaId: cajas[1].id, skus: skuSel,
      config: { cantPorSku: 1, paisIncorrecto: true, cerrar: true }, daysAgo: rndInt(1,30) });
    n++;
  }
  // 5 con insumos incorrectos
  for (let i = 0; i < 5; i++) {
    const skuSel = [rnd(skus), rnd(skus)];
    crearTracking({ clienteId, cajaId: cajas[2].id, skus: skuSel,
      config: { cantPorSku: 1, insumosIncorrecto: true, cerrar: true }, daysAgo: rndInt(1,20) });
    n++;
  }
  // 5 mezcla de errores
  for (let i = 0; i < 5; i++) {
    const skuSel = skus.slice(2, 5);
    crearTracking({ clienteId, cajaId: cajas[0].id, skus: skuSel,
      config: { cantPorSku: 1, paisIncorrecto: true, insumosIncorrecto: true, calidadMala: true, cerrar: true }, daysAgo: rndInt(1,10) });
    n++;
  }
  console.log(`  ✓ ${n} trackings G2 creados`);
}

// ─── G3 — Control Total (20 trackings) ──────────────────────────────────────

function crearEscenarioG3(clienteId, skus, cajas) {
  console.log('\n📦 Creando escenario G3 (20 trackings)...');
  let n = 0;

  // 5 perfectos
  for (let i = 0; i < 5; i++) {
    const skuSel = skus.slice(0, 4);
    crearTracking({ clienteId, cajaId: cajas[0].id, skus: skuSel,
      config: { cantPorSku: 2, cerrar: true }, daysAgo: rndInt(1,30) });
    n++;
  }
  // 5 con calidad mala + retrabajo
  for (let i = 0; i < 5; i++) {
    const skuSel = skus.slice(1, 4);
    crearTracking({ clienteId, cajaId: cajas[1].id, skus: skuSel,
      config: { cantPorSku: 1, calidadMala: true, conRetrabajo: true, cerrar: true }, daysAgo: rndInt(1,25) });
    n++;
  }
  // 5 con discrepancia + errores de calidad
  for (let i = 0; i < 5; i++) {
    const skuSel = skus.slice(3, 7);
    crearTracking({ clienteId, cajaId: cajas[2].id, skus: skuSel,
      config: { cantDeclarada: 10, cantPorSku: 1, conDiscrepancia: true, calidadMala: true, cerrar: true }, daysAgo: rndInt(1,15) });
    n++;
  }
  // 5 con errores país + insumos + calidad mala
  for (let i = 0; i < 5; i++) {
    const skuSel = skus.slice(5, 9);
    crearTracking({ clienteId, cajaId: cajas[3].id, skus: skuSel,
      config: { cantPorSku: 1, paisIncorrecto: true, insumosIncorrecto: true, calidadMala: true, conRetrabajo: true, cerrar: true }, daysAgo: rndInt(1,8) });
    n++;
  }
  console.log(`  ✓ ${n} trackings G3 creados`);
}

// ─── G0 — Procesamiento (10 trackings) ──────────────────────────────────────

function crearEscenarioG0(clienteId, cajas) {
  console.log('\n📦 Creando escenario G0 (10 trackings con orden CSV)...');

  // Generar 10 tracking numbers de prueba
  const trackingNums = Array.from({ length: 10 }, (_, i) => `9400136${String(Date.now()).slice(-9)}${i}`);
  const orderNum = `ORD-${Date.now()}`;
  const orderId = uuidv4();

  // Crear la orden
  db.prepare(`INSERT INTO ordenes (id,cliente_id,archivo_nombre,usuario_id,total_trackings,total_piezas,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(orderId, clienteId, 'orden-prueba-g0.csv', 'test-script', 10, 50, localNow());

  // SKUs de la orden (50 items distribuidos en 10 trackings, 5 por tracking)
  const ordenItems = [];
  const skuCatalogo = [
    { sku: 'G0-SKU-001', title: 'Traje Baño Mujer Azul', country: 'CN', content: '78% Poliamida 22% Elastano', barcode: '1234567890001' },
    { sku: 'G0-SKU-002', title: 'Traje Baño Mujer Rojo', country: 'VN', content: 'Shell:78% Recycled Polyamide 22% Elastane / Lining:90% Recycled Nylon 10% Spandex', barcode: '1234567890002' },
    { sku: 'G0-SKU-003', title: 'Traje Baño Niña Verde', country: 'BD', content: '95% Algodón 5% Elastano', barcode: '1234567890003' },
    { sku: 'G0-SKU-004', title: 'Bikini Top Negro', country: 'CN', content: '100% Poliéster', barcode: '1234567890004' },
    { sku: 'G0-SKU-005', title: 'Bikini Bottom Blanco', country: 'VN', content: '78% Poliamida 22% Elastano', barcode: '1234567890005' },
  ];

  for (let t = 0; t < 10; t++) {
    for (let s = 0; s < 5; s++) {
      const sku = skuCatalogo[s];
      const itemId = uuidv4();
      db.prepare(`INSERT INTO orden_items (id,orden_id,cliente_id,order_number,product_title,sku,barcode,quantity,country_of_origin,tracking_number,content) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(itemId, orderId, clienteId, orderNum, sku.title, sku.sku, sku.barcode, 1, sku.country, trackingNums[t], sku.content);
      ordenItems.push({ ...sku, id: itemId, tracking_number: trackingNums[t] });
    }
  }

  // 3 trackings: encontrados en orden, validación completa
  for (let i = 0; i < 3; i++) {
    const tnum = trackingNums[i];
    const tid = uuidv4();
    db.prepare(`INSERT INTO trackings (id,tracking_number,cliente_id,caja_id,operador,cantidad_declarada,cantidad_final,estatus,created_at)
      VALUES (?,?,?,?,?,?,?,'abierto',?)`)
      .run(tid, tnum, clienteId, cajas[0].id, 'test@sistema.com', 5, 0, pastDate(rndInt(1,10)));

    const itemsDeTrk = ordenItems.filter(oi => oi.tracking_number === tnum);
    for (const item of itemsDeTrk) {
      db.prepare(`INSERT INTO g0_piezas (id,tracking_id,orden_item_id,sku,product_title,order_number,barcode,condicion,pais_coincide,pais_real,insumos_coincide,insumos_real,operador,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(uuidv4(), tid, item.id, item.sku, item.title, orderNum, item.barcode,
          'Buena', 1, null, 1, null, 'test@sistema.com', pastDate(rndInt(1,10)));
    }
    db.prepare("UPDATE trackings SET cantidad_final=5, estatus='cerrado', closed_at=? WHERE id=?").run(localNow(), tid);
  }

  // 3 trackings: encontrados en orden, sin validación (solo escaneo)
  for (let i = 3; i < 6; i++) {
    const tnum = trackingNums[i];
    const tid = uuidv4();
    db.prepare(`INSERT INTO trackings (id,tracking_number,cliente_id,caja_id,operador,cantidad_declarada,cantidad_final,estatus,created_at)
      VALUES (?,?,?,?,?,?,?,'abierto',?)`)
      .run(tid, tnum, clienteId, cajas[1].id, 'test@sistema.com', 5, 0, pastDate(rndInt(1,10)));

    const itemsDeTrk = ordenItems.filter(oi => oi.tracking_number === tnum);
    for (const item of itemsDeTrk) {
      db.prepare(`INSERT INTO g0_piezas (id,tracking_id,orden_item_id,sku,product_title,order_number,barcode,condicion,pais_coincide,pais_real,insumos_coincide,insumos_real,operador,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(uuidv4(), tid, item.id, item.sku, item.title, orderNum, item.barcode,
          null, 1, null, 1, null, 'test@sistema.com', pastDate(rndInt(1,10)));
    }
    db.prepare("UPDATE trackings SET cantidad_final=5, estatus='cerrado', closed_at=? WHERE id=?").run(localNow(), tid);
  }

  // 2 trackings: con discrepancia de cantidad (esperado 5, solo 3 escaneados)
  for (let i = 6; i < 8; i++) {
    const tnum = trackingNums[i];
    const tid = uuidv4();
    db.prepare(`INSERT INTO trackings (id,tracking_number,cliente_id,caja_id,operador,cantidad_declarada,cantidad_final,estatus,created_at)
      VALUES (?,?,?,?,?,?,?,'abierto',?)`)
      .run(tid, tnum, clienteId, cajas[0].id, 'test@sistema.com', 5, 0, pastDate(rndInt(1,10)));

    const itemsDeTrk = ordenItems.filter(oi => oi.tracking_number === tnum).slice(0, 3);
    for (const item of itemsDeTrk) {
      db.prepare(`INSERT INTO g0_piezas (id,tracking_id,orden_item_id,sku,product_title,order_number,barcode,condicion,pais_coincide,pais_real,insumos_coincide,insumos_real,operador,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(uuidv4(), tid, item.id, item.sku, item.title, orderNum, item.barcode,
          'Buena', 1, null, 1, null, 'test@sistema.com', pastDate(rndInt(1,10)));
    }
    db.prepare("UPDATE trackings SET cantidad_final=3, estatus='cerrado', closed_at=? WHERE id=?").run(localNow(), tid);
  }

  // 2 trackings: abiertos (sin cerrar)
  for (let i = 8; i < 10; i++) {
    const tnum = trackingNums[i];
    const tid = uuidv4();
    db.prepare(`INSERT INTO trackings (id,tracking_number,cliente_id,caja_id,operador,cantidad_declarada,cantidad_final,estatus,created_at)
      VALUES (?,?,?,?,?,?,?,'abierto',?)`)
      .run(tid, tnum, clienteId, cajas[1].id, 'test@sistema.com', 5, 0, pastDate(1));
  }

  console.log(`  ✓ 10 trackings G0 creados, orden con ${ordenItems.length} items`);
}

// ─── insertar datos de volumen (1000 trackings históricos) ───────────────────

function crearDatosVolumen(clienteId, skus, cajas) {
  console.log('\n📊 Creando 1000 trackings de volumen (90 días)...');
  const stmt = db.prepare(`INSERT INTO trackings
    (id,tracking_number,cliente_id,caja_id,operador,cantidad_declarada,cantidad_final,estatus,created_at)
    VALUES (?,?,?,?,?,?,?,'cerrado',?)`);
  const stmtDet = db.prepare(`INSERT INTO detalle_skus
    (id,tracking_id,sku_code,descripcion,cantidad,pais_origen_catalogo,pais_origen_real,pais_coincide,insumos_catalogo,insumos_real,insumos_coincide,calidad,es_nuevo,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insert = db.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      const daysAgo = rndInt(1, 90);
      const tid = uuidv4();
      const tn = `VOL${Date.now()}${padN(i)}`;
      const sku = rnd(skus);
      const cant = rndInt(1, 10);
      stmt.run(tid, tn, clienteId, rnd(cajas).id, 'volumen@test.com', cant, cant, pastDate(daysAgo));
      stmtDet.run(uuidv4(), tid, sku.sku_code, sku.descripcion, cant,
        sku.pais, sku.pais, 1, sku.insumos, sku.insumos, 1, 'Buena', 0, pastDate(daysAgo));
    }
  });
  insert();
  console.log('  ✓ 1000 trackings de volumen creados');
}

// ─── main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('═══════════════════════════════════════════');
  console.log('   CREACIÓN DE DATOS DE PRUEBA');
  console.log('═══════════════════════════════════════════');

  limpiarDatosPrevios();

  // G0
  console.log('\n🟠 Creando cliente G0...');
  const g0Id = crearCliente({
    nombre: 'TEST-G0-Procesamiento',
    grado_confianza: 0,
    validacion_piezas: true,
    validacion_condicion: true,
    modulo_calidad: true,
    tipo_mercancia: 'traje_bano',
  });
  const g0Cajas = crearCajas(g0Id, 'TEST-G0');
  console.log(`  ✓ Cliente G0 id=${g0Id}, ${g0Cajas.length} cajas`);
  crearEscenarioG0(g0Id, g0Cajas);

  // G1
  console.log('\n🟡 Creando cliente G1...');
  const g1Id = crearCliente({ nombre: 'TEST-G1-FlujoRapido', grado_confianza: 1 });
  const g1Skus = crearSkus(g1Id, 10);
  const g1Cajas = crearCajas(g1Id, 'TEST-G1');
  console.log(`  ✓ Cliente G1 id=${g1Id}, ${g1Skus.length} SKUs, ${g1Cajas.length} cajas`);
  crearEscenarioG1(g1Id, g1Skus, g1Cajas);

  // G2
  console.log('\n🟢 Creando cliente G2...');
  const g2Id = crearCliente({ nombre: 'TEST-G2-Muestreo', grado_confianza: 2, porcentaje_muestreo: 30, modulo_calidad: true });
  const g2Skus = crearSkus(g2Id, 10);
  const g2Cajas = crearCajas(g2Id, 'TEST-G2');
  console.log(`  ✓ Cliente G2 id=${g2Id}, ${g2Skus.length} SKUs, ${g2Cajas.length} cajas`);
  crearEscenarioG2(g2Id, g2Skus, g2Cajas);

  // G3
  console.log('\n🔵 Creando cliente G3...');
  const g3Id = crearCliente({ nombre: 'TEST-G3-ControlTotal', grado_confianza: 3, modulo_calidad: true, modulo_retrabajo: true, tipo_mercancia: 'calzado' });
  const g3Skus = crearSkus(g3Id, 10);
  const g3Cajas = crearCajas(g3Id, 'TEST-G3');
  console.log(`  ✓ Cliente G3 id=${g3Id}, ${g3Skus.length} SKUs, ${g3Cajas.length} cajas`);
  crearEscenarioG3(g3Id, g3Skus, g3Cajas);

  // Datos de volumen en G2 (para prueba de carga)
  crearDatosVolumen(g2Id, g2Skus, g2Cajas);

  // Resumen
  console.log('\n═══════════════════════════════════════════');
  console.log('   RESUMEN FINAL');
  console.log('═══════════════════════════════════════════');
  const totales = {
    clientes:  db.prepare("SELECT COUNT(*) as n FROM clientes WHERE nombre LIKE 'TEST-%'").get().n,
    trackings: db.prepare("SELECT COUNT(*) as n FROM trackings WHERE operador IN ('test@sistema.com','volumen@test.com')").get().n,
    detalles:  db.prepare("SELECT COUNT(*) as n FROM detalle_skus WHERE tracking_id IN (SELECT id FROM trackings WHERE operador IN ('test@sistema.com','volumen@test.com'))").get().n,
    errores:   db.prepare("SELECT COUNT(*) as n FROM errores WHERE tracking_id IN (SELECT id FROM trackings WHERE operador IN ('test@sistema.com','volumen@test.com'))").get().n,
    retrabajos:db.prepare("SELECT COUNT(*) as n FROM retrabajos WHERE tracking_id IN (SELECT id FROM trackings WHERE operador IN ('test@sistema.com','volumen@test.com'))").get().n,
  };
  console.log(`  Clientes de prueba : ${totales.clientes}`);
  console.log(`  Trackings creados  : ${totales.trackings}`);
  console.log(`  Detalles SKU       : ${totales.detalles}`);
  console.log(`  Errores registrados: ${totales.errores}`);
  console.log(`  Retrabajos         : ${totales.retrabajos}`);
  console.log('\n✅ Datos de prueba creados exitosamente.\n');

  db.close();
}

main();
