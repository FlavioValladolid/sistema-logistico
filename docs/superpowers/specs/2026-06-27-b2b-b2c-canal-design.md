# Canal B2B/B2C con Clientes Retail — Design Spec

**Fecha:** 2026-06-27

---

## Contexto

Los clientes del sistema pueden operar en canal B2C (directo al consumidor) o B2B (a retailers como Walmart, Costco, Liverpool). Cuando un cliente es B2B, cada tracking debe registrar para qué retailer específico se procesa. La lista de retailers es configurable por cliente en su perfil.

---

## Alcance

- Nueva configuración en el perfil de cliente: tipo de canal (B2B / B2C) y lista de retailers (solo B2B)
- Al iniciar un tracking con cliente B2B: selección obligatoria del retailer
- El retailer seleccionado aparece en la tabla de trackings y en reportes/CSV
- Storage: dos columnas nuevas en `clientes` + una columna nueva en `trackings`

---

## Base de datos

### Columnas nuevas en `clientes`

```sql
ALTER TABLE clientes ADD COLUMN tipo_canal TEXT DEFAULT NULL;
ALTER TABLE clientes ADD COLUMN clientes_retail TEXT DEFAULT NULL;
```

- `tipo_canal`: valores `'B2B'`, `'B2C'` o `NULL` (sin configurar)
- `clientes_retail`: JSON array de strings, ej: `'["Walmart","Costco","Liverpool"]'`. Solo relevante cuando `tipo_canal = 'B2B'`

### Columna nueva en `trackings`

```sql
ALTER TABLE trackings ADD COLUMN retailer TEXT DEFAULT NULL;
```

- Nombre del retailer seleccionado al crear el tracking
- `NULL` para clientes B2C o trackings sin retailer

Migraciones via `ALTER TABLE … ADD COLUMN` con try/catch en `initDB()`, igual que el resto de columnas opcionales del sistema.

---

## Backend (`backend/server.js`)

### `POST /api/clientes` y `PUT /api/clientes/:id`

- Aceptar `tipo_canal` (string) y `clientes_retail` (string JSON) del body
- Incluirlos en el INSERT y UPDATE

### `GET /api/clientes`

- Las nuevas columnas aparecen automáticamente (SELECT *)

### Query de `GET /api/trackings`

- Agregar `t.retailer` y `c.tipo_canal` al SELECT del JOIN existente
- `retailer` viene de `trackings`; `tipo_canal` de `clientes`

### `POST /api/trackings`

- Aceptar `retailer` del body y guardarlo en el INSERT

---

## Frontend — `clientes.html`

### Nueva sección "Canal de Venta"

Ubicación: después de la sección "Información de Paquete" en el modal de cliente.

**Selector de canal:** dos botones tipo tarjeta (mismo estilo que el selector Caja/Pallet existente):
- `B2C` — Directo al consumidor
- `B2B` — Clientes Retail

**Sub-apartado "Clientes Retail"** (visible solo cuando B2B está seleccionado):
- Lista de retailers actuales como chips/tags con botón ✕ para eliminar
- Input de texto + botón "Agregar" para añadir retailer
- Enter en el input también agrega
- No se permiten nombres duplicados (case-insensitive) ni strings vacíos
- Al cambiar a B2C, el sub-apartado se oculta; los retailers en memoria se descartan al guardar

**Al guardar:**
- `tipo_canal`: `'B2B'` o `'B2C'` según selección (o `null` si ninguno está seleccionado)
- `clientes_retail`: `JSON.stringify(array)` si B2B con retailers, `null` si B2C

**En la tabla de clientes:** badge `B2B` o `B2C` en la columna de configuración del cliente.

**Al cargar cliente para editar:** restaurar selección de canal y lista de retailers desde los datos del API.

---

## Frontend — `operacion.html`

### Data attributes en el `<select>` de clientes

Agregar al `<option>` de cada cliente:
```html
data-canal="${c.tipo_canal || ''}"
data-retail='${c.clientes_retail || "[]"}'
```

### Campo "Cliente Retail" en el formulario de inicio

- Aparece al seleccionar un cliente con `tipo_canal === 'B2B'`
- `<select>` con los retailers del cliente (parseados desde `data-retail`)
- Primera opción: `— Seleccionar retailer —` (valor vacío)
- Campo **obligatorio**: el tracking no puede iniciarse sin seleccionar un retailer cuando el cliente es B2B
- Al cambiar a cliente B2C o sin canal: el campo desaparece
- El retailer seleccionado se envía en `POST /api/trackings` como campo `retailer`

---

## Frontend — `trackings.html`

### Nueva columna "Retailer"

- Insertar entre "Destinatario" y "Piezas declaradas"
- Muestra `tr.retailer` si existe, o `—` si null
- Incluir `tr.retailer` en `matchQ` del buscador

---

## Frontend — Reportes

### Manifiesto de tracking (`reportes.html`)

- Si `retailer` tiene valor, mostrarlo en el encabezado del manifiesto junto a Número de Orden y Tipo de Retorno

### CSV de cajas/pallets

- Agregar columna `Retailer` después de `Return Reason` y antes de `SKU`
- Celda vacía si el tracking no tiene retailer

---

## Compatibilidad

- Clientes sin `tipo_canal` configurado (NULL): se comportan igual que antes, sin campo retailer en operación
- Trackings existentes: `retailer` es NULL, se muestran como `—` en la tabla
- No hay cambio en el flujo de clientes B2C o sin canal configurado
