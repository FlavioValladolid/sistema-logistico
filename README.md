# Sistema Logístico de Inspección

Sistema completo de inspección de calidad y trazabilidad para operaciones logísticas.

## Instalación y arranque

```bash
cd sistema-logistico/backend
npm install
node server.js
```

Puerto configurable vía variable de entorno:

```bash
PORT=3001 node server.js
```

Luego abrir: **http://localhost:3000** (o el puerto configurado)

### Variables de entorno opcionales

Crea un archivo `.env` en `backend/` para habilitar funcionalidades adicionales:

```env
# Puerto del servidor (default: 3000)
PORT=3001

# DigitalOcean Spaces — si no se configuran, las fotos se guardan en /uploads local
SPACES_KEY=tu_access_key
SPACES_SECRET=tu_secret_key
SPACES_BUCKET=nombre-del-bucket
SPACES_REGION=nyc3
SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
SPACES_CDN_URL=https://nombre-del-bucket.nyc3.cdn.digitaloceanspaces.com
```

Si las variables de Spaces no están presentes, el servidor arranca normalmente con almacenamiento local y muestra `⚠ Spaces no configurado, usando almacenamiento local` en consola.

---

## Módulos

### Administración

**Clientes**
- Configuración de Grado de Confianza (G0 / G1 / G2 / G3)
- Tipo de almacenamiento: Por Caja o Por Pallet
- Porcentaje de muestreo (solo G2)
- Módulos opcionales: Calidad y Retrabajos
- UPH (Unidades por Hora) — meta de productividad por operador
- Tipo de mercancía: Textil, Calzado, Traje de baño, Sombreros
- Fotos adicionales requeridas por pieza (solo G3, hasta 4)
- **Información de Paquete (configurable por cliente):**
  - Número de Orden: si está activo, se captura obligatoriamente al iniciar la operación
  - Tipo de Retorno (RMA / RTS): si está activo, se selecciona obligatoriamente al iniciar; si es RTS se requiere razón de retorno
  - Nombre del Destinatario: campo requerido al inicio si está activado
- **SKU no registrado:**
  - `requiere_fotos_sku_nuevo` — si está activo (default), solicita 3 fotografías de evidencia (etiqueta, insumos, pieza) al registrar un número de parte que no existe en catálogo. Puede desactivarse por cliente para flujos más ágiles. No aplica en G0.

**Catálogo de SKUs**
- Registro de productos por cliente
- Campos: SKU, descripción, UPC, país de origen, composición (insumos)

---

### Operación / Inspección

**Flujo de un Tracking:**

1. **Inicio** — Se selecciona cliente, operador, número de tracking y cantidad declarada. El sistema recuerda el último cliente utilizado y lo pre-selecciona automáticamente. Si el cliente tiene configurados campos de información de paquete, se solicitan también:
   - **Número de Orden** (si está activado en el cliente)
   - **Tipo de Retorno**: RMA o RTS (si está activado). Para RTS se requiere ingresar la razón de retorno.
   - **Nombre del Destinatario** (si está activado)
2. **Escaneo de SKUs** — Validación por excepción según grado del cliente:
   - G0: Flujo de recepción masiva — registro por pieza con condición (Buena / Dañada / Sin caja), sin inspección de SKU
   - G1: Solo datos logísticos, sin inspección de producto
   - G2: Inspección estadística (porcentaje configurable, default 30%)
   - G3: Inspección al 100%, validación exhaustiva + fotos adicionales
3. **Cierre** — Se selecciona la Caja o Pallet de destino y se cierra el tracking. El sistema valida que el tipo de caja corresponda al contenido (Good Condition / Damage / Non-brand merchandise)

**Edición post-cierre:**
- El Número de Orden y el Nombre del Destinatario pueden editarse incluso después de cerrar el tracking, desde la pantalla de operación.

**SKUs no registrados en catálogo:**
- El sistema detecta automáticamente si el SKU no existe para ese cliente
- Se solicita: UPC (escaneado), SKU (manual), descripción, país de origen, composición
- Si `requiere_fotos_sku_nuevo` está activo para el cliente: se requieren 3 fotografías obligatorias (etiqueta, insumos/origen, pieza completa); la sección se oculta si está desactivado
- El SKU se guarda automáticamente en el catálogo del cliente

**Validaciones activas:**
- El tracking no puede cerrarse si hay errores sin fotografía de evidencia
- Cualquier discrepancia entre cantidad declarada e inspeccionada genera una alerta automática
- Los productos con error deben marcarse físicamente con etiqueta "Caja de Dañados"
- La caja/pallet de cierre debe corresponder al tipo de contenido del tracking

---

### Captura de Fotos — Sistema Híbrido Web-Móvil

Todas las secciones que requieren fotografía ofrecen dos modos de captura:

**📁 Subir archivo**
Selección directa desde el equipo (o cámara si se accede desde un dispositivo móvil).

**📱 Foto con teléfono (QR)**
1. El operador hace clic en "Generar QR"
2. Aparece un código QR con una sesión de 10 minutos
3. El operador escanea el QR con su teléfono
4. La página móvil abre la cámara del dispositivo directamente
5. El operador toma la foto y la envía
6. La imagen aparece automáticamente en la estación de trabajo (polling cada 2 s)
7. Contador regresivo visible; en rojo cuando quedan menos de 2 minutos
8. Botón "Generar nuevo QR" si la sesión expira antes de recibir la foto

**Multi-foto con un solo QR (G3 y evidencia de SKU nuevo):**
- Un único QR puede recibir múltiples fotos en secuencia (etiqueta → insumos → pieza)
- Cada slot indica al teléfono qué foto tomar a continuación
- Los modos pueden mezclarse entre slots (p. ej. foto 1 desde teléfono, foto 2 desde archivo)

**Secciones que soportan captura QR:**
- Fotografía de evidencia en el modal de registro de errores
- Fotos de evidencia al registrar SKU nuevo (cuando `requiere_fotos_sku_nuevo` está activo)
- Fotos adicionales requeridas por pieza (G3) — cada tarjeta tiene su propio QR independiente

**Almacenamiento de fotos:**
- Con Spaces configurado: las fotos nuevas se suben directamente a DigitalOcean Spaces y se sirven vía CDN
- Sin Spaces: las fotos se guardan localmente en `/uploads/` y se sirven como archivos estáticos
- Las fotos ya existentes en `/uploads/` siempre se siguen sirviendo sin cambios

---

### Errores y Evidencia

Al detectar discrepancias o calidad deficiente se abre el modal de error:

- **Tipo de error:** Calidad, Origen, Insumo, Mercancía ajena, Otro
- **Fotografía de evidencia:** obligatoria (modo archivo o QR)
- **Descripción detallada:** texto libre
- Si el cliente tiene el módulo de Retrabajos activo y el tipo es Calidad u Otro, se muestran los retrabajos disponibles según el tipo de mercancía

**Retrabajos disponibles por tipo de mercancía:**

| Mercancía | Opciones |
|-----------|----------|
| Textil | Cambio de etiqueta, Limpieza, Reparación de costura, Planchado, Re-empaque |
| Calzado | Cambio de caja, Limpieza, Reparación de caja, Impresión de etiqueta |
| Traje de baño | Cambio de etiqueta, Limpieza, Re-empaque, Revisión de elástico |
| Sombreros | Cambio de etiqueta, Limpieza, Reparación de forma, Re-empaque |

---

### Vista de Trackings — Rol CLIENTE

El rol CLIENTE ve la tabla de trackings con funcionalidades específicas:

**Bulk Refund (selección múltiple):**
- Checkboxes en cada fila con estatus `cerrado` — los demás estatus no son seleccionables
- Checkbox "Seleccionar todos" en el header selecciona todos los cerrados de la página actual
- Al seleccionar ≥1 tracking, el header muestra un contador y el botón "Marcar como Refunded"
- Al confirmar, se abre un modal con la lista de trackings seleccionados
- Si el cliente tiene `requiere_nota_credito` activo: campo de número de crédito obligatorio (un solo número se aplica a todos los seleccionados)
- Las llamadas al backend van en paralelo; un toast indica cuántos se procesaron exitosamente
- La selección se limpia automáticamente al filtrar o cambiar de página

---

### Chat de Tracking

Cada tracking tiene un canal de comentarios en tiempo real:

- Comentarios con usuario y timestamp
- Indicador "En vivo" con polling automático
- Botón "Marcar resuelto" / "Reactivar chat"
- Envío de resumen por correo a destinatarios externos (con CC opcional)
- Interfaz completamente internacionalizada (ES / EN)

---

### Cajas y Pallets

- Creación automática al cerrar un tracking (se selecciona la caja destino)
- Tipos: Good Condition, Damage, Non-brand merchandise
- El sistema valida que el tipo de caja coincida con el contenido del tracking
- Historial completo de cajas por cliente con trackings asociados

---

### Retrabajos

- Listado centralizado de piezas pendientes de retrabajo
- Filtros por cliente, tracking y estatus (Pendiente / En proceso / Completado)
- Vinculación con el tracking y SKU de origen
- Foto de evidencia del error asociado
- Actualización de estatus desde la vista de retrabajos

---

### Reportes

**Vista por Caja / Pallet:**
- Listado agrupado por número de caja/pallet (no por tracking)
- Filtros por cliente y rango de fechas
- Selección múltiple con checkbox
- Descarga CSV: Tracking, Box/Pallet, Order Number, Return Type, Return Reason, SKU, QTY, Country of Origin, Materials
- Estatus "Impresa" que se activa automáticamente al descargar el CSV

**Detalle de Caja:**
- Ver todos los trackings asociados a una caja con sus datos de orden y tipo de retorno
- Acceso directo a inspección de cada tracking

**Manifiesto de Tracking:**
- Resumen completo: SKUs, errores con foto, retrabajos, discrepancias
- Muestra número de orden, tipo de retorno y razón RTS cuando aplican

---

### Dashboard

**Estadísticas en tiempo real:**
- Total de trackings (abiertos / cerrados)
- Piezas inspeccionadas
- Errores registrados
- Discrepancias de inventario

**Gráfica de Productividad:**
- Barras: unidades procesadas
- Línea: meta UPH × número de operadores activos
- Barra verde = meta alcanzada; barra cyan = por debajo de meta
- Tooltip con % de eficiencia
- Filtros: Hoy / Semana / Mes, por cliente, por operador
- Agregación dinámica según filtro temporal:
  - **Hoy** → agrupado por hora (00:00–23:00)
  - **Semana / Mes** → agrupado por día (DD/MM)
- Cuando se filtra por operador específico, la meta es UPH × 1 (individual)

**Ranking de operadores:**
- Top 10 por total de piezas inspeccionadas en el período seleccionado

---

## Grados de Confianza

| Grado | Nombre | Inspección |
|-------|--------|------------|
| G0 | Recepción Masiva | Registro pieza por pieza con condición, sin validación de SKU |
| G1 | Flujo Rápido | Solo datos logísticos, sin validación de producto |
| G2 | Muestreo Estadístico | Porcentaje configurable (default 30%) |
| G3 | Control Total | 100% de piezas, validación exhaustiva + fotos adicionales |

Para G1, si no se captura país de origen ni composición durante la inspección, el sistema los completa automáticamente desde el catálogo de SKUs.

---

## Internacionalización (i18n)

La interfaz soporta español e inglés. El idioma se selecciona desde el menú de usuario. Todas las etiquetas, placeholders, mensajes de error y textos de botones están externalizados en `frontend/js/i18n.js`.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Base de datos | SQLite via better-sqlite3 (persistido en `database.bin`) |
| Frontend | HTML / CSS / JavaScript vanilla |
| Tipografía | Inter (UI) + IBM Plex Mono (datos) |
| Gráficas | Chart.js 4 |
| Fotos | Multer → DigitalOcean Spaces (S3-compatible) con fallback a `/uploads` local |
| QR | QRCodeJS (CDN) |
| i18n | Sistema propio en `js/i18n.js` (ES / EN) |

---

## Estructura de archivos

```
sistema-logistico/
├── backend/
│   ├── server.js         # API REST + lógica de negocio + página móvil QR
│   ├── database.bin      # Base de datos SQLite (se crea automáticamente)
│   └── node_modules/
├── frontend/
│   ├── index.html        # Dashboard + gráfica de productividad
│   ├── clientes.html     # Administración de clientes
│   ├── skus.html         # Catálogo de SKUs
│   ├── trackings.html    # Lista y filtrado de trackings
│   ├── operacion.html    # Módulo de inspección (con captura QR)
│   ├── reportes.html     # Reportes por caja/pallet y manifiestos
│   ├── retrabajos.html   # Gestión de retrabajos
│   ├── css/main.css      # Estilos globales (dark/light mode)
│   └── js/
│       ├── app.js        # API client + utilidades compartidas
│       ├── i18n.js       # Traducciones ES/EN
│       └── shell.js      # Layout y navegación compartida
└── uploads/              # Fotografías de evidencia
```

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/foto-sesion` | Crea sesión QR de 10 min, devuelve token + URL |
| GET | `/api/foto-sesion/:token` | Consulta estatus de sesión (polling) |
| POST | `/api/foto-sesion/:token/upload` | Recibe foto desde móvil (uso único) |
| GET | `/foto/:token` | Página móvil standalone para captura de foto |
| GET | `/api/trackings` | Lista todos los trackings |
| POST | `/api/trackings` | Crea nuevo tracking |
| POST | `/api/trackings/:id/cerrar` | Cierra tracking con validaciones |
| POST | `/api/trackings/:id/errores` | Registra error con foto (multipart) |
| POST | `/api/trackings/:id/errores-url` | Registra error con foto ya subida (QR) |
| POST | `/api/detalles/:id/fotos-evidencia` | Sube fotos de evidencia SKU nuevo (multipart) |
| POST | `/api/detalles/:id/fotos-evidencia-url` | Guarda fotos evidencia SKU nuevo por URL (QR) |
| POST | `/api/detalles/:id/fotos-adicionales` | Sube fotos adicionales G3 (multipart) |
| POST | `/api/detalles/:id/fotos-adicionales-url` | Guarda fotos adicionales G3 por URL (QR) |
| PUT | `/api/trackings/:id/refunded` | Marca tracking como refunded (requiere estatus `cerrado`) |
| PUT | `/api/trackings/:id/nota-credito` | Guarda número de nota de crédito en un tracking |
| GET | `/api/clientes` | Lista clientes con toda su configuración |
| POST | `/api/clientes` | Crea cliente |
| PUT | `/api/clientes/:id` | Actualiza cliente |
| GET | `/api/spaces/test` | (Solo ADMIN) Verifica conectividad con DigitalOcean Spaces |
