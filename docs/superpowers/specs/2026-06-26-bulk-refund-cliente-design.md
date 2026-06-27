# Bulk Refund con Número de Crédito — Vista Cliente

**Fecha:** 2026-06-26
**Archivo afectado:** `frontend/trackings.html`
**Endpoints existentes reutilizados:**
- `PUT /api/trackings/:id/refunded`
- `PUT /api/trackings/:id/nota-credito`

---

## Contexto

La vista de trackings (`trackings.html`) permite al rol `CLIENTE` ver sus trackings pero actualmente no tiene acción de refund. El backend ya soporta marcar un tracking como refunded y guardar un número de nota de crédito, pero solo uno a la vez. Esta feature añade selección múltiple y acción en lote exclusiva para el rol `CLIENTE`.

---

## Alcance

- Solo rol `CLIENTE` ve y usa los checkboxes.
- Solo trackings con `estatus === 'cerrado'` son seleccionables (filas con otro estatus no tienen checkbox).
- El número de crédito es **uno para todos** los trackings seleccionados en el lote.
- Si el cliente tiene `requiere_nota_credito === 1`, el campo es obligatorio antes de confirmar.

---

## UI: Tabla y checkboxes

- Primera columna nueva en la tabla, solo visible para `CLIENTE`.
- Checkbox por fila en trackings `cerrado`; filas con otro estatus no tienen checkbox.
- En el `<thead>`, misma columna: checkbox "seleccionar todos los cerrados visibles en la página actual".
- En la fila del header, a la derecha del checkbox: contador `N seleccionados` y botón `Marcar como Refunded`, visibles únicamente cuando hay ≥1 tracking seleccionado.
- Al cambiar de página o aplicar filtros, la selección se limpia.

---

## UI: Modal de confirmación

Se abre al hacer clic en "Marcar como Refunded".

Contenido:
1. Título: `Marcar como Refunded`
2. Texto: `Vas a marcar N tracking(s) como refunded`
3. Lista scrollable de tracking numbers seleccionados
4. Campo `Número de crédito` (solo si `requiere_nota_credito === 1`): texto requerido, validado antes de habilitar confirmar
5. Botones: `Cancelar` y `Confirmar`

---

## Flujo de confirmación

1. Si `requiere_nota_credito`, llama `PUT /api/trackings/:id/nota-credito` para cada tracking seleccionado.
2. Llama `PUT /api/trackings/:id/refunded` para cada tracking seleccionado.
3. Todas las llamadas van en `Promise.all` (paralelas).
4. Al terminar: cierra el modal, muestra toast de éxito con cuántos se procesaron.
5. Si alguna llamada falla (ej. ya estaba refunded), se contabiliza el error y se muestra toast indicando cuántos fallaron, sin bloquear los exitosos.
6. Recarga la tabla.

---

## Compatibilidad

- Roles `ADMIN`, `SUPERVISOR`, `LOGISTICA`, `OPERADOR`: no ven la columna de checkboxes ni el botón de bulk refund. Sin cambios para ellos.
- El flag `_soloVisibilidad` existente ya distingue `CLIENTE` y `OPERADOR`; la nueva lógica usa `_pageUser?.rol === 'CLIENTE'` directamente para no afectar a `OPERADOR`.
- Las columnas existentes de la tabla no cambian de orden ni de contenido.
