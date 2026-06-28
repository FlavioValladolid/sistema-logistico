# Packing List B2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow B2B clients to upload one packing list per order_number (not per box), configurable per retailer, with a pending badge in the trackings view.

**Architecture:** New `packing_lists` table keyed by `(cliente_id, order_number)`; `clientes_retail` JSON format expands from `[string]` to `[{nombre, packing}]` with a backward-compat normalizer helper used everywhere; upload endpoint reuses the existing `upload` multer instance (local disk or S3); GET /api/trackings enriched with `tiene_packing` and `clientes_retail`; ordenes.html detail view shows packing status per order_number; trackings.html shows badge when retailer requires packing and none uploaded.

**Tech Stack:** Node.js/Express, better-sqlite3, multer (existing `upload` instance at server.js:92), vanilla JS frontend

## Global Constraints

- `clientes_retail` new format: `[{"nombre":"RetailerA","packing":false},{"nombre":"RetailerB","packing":true}]` — array of objects, not strings
- Backward-compat normalize helper (used in Tasks 2, 3, 4, 5): `const norm = r => typeof r === 'string' ? {nombre: r, packing: false} : r`
- `packing_lists` UNIQUE constraint on `(cliente_id, order_number)` — re-upload replaces via `INSERT OR REPLACE`
- Auth bypass pattern lives in `authMiddleware` block at server.js lines 700–714
- File upload uses existing `upload` multer (`upload.single('packing')`); field name is `packing`
- Only show packing badge/section for B2B trackings (`canal === 'B2B'`) whose retailer has `packing: true` in client config
- No new npm packages
- `escHTML()` available globally in all frontend files

---

### Task 1: Backend — packing_lists table, API endpoints, trackings enrichment

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Produces:
  - `POST /api/packing-lists` — multipart fields: `cliente_id` (string), `order_number` (string), file field `packing`; returns `{id, cliente_id, order_number, archivo_url, archivo_nombre}`
  - `GET /api/ordenes/:id/packing-lists` — returns `[{id, order_number, archivo_url, archivo_nombre, created_at}]` for all order_numbers in that orden
  - `DELETE /api/packing-lists/:id` — ADMIN/SUPERVISOR only; returns `{mensaje}`
  - GET /api/trackings rows now include `tiene_packing` (0 or 1) and `clientes_retail` (TEXT, the raw JSON string)

- [ ] **Step 1: Add `packing_lists` table and auth bypass**

  In the DB initialization block (after line ~426 where other migrations live), add:
  ```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS packing_lists (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL,
      order_number TEXT NOT NULL,
      archivo_url TEXT NOT NULL,
      archivo_nombre TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(cliente_id, order_number),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);
  ```

  In the `authMiddleware` block (after line 712 — the existing CLIENTE PUT bypasses), add:
  ```js
  // Allow CLIENTE to upload packing lists
  if (req.method === 'POST' && req.path === '/packing-lists' && sesion.rol === 'CLIENTE') return next();
  ```

- [ ] **Step 2: Enrich GET /api/trackings with `tiene_packing` and `clientes_retail`**

  In the `app.get('/api/trackings', ...)` handler (lines ~1137–1144), update the SELECT to add two columns at the end of the column list:
  ```js
  const rows = dbAll(`
    SELECT t.*, c.nombre as cliente_nombre, c.grado_confianza, c.modulo_calidad, c.modulo_retrabajo, c.porcentaje_muestreo, c.tipo_almacenamiento, c.tipo_mercancia, c.fotos_adicionales, c.requiere_orden, c.requiere_tipo_retorno, c.requiere_nota_credito, c.requiere_nombre_destinatario, c.validacion_piezas, c.validacion_condicion, c.requiere_fotos_sku_nuevo, c.tipo_canal, c.clientes_retail,
      COALESCE((SELECT COUNT(*) FROM tracking_comentarios tc WHERE tc.tracking_id = t.id), 0) as total_comentarios,
      CASE WHEN COALESCE((SELECT COUNT(*) FROM tracking_comentarios tc WHERE tc.tracking_id = t.id), 0) > 0 AND COALESCE(t.chat_resuelto, 0) = 0 THEN 1 ELSE 0 END as tiene_comentarios,
      CASE WHEN t.canal = 'B2B' AND t.numero_orden IS NOT NULL AND EXISTS (
        SELECT 1 FROM packing_lists pl WHERE pl.cliente_id = t.cliente_id AND pl.order_number = t.numero_orden
      ) THEN 1 ELSE 0 END as tiene_packing
    FROM trackings t LEFT JOIN clientes c ON t.cliente_id = c.id
    WHERE 1=1${cf}${extraSql}
    ORDER BY t.created_at DESC
  `, [...cp, ...extraParams]);
  ```

- [ ] **Step 3: Add POST /api/packing-lists endpoint**

  Add after the `app.delete('/api/ordenes/:id', ...)` block (~line 2837):
  ```js
  app.post('/api/packing-lists', upload.single('packing'), (req, res) => {
    const { cliente_id, order_number } = req.body;
    if (!cliente_id || !order_number) return res.status(400).json({ error: 'cliente_id y order_number requeridos' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const cliente = dbGet('SELECT id, tipo_canal FROM clientes WHERE id = ?', [cliente_id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (cliente.tipo_canal !== 'B2B') return res.status(400).json({ error: 'Solo clientes B2B pueden usar packing lists' });
    const allowedIds = getUserClienteIds(req.usuario.id, req.usuario.rol);
    if (allowedIds !== null && !allowedIds.includes(cliente_id)) {
      return res.status(403).json({ error: 'No tienes acceso a este cliente' });
    }
    const id = uuidv4();
    const archivo_url = getFileUrl(req.file);
    const archivo_nombre = req.file.originalname;
    dbRun(`INSERT OR REPLACE INTO packing_lists (id,cliente_id,order_number,archivo_url,archivo_nombre,usuario_id,created_at) VALUES (?,?,?,?,?,?,?)`,
      [id, cliente_id, order_number, archivo_url, archivo_nombre, req.usuario.id, localNow()]);
    res.json({ id, cliente_id, order_number, archivo_url, archivo_nombre });
  });
  ```

- [ ] **Step 4: Add GET /api/ordenes/:id/packing-lists endpoint**

  Add immediately after the POST endpoint:
  ```js
  app.get('/api/ordenes/:id/packing-lists', (req, res) => {
    const orden = dbGet('SELECT id, cliente_id FROM ordenes WHERE id = ?', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    const allowedIds = getUserClienteIds(req.usuario.id, req.usuario.rol);
    if (allowedIds !== null && !allowedIds.includes(orden.cliente_id)) {
      return res.status(403).json({ error: 'No tienes acceso a esta orden' });
    }
    const orderNumbers = dbAll(
      'SELECT DISTINCT order_number FROM orden_items WHERE orden_id = ? AND order_number IS NOT NULL',
      [req.params.id]
    ).map(r => r.order_number);
    if (orderNumbers.length === 0) return res.json([]);
    const ph = orderNumbers.map(() => '?').join(',');
    const rows = dbAll(
      `SELECT id, order_number, archivo_url, archivo_nombre, created_at FROM packing_lists WHERE cliente_id = ? AND order_number IN (${ph})`,
      [orden.cliente_id, ...orderNumbers]
    );
    res.json(rows);
  });
  ```

- [ ] **Step 5: Add DELETE /api/packing-lists/:id endpoint**

  Add after the GET endpoint:
  ```js
  app.delete('/api/packing-lists/:id', requireRol('ADMIN', 'SUPERVISOR'), (req, res) => {
    const pl = dbGet('SELECT id FROM packing_lists WHERE id = ?', [req.params.id]);
    if (!pl) return res.status(404).json({ error: 'Packing list no encontrado' });
    dbRun('DELETE FROM packing_lists WHERE id = ?', [req.params.id]);
    res.json({ mensaje: 'Eliminado' });
  });
  ```

- [ ] **Step 6: Restart backend and verify**

  ```bash
  # restart however the project starts (e.g. node backend/server.js or npm start in backend/)
  curl -s http://localhost:3001/api/trackings -H "Authorization: Bearer <token>" | jq '.[0] | {tiene_packing, clientes_retail, canal}'
  # Expected: {"tiene_packing": 0, "clientes_retail": null, "canal": null}  (or matching real data)
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add backend/server.js
  git commit -m "feat: packing_lists tabla, endpoints CRUD y enriquecimiento de trackings"
  ```

---

### Task 2: clientes.html — per-retailer packing toggle

**Files:**
- Modify: `frontend/clientes.html`

**Context — current state:**
- `agregarRetailer()` creates chips with `chip.dataset.retailer = nombre` (plain string)
- `editarCliente()` does `retailers.forEach(r => { document.getElementById('retail-input').value = r; agregarRetailer(); })`
  where `r` is a plain string
- `guardarCliente()` collects `chips.map(el => el.dataset.retailer)` → array of strings → `JSON.stringify(retailers)`
- Chip HTML: `${escHTML(nombre)} <button>✕</button>`

**Changes needed:**
- `chip.dataset.retailerNombre = nombre`, `chip.dataset.retailerPacking = 'false'` (default)
- Chip HTML gains a packing toggle
- `editarCliente` normalizes `r` → `{nombre, packing}` and restores toggle state
- `guardarCliente` collects `{nombre, packing}` objects

- [ ] **Step 1: Replace `agregarRetailer()` function**

  Find `function agregarRetailer() {` and replace the entire function body:
  ```js
  function agregarRetailer() {
    const input = document.getElementById('retail-input');
    const nombre = input.value.trim();
    if (!nombre) return;
    const lista = document.getElementById('retail-lista');
    const existing = [...lista.querySelectorAll('[data-retailer-nombre]')].map(el => el.dataset.retailerNombre.toLowerCase());
    if (existing.includes(nombre.toLowerCase())) { input.value = ''; return; }
    _appendRetailerChip(lista, nombre, false);
    input.value = '';
    input.focus();
  }

  function _appendRetailerChip(lista, nombre, packing) {
    const chip = document.createElement('div');
    chip.dataset.retailerNombre = nombre;
    chip.dataset.retailerPacking = packing ? 'true' : 'false';
    chip.style.cssText = 'display:flex;align-items:center;gap:8px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px';
    chip.innerHTML = `
      <span style="flex:1;font-weight:500">${escHTML(nombre)}</span>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--text-muted);white-space:nowrap;user-select:none">
        <input type="checkbox" data-packing-check onchange="this.closest('[data-retailer-nombre]').dataset.retailerPacking=this.checked?'true':'false'"
          style="accent-color:var(--accent-amber)" ${packing ? 'checked' : ''}>
        Packing
      </label>
      <button type="button" onclick="this.closest('[data-retailer-nombre]').remove()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;padding:0">✕</button>
    `;
    lista.appendChild(chip);
  }
  ```

- [ ] **Step 2: Update `editarCliente()` to restore packing toggles**

  Find this block inside `editarCliente()`:
  ```js
  if (b2bEnabled) {
    let retailers = [];
    try { retailers = JSON.parse(c.clientes_retail || '[]'); } catch(e) {}
    retailers.forEach(r => {
      document.getElementById('retail-input').value = r;
      agregarRetailer();
    });
  }
  ```

  Replace with:
  ```js
  if (b2bEnabled) {
    let retailers = [];
    try { retailers = JSON.parse(c.clientes_retail || '[]'); } catch(e) {}
    const lista = document.getElementById('retail-lista');
    retailers.forEach(r => {
      const norm = typeof r === 'string' ? {nombre: r, packing: false} : r;
      _appendRetailerChip(lista, norm.nombre, norm.packing);
    });
  }
  ```

- [ ] **Step 3: Update `guardarCliente()` to serialize `{nombre, packing}` objects**

  Find this block inside `guardarCliente()`:
  ```js
  clientes_retail: (() => {
    if (!document.getElementById('cliente-b2b').checked) return null;
    const chips = [...document.getElementById('retail-lista').querySelectorAll('[data-retailer]')];
    const retailers = chips.map(el => el.dataset.retailer);
    return retailers.length ? JSON.stringify(retailers) : null;
  })(),
  ```

  Replace with:
  ```js
  clientes_retail: (() => {
    if (!document.getElementById('cliente-b2b').checked) return null;
    const chips = [...document.getElementById('retail-lista').querySelectorAll('[data-retailer-nombre]')];
    const retailers = chips.map(el => ({nombre: el.dataset.retailerNombre, packing: el.dataset.retailerPacking === 'true'}));
    return retailers.length ? JSON.stringify(retailers) : null;
  })(),
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/clientes.html
  git commit -m "feat: toggle packing list por retailer en configuración de cliente B2B"
  ```

---

### Task 3: operacion.html — normalize retailer format

**Files:**
- Modify: `frontend/operacion.html`

**Context — current code in `onCanalOperacionChange()` (~line 965–969):**
```js
let retailers = [];
try { retailers = JSON.parse(opt?.dataset.retail || '[]'); } catch(e) {}
retailerSel.innerHTML = '<option value="">— Seleccionar retailer —</option>' +
  retailers.map(r => `<option value="${escHTML(r)}">${escHTML(r)}</option>`).join('');
```

`r` is currently a plain string. After Task 2, it will be `{nombre, packing}`. Old clients still have string arrays — use normalize helper.

- [ ] **Step 1: Update `onCanalOperacionChange()` retailer parsing**

  Replace those 4 lines (the `let retailers` through the `retailerSel.innerHTML` assignment) with:
  ```js
  let retailers = [];
  try { retailers = JSON.parse(opt?.dataset.retail || '[]'); } catch(e) {}
  const normRetailers = retailers.map(r => typeof r === 'string' ? {nombre: r, packing: false} : r);
  retailerSel.innerHTML = '<option value="">— Seleccionar retailer —</option>' +
    normRetailers.map(r => `<option value="${escHTML(r.nombre)}">${escHTML(r.nombre)}</option>`).join('');
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/operacion.html
  git commit -m "fix: normalizar formato retailer {nombre,packing} en selector de operación"
  ```

---

### Task 4: ordenes.html — packing list upload per order_number in detail view

**Files:**
- Modify: `frontend/ordenes.html`

**Context:**
- `verDetalle(id)` fetches `GET /api/ordenes/:id/items`, renders a flat items table
- `orden` object available in `ordenesData` via `const orden = ordenesData.find(o => o.id === id)`
- `API.postForm(path, formData)` available globally from `js/app.js`
- `API.get(path)` available globally
- `formatDate(str)` available globally
- Auth bypass for CLIENTE to POST /packing-lists already added in Task 1

**Goal:** After the existing items table, add a "Packing Lists" section listing unique order_numbers and their upload status.

- [ ] **Step 1: Add `_packingState` module-level variable**

  After `let _parsedCsv = null;` (line ~108), add:
  ```js
  let _packingState = {}; // { [order_number]: {id, archivo_url, archivo_nombre, created_at} | null }
  let _detalleOrdenId = null;
  let _detalleClienteId = null;
  ```

- [ ] **Step 2: Replace `verDetalle()` to fetch packing lists and render section**

  Find `async function verDetalle(id) {` and replace the entire function:
  ```js
  async function verDetalle(id) {
    const card = document.getElementById('detalle-card');
    const content = document.getElementById('detalle-content');
    const orden = ordenesData.find(o => o.id === id);
    document.getElementById('detalle-titulo').textContent = `${t('ordenes.detail_title')} — ${orden?.archivo_nombre || ''}`;
    card.classList.remove('hidden');
    content.innerHTML = '<div class="text-center" style="padding:24px"><div class="spinner"></div></div>';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    _detalleOrdenId = id;
    _detalleClienteId = orden?.cliente_id || null;

    try {
      const [items, packingLists] = await Promise.all([
        API.get(`/ordenes/${id}/items`),
        API.get(`/ordenes/${id}/packing-lists`).catch(() => [])
      ]);

      _packingState = {};
      packingLists.forEach(pl => { _packingState[pl.order_number] = pl; });

      if (items.length === 0) {
        content.innerHTML = '<div class="text-center" style="padding:24px;color:var(--text-muted)">Sin ítems</div>';
        return;
      }

      const uniqueOrders = [...new Set(items.map(i => i.order_number).filter(Boolean))];

      content.innerHTML = `
        <div class="table-wrapper table-scroll" style="border:none">
          <table>
            <thead>
              <tr>
                <th>${t('ordenes.col_order')}</th>
                <th>${t('ordenes.col_sku')}</th>
                <th>${t('ordenes.col_product')}</th>
                <th>${t('ordenes.col_barcode')}</th>
                <th>${t('ordenes.col_qty')}</th>
                <th>${t('ordenes.col_country')}</th>
                <th>${t('ordenes.col_tracking')}</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(i => `
                <tr>
                  <td class="td-mono" style="font-size:12px">${escHTML(i.order_number) || '—'}</td>
                  <td class="td-mono" style="color:var(--accent-cyan);font-weight:700">${escHTML(i.sku)}</td>
                  <td>${escHTML(i.product_title) || '—'}</td>
                  <td class="td-mono" style="font-size:11px">${escHTML(i.barcode) || '—'}</td>
                  <td class="td-mono">${i.quantity}</td>
                  <td>${escHTML(i.country_of_origin) || '—'}</td>
                  <td class="td-mono" style="font-size:11px;color:var(--accent-cyan)">${escHTML(i.tracking_number)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${uniqueOrders.length > 0 ? `
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
            <div style="font-weight:600;font-size:13px;margin-bottom:12px">Packing Lists</div>
            <div id="packing-lista" style="display:flex;flex-direction:column;gap:10px">
              ${uniqueOrders.map(on => renderPackingRow(on)).join('')}
            </div>
          </div>
        ` : ''}
      `;
    } catch(e) {
      content.innerHTML = `<div class="alert alert-error">Error al cargar detalle</div>`;
    }
  }
  ```

- [ ] **Step 3: Add `renderPackingRow()` and `subirPacking()` functions**

  Add after `verDetalle`:
  ```js
  function renderPackingRow(orderNumber) {
    const pl = _packingState[orderNumber];
    const rowId = `packing-row-${CSS.escape(orderNumber)}`;
    if (pl) {
      return `
        <div id="${rowId}" style="display:flex;align-items:center;gap:12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px">
          <span class="badge badge-green" style="white-space:nowrap">✓ Subido</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <a href="${escHTML(pl.archivo_url)}" target="_blank" style="color:var(--accent-cyan)">${escHTML(pl.archivo_nombre)}</a>
            </div>
            <div style="font-size:11px;color:var(--text-muted)">Orden: ${escHTML(orderNumber)} · ${formatDate(pl.created_at)}</div>
          </div>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            Reemplazar
            <input type="file" accept=".pdf,image/*" style="display:none" onchange="subirPacking('${escHTML(orderNumber)}',this)">
          </label>
        </div>`;
    }
    return `
      <div id="${rowId}" style="display:flex;align-items:center;gap:12px;background:var(--bg-elevated);border:1px solid rgba(255,193,7,.3);border-radius:var(--radius-sm);padding:10px 14px">
        <span class="badge badge-amber" style="white-space:nowrap">Pendiente</span>
        <div style="flex:1;font-size:12px;color:var(--text-muted)">Orden: ${escHTML(orderNumber)}</div>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer">
          Subir Packing List
          <input type="file" accept=".pdf,image/*" style="display:none" onchange="subirPacking('${escHTML(orderNumber)}',this)">
        </label>
      </div>`;
  }

  async function subirPacking(orderNumber, inputEl) {
    const file = inputEl.files[0];
    if (!file || !_detalleClienteId || !_detalleOrdenId) return;
    const fd = new FormData();
    fd.append('cliente_id', _detalleClienteId);
    fd.append('order_number', orderNumber);
    fd.append('packing', file);
    try {
      const result = await API.postForm('/packing-lists', fd);
      _packingState[orderNumber] = result;
      const rowId = `packing-row-${CSS.escape(orderNumber)}`;
      const row = document.getElementById(rowId);
      if (row) row.outerHTML = renderPackingRow(orderNumber);
      toast('Packing list subido');
    } catch(e) {
      toast(e.error || 'Error al subir packing list', 'error');
    }
  }
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/ordenes.html
  git commit -m "feat: packing list upload por order_number en detalle de orden G0"
  ```

---

### Task 5: trackings.html — packing badge

**Files:**
- Modify: `frontend/trackings.html`

**Context:**
- `trackingsData` rows now have `tr.tiene_packing` (0 or 1), `tr.clientes_retail` (JSON TEXT), `tr.canal`, `tr.retailer`, `tr.numero_orden`
- The badge shows ONLY when: `tr.canal === 'B2B'` AND `tr.numero_orden` exists AND the tracking's retailer has `packing: true` in `tr.clientes_retail` AND `tr.tiene_packing === 0`
- Badge goes in the Orden # column cell (after the existing order number span), OR as a separate indicator next to Destinatario
- `escHTML()` available globally

**Interfaces:**
- Consumes: `tr.tiene_packing` (number 0/1), `tr.clientes_retail` (string JSON), `tr.canal` (string), `tr.retailer` (string), `tr.numero_orden` (string) — all from Task 1

- [ ] **Step 1: Add `packingPendiente(tr)` helper function**

  In the `<script>` block, after the `applyFilters()` function, add:
  ```js
  function packingPendiente(tr) {
    if (tr.canal !== 'B2B' || !tr.numero_orden || tr.tiene_packing) return false;
    try {
      const retailers = JSON.parse(tr.clientes_retail || '[]');
      const match = retailers.find(r => {
        const nombre = typeof r === 'string' ? r : r.nombre;
        return nombre === tr.retailer;
      });
      return match && typeof match === 'object' && match.packing === true;
    } catch(e) { return false; }
  }
  ```

- [ ] **Step 2: Add packing badge in the Orden # cell**

  In `renderTabla()`, find the Orden # `<td>` block:
  ```js
  <td class="td-mono" style="font-size:12px">
    ${tr.numero_orden
      ? `<span onclick="event.stopPropagation();verOrden('${escHTML(tr.numero_orden)}')"
          style="color:var(--accent-cyan);cursor:pointer;text-decoration:underline"
          title="Ver todos los trackings de esta orden">${escHTML(tr.numero_orden)}</span>`
      : '<span style="color:var(--text-muted)">—</span>'}
  </td>
  ```

  Replace with:
  ```js
  <td class="td-mono" style="font-size:12px">
    ${tr.numero_orden
      ? `<span onclick="event.stopPropagation();verOrden('${escHTML(tr.numero_orden)}')"
          style="color:var(--accent-cyan);cursor:pointer;text-decoration:underline"
          title="Ver todos los trackings de esta orden">${escHTML(tr.numero_orden)}</span>`
      : '<span style="color:var(--text-muted)">—</span>'}
    ${packingPendiente(tr) ? `<div style="margin-top:3px"><span class="badge badge-amber" style="font-size:9px">⚠ Packing</span></div>` : ''}
  </td>
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/trackings.html
  git commit -m "feat: badge packing list pendiente en tabla de trackings"
  ```
