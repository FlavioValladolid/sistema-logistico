# Bulk Refund con Número de Crédito — Vista Cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al rol CLIENTE seleccionar múltiples trackings cerrados y marcarlos como refunded en lote, con un número de crédito compartido opcional.

**Architecture:** Todo el cambio vive en `frontend/trackings.html`. Se agrega estado de selección (`selectedIds`), una columna de checkboxes visible solo para CLIENTE, controles de bulk action en el header de la tabla, y un modal de confirmación que llama en paralelo a los endpoints ya existentes del backend.

**Tech Stack:** HTML/CSS/JS vanilla inline. Endpoints existentes: `PUT /api/trackings/:id/refunded`, `PUT /api/trackings/:id/nota-credito`. El objeto `tr` de cada tracking ya trae `requiere_nota_credito` desde el JOIN con clientes en el backend.

## Global Constraints

- Solo el rol `CLIENTE` (`_pageUser?.rol === 'CLIENTE'`) ve checkboxes y bulk action.
- Solo filas con `estatus === 'cerrado'` tienen checkbox activo; otras filas no tienen checkbox.
- El número de crédito es uno para todos los seleccionados.
- La selección se limpia al cambiar de página o al aplicar filtros.
- `requiere_nota_credito` se lee de `tr.requiere_nota_credito` (ya viene en la respuesta del API).
- Seguir el patrón de estilos inline existente en el archivo (sin clases CSS nuevas).
- Usar `API.put(path, body)` del helper existente en `js/app.js`.
- Usar `toast(mensaje, tipo)` del helper existente para feedback.

---

### Task 1: Estado de selección y limpieza en filtros/paginación

**Files:**
- Modify: `frontend/trackings.html` — sección de variables globales (línea ~75) y funciones `applyFilters` y `goToPage`

**Interfaces:**
- Produces: variable global `let selectedIds = new Set()` y función `updateBulkUI()` (stub vacío por ahora)

- [ ] **Step 1: Agregar variable de estado `selectedIds` justo después de `let pageSize = 50;`**

Localiza la línea `let pageSize = 50;` (~línea 78) y agrega debajo:

```js
let selectedIds = new Set();

function updateBulkUI() { /* implementado en Task 3 */ }
```

- [ ] **Step 2: Limpiar selección en `applyFilters()`**

La función `applyFilters()` empieza en ~línea 253. Al inicio del cuerpo de la función, antes de cualquier otra línea, agrega:

```js
selectedIds.clear();
updateBulkUI();
```

El resultado debe quedar:

```js
function applyFilters() {
  selectedIds.clear();
  updateBulkUI();
  const q = document.getElementById('search-tracking').value.toLowerCase();
  // ... resto sin cambios
```

- [ ] **Step 3: Limpiar selección en `goToPage()`**

La función `goToPage()` está en ~línea 241. Al inicio de su cuerpo agrega:

```js
selectedIds.clear();
updateBulkUI();
```

Resultado:

```js
function goToPage(p) {
  selectedIds.clear();
  updateBulkUI();
  currentPage = p;
  renderTabla();
  document.getElementById('tabla-trackings').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
```

- [ ] **Step 4: Verificar manualmente**

Abre `trackings.html` en el navegador, abre DevTools → Console y escribe:
```js
selectedIds
```
Debe mostrar `Set(0) {}`. Cambia el filtro y verifica que no hay errores en consola.

- [ ] **Step 5: Commit**

```bash
git add frontend/trackings.html
git commit -m "feat: estado de selección bulk refund (selectedIds)"
```

---

### Task 2: Columna de checkboxes en la tabla (header + filas)

**Files:**
- Modify: `frontend/trackings.html` — función `renderTabla()`, sección `<thead>` y sección `<tbody>`

**Interfaces:**
- Consumes: `selectedIds` (Set), `_pageUser?.rol`
- Produces: funciones `toggleRow(id, checked)` y `toggleSelectAll(checked)`; checkboxes con `data-id` en cada fila cerrada

- [ ] **Step 1: Agregar `<th>` de checkbox al inicio del `<thead>`**

Localiza este bloque dentro de `renderTabla()` (~línea 140):

```js
          <tr>
            <th>${t('trackings.col_tracking')}</th>
```

Reemplázalo por:

```js
          <tr>
            ${_pageUser?.rol === 'CLIENTE' ? `
              <th style="width:32px;padding:6px 8px;text-align:center">
                <input type="checkbox" id="chk-select-all" title="Seleccionar todos los cerrados"
                  style="accent-color:var(--accent-cyan);cursor:pointer"
                  onchange="toggleSelectAll(this.checked)">
              </th>` : ''}
            <th>${t('trackings.col_tracking')}</th>
```

- [ ] **Step 2: Agregar `<td>` de checkbox al inicio de cada fila del `<tbody>`**

Localiza el inicio del template de cada fila dentro de `pageData.map(tr => {` (~línea 162):

```js
            return `
              <tr ondblclick="window.location='operacion.html?id=${tr.id}'"
```

Agrega la celda de checkbox como primera columna dentro del `<tr>`:

```js
            return `
              <tr ondblclick="window.location='operacion.html?id=${tr.id}'" style="cursor:pointer" title="Doble clic para ver detalle">
                ${_pageUser?.rol === 'CLIENTE' ? `
                  <td style="width:32px;padding:6px 8px;text-align:center" onclick="event.stopPropagation()">
                    ${tr.estatus === 'cerrado' ? `
                      <input type="checkbox" class="chk-tracking" data-id="${tr.id}"
                        style="accent-color:var(--accent-cyan);cursor:pointer"
                        ${selectedIds.has(tr.id) ? 'checked' : ''}
                        onchange="toggleRow('${tr.id}', this.checked)">
                    ` : ''}
                  </td>` : ''}
                <td class="td-mono" style="color:var(--accent-cyan);font-weight:700">${escHTML(tr.tracking_number)}</td>
```

**Nota:** asegúrate de que el `<tr>` original que tenía `style="cursor:pointer" title="Doble clic para ver detalle"` conserve esos atributos.

- [ ] **Step 3: Implementar `toggleRow(id, checked)`**

Agrega esta función antes de `renderTabla()`:

```js
function toggleRow(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  const chkAll = document.getElementById('chk-select-all');
  if (chkAll) {
    const total = document.querySelectorAll('.chk-tracking').length;
    const checkedCount = document.querySelectorAll('.chk-tracking:checked').length;
    chkAll.indeterminate = checkedCount > 0 && checkedCount < total;
    chkAll.checked = checkedCount === total && total > 0;
  }
  updateBulkUI();
}
```

- [ ] **Step 4: Implementar `toggleSelectAll(checked)`**

Agrega esta función junto a `toggleRow`:

```js
function toggleSelectAll(checked) {
  document.querySelectorAll('.chk-tracking').forEach(chk => {
    chk.checked = checked;
    const id = chk.dataset.id;
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  updateBulkUI();
}
```

- [ ] **Step 5: Verificar manualmente**

Inicia sesión como CLIENTE. Verifica:
- Columna de checkboxes visible a la izquierda de la tabla
- Solo filas `cerrado` tienen checkbox activo
- Seleccionar / deseleccionar filas individualmente funciona
- "Seleccionar todos" selecciona/deselecciona solo los cerrados de la página
- El checkbox "todos" queda en estado indeterminado cuando hay selección parcial

Como ADMIN o SUPERVISOR verifica que la columna NO aparece.

- [ ] **Step 6: Commit**

```bash
git add frontend/trackings.html
git commit -m "feat: checkboxes de selección múltiple para CLIENTE"
```

---

### Task 3: Bulk action en el header de la tabla

**Files:**
- Modify: `frontend/trackings.html` — `<thead>` dentro de `renderTabla()` y función `updateBulkUI()`

**Interfaces:**
- Consumes: `selectedIds`, `_pageUser?.rol`
- Produces: botón `Marcar como Refunded` visible en header cuando `selectedIds.size > 0`; `updateBulkUI()` completo

- [ ] **Step 1: Agregar bulk action al `<th>` del header**

Reemplaza el `<th>` de checkbox que agregamos en Task 2:

```js
            ${_pageUser?.rol === 'CLIENTE' ? `
              <th style="width:32px;padding:6px 8px;text-align:center">
                <input type="checkbox" id="chk-select-all" title="Seleccionar todos los cerrados"
                  style="accent-color:var(--accent-cyan);cursor:pointer"
                  onchange="toggleSelectAll(this.checked)">
              </th>` : ''}
```

Por esta versión que incluye el contador y el botón de acción como columnas adicionales que se expanden:

```js
            ${_pageUser?.rol === 'CLIENTE' ? `
              <th style="width:32px;padding:6px 8px;text-align:center">
                <input type="checkbox" id="chk-select-all" title="Seleccionar todos los cerrados"
                  style="accent-color:var(--accent-cyan);cursor:pointer"
                  onchange="toggleSelectAll(this.checked)">
              </th>
              <th id="bulk-action-header" colspan="13"
                style="display:none;padding:6px 12px;background:rgba(0,188,212,.08);border-left:2px solid var(--accent-cyan)">
                <div style="display:flex;align-items:center;gap:12px">
                  <span id="bulk-count" style="font-size:12px;color:var(--accent-cyan);font-weight:700"></span>
                  <button class="btn btn-primary btn-sm" onclick="openBulkRefundModal()">
                    Marcar como Refunded
                  </button>
                  <button class="btn btn-ghost btn-sm" onclick="toggleSelectAll(false)">
                    Limpiar selección
                  </button>
                </div>
              </th>` : ''}
```

**Nota importante:** Cuando `bulk-action-header` está visible con `colspan="13"`, necesita ocultar los demás `<th>` del header. Esto se maneja en `updateBulkUI()` abajo.

- [ ] **Step 2: Implementar `updateBulkUI()` completo**

Reemplaza el stub de `updateBulkUI()` que creaste en Task 1 por la implementación completa:

```js
function updateBulkUI() {
  if (_pageUser?.rol !== 'CLIENTE') return;
  const bulkHeader = document.getElementById('bulk-action-header');
  const bulkCount = document.getElementById('bulk-count');
  if (!bulkHeader || !bulkCount) return;

  const n = selectedIds.size;
  if (n > 0) {
    bulkCount.textContent = `${n} tracking${n > 1 ? 's' : ''} seleccionado${n > 1 ? 's' : ''}`;
    bulkHeader.style.display = '';
    // Ocultar los th normales (todos excepto el de checkbox y el bulk-action-header)
    const ths = bulkHeader.closest('tr').querySelectorAll('th:not(#bulk-action-header):not(:first-child)');
    ths.forEach(th => th.style.display = 'none');
  } else {
    bulkHeader.style.display = 'none';
    const ths = bulkHeader.closest('tr').querySelectorAll('th');
    ths.forEach(th => th.style.display = '');
  }
}
```

- [ ] **Step 3: Verificar manualmente**

Inicia sesión como CLIENTE. Selecciona un tracking cerrado. Verifica:
- El header de la tabla muestra "1 tracking seleccionado" + botón "Marcar como Refunded"
- Los demás headers (Tracking, Cliente, etc.) se ocultan
- Al deseleccionar o hacer clic en "Limpiar selección", el header vuelve a normal
- Seleccionar 3 trackings muestra "3 trackings seleccionados"

- [ ] **Step 4: Commit**

```bash
git add frontend/trackings.html
git commit -m "feat: bulk action header para refund en lote"
```

---

### Task 4: Modal de confirmación con campo de crédito

**Files:**
- Modify: `frontend/trackings.html` — nueva función `openBulkRefundModal()`

**Interfaces:**
- Consumes: `selectedIds`, `filteredTrackings` (para obtener `tracking_number` y `requiere_nota_credito`)
- Produces: función `openBulkRefundModal()` que muestra el modal; llama a `executeBulkRefund(ids, notaCredito)` al confirmar

- [ ] **Step 1: Implementar `openBulkRefundModal()`**

Agrega esta función antes del cierre de `</script>`:

```js
function openBulkRefundModal() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  // Obtener datos de los trackings seleccionados
  const selTrackings = filteredTrackings.filter(tr => ids.includes(tr.id));
  // Si alguno requiere nota de crédito, mostrar el campo
  const requiereNota = selTrackings.some(tr => tr.requiere_nota_credito);

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:24px;min-width:420px;max-width:90vw;max-height:80vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700">Marcar como Refunded</div>
        <button class="btn btn-ghost btn-sm" onclick="this.closest('[style*=fixed]').remove()">✕</button>
      </div>

      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">
        Vas a marcar <strong>${ids.length} tracking${ids.length > 1 ? 's' : ''}</strong> como refunded:
      </p>

      <div style="background:var(--bg-secondary);border-radius:var(--radius-sm);padding:10px 14px;max-height:180px;overflow-y:auto;margin-bottom:16px">
        ${selTrackings.map(tr => `
          <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--accent-cyan);padding:2px 0">
            ${escHTML(tr.tracking_number)}
          </div>`).join('')}
      </div>

      ${requiereNota ? `
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">
            Número de crédito <span style="color:var(--accent-red)">*</span>
          </label>
          <input id="bulk-nota-credito" type="text" class="form-control"
            placeholder="Ej: NC-2026-001"
            style="width:100%"
            oninput="document.getElementById('btn-confirmar-refund').disabled = !this.value.trim()">
        </div>
      ` : ''}

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="this.closest('[style*=fixed]').remove()">Cancelar</button>
        <button id="btn-confirmar-refund" class="btn btn-primary btn-sm"
          ${requiereNota ? 'disabled' : ''}
          onclick="executeBulkRefund(${JSON.stringify(ids)}, ${requiereNota ? "document.getElementById('bulk-nota-credito').value.trim()" : 'null'}); this.closest('[style*=fixed]').remove()">
          Confirmar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (requiereNota) {
    setTimeout(() => document.getElementById('bulk-nota-credito')?.focus(), 50);
  }
}
```

- [ ] **Step 2: Verificar manualmente**

Inicia sesión como CLIENTE. Selecciona trackings cerrados y haz clic en "Marcar como Refunded". Verifica:
- El modal aparece con la lista de tracking numbers
- Si el cliente tiene `requiere_nota_credito = 1`: el botón "Confirmar" está deshabilitado hasta escribir algo en el campo de crédito
- Si el cliente tiene `requiere_nota_credito = 0`: el botón "Confirmar" está habilitado de inmediato
- El botón "Cancelar" y la X cierran el modal sin hacer nada
- Hacer clic fuera del modal lo cierra

- [ ] **Step 3: Commit**

```bash
git add frontend/trackings.html
git commit -m "feat: modal de confirmación bulk refund"
```

---

### Task 5: Llamadas al API y flujo de completado

**Files:**
- Modify: `frontend/trackings.html` — nueva función `executeBulkRefund(ids, notaCredito)`

**Interfaces:**
- Consumes: `ids` (array de strings), `notaCredito` (string | null), `API.put`, `toast`, `loadTrackings`, `selectedIds`
- Produces: función `executeBulkRefund` que llama al backend en paralelo y recarga la tabla

- [ ] **Step 1: Implementar `executeBulkRefund(ids, notaCredito)`**

Agrega esta función justo después de `openBulkRefundModal()`:

```js
async function executeBulkRefund(ids, notaCredito) {
  let exitosos = 0;
  let fallidos = 0;

  await Promise.all(ids.map(async id => {
    try {
      if (notaCredito) {
        await API.put(`/trackings/${id}/nota-credito`, { nota_credito: notaCredito });
      }
      await API.put(`/trackings/${id}/refunded`, {});
      exitosos++;
    } catch (e) {
      fallidos++;
    }
  }));

  selectedIds.clear();

  if (fallidos === 0) {
    toast(`${exitosos} tracking${exitosos > 1 ? 's' : ''} marcado${exitosos > 1 ? 's' : ''} como refunded`, 'success');
  } else {
    toast(`${exitosos} exitosos, ${fallidos} fallido${fallidos > 1 ? 's' : ''} (ya estaban en refunded o error)`, 'warning');
  }

  await loadTrackings();
}
```

- [ ] **Step 2: Verificar flujo completo**

Inicia sesión como CLIENTE. Busca trackings en estatus `cerrado`. Ejecuta el flujo completo:

1. Selecciona 2-3 trackings cerrados
2. Haz clic en "Marcar como Refunded"
3. (Si aplica) ingresa número de crédito
4. Haz clic en "Confirmar"
5. Verifica:
   - Toast de éxito aparece con el número correcto
   - La tabla recarga y los trackings cambian a estatus `refunded` (badge azul)
   - Los checkboxes desaparecen (filas ya no son `cerrado`)
   - La selección se limpia

Prueba el caso de error: selecciona un tracking que ya está en `refunded` (si puedes modificar el estatus temporalmente en la DB). Verifica que el toast muestra "0 exitosos, 1 fallido".

- [ ] **Step 3: Commit final**

```bash
git add frontend/trackings.html
git commit -m "feat: ejecución paralela bulk refund con nota de crédito"
```

---

## Self-Review

| Requisito del spec | Task que lo implementa |
|---|---|
| Solo CLIENTE ve checkboxes | Task 2, 3 — condición `_pageUser?.rol === 'CLIENTE'` |
| Solo `cerrado` es seleccionable | Task 2 — condición `tr.estatus === 'cerrado'` en el checkbox |
| Select-all en header de tabla | Task 2 — `toggleSelectAll()` + `id="chk-select-all"` |
| Contador + botón en header | Task 3 — `updateBulkUI()` con `bulk-action-header` |
| Limpiar selección al filtrar/paginar | Task 1 — `selectedIds.clear()` en `applyFilters()` y `goToPage()` |
| Modal con lista de trackings | Task 4 — `openBulkRefundModal()` |
| Campo de crédito si `requiere_nota_credito` | Task 4 — condición `requiereNota` en el modal |
| Campo requerido antes de confirmar | Task 4 — `disabled` + `oninput` en el botón |
| Un número de crédito para todos | Task 5 — mismo `notaCredito` pasado a todos los `Promise.all` |
| `Promise.all` paralelo | Task 5 — `executeBulkRefund()` |
| Toast de éxito/error parcial | Task 5 — contadores `exitosos` / `fallidos` |
| Recarga de tabla al terminar | Task 5 — `loadTrackings()` al final |
| Roles no-CLIENTE sin cambios | Task 2, 3 — guards `_pageUser?.rol === 'CLIENTE'` |
