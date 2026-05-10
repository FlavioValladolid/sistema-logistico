# Sistema Logístico de Inspección

Sistema completo de inspección de calidad y trazabilidad para operaciones logísticas.

## Instalación y arranque

```bash
cd sistema-logistico/backend
npm install
node server.js
```

Luego abrir: **http://localhost:3000**

---

## Módulos

### Administración

**Clientes**
- Configuración de Grado de Confianza (G1 / G2 / G3)
- Tipo de almacenamiento: Por Caja o Por Pallet
- Porcentaje de muestreo (solo G2)
- Módulos opcionales: Calidad y Retrabajos
- UPH (Unidades por Hora) — meta de productividad por operador
- Tipo de mercancía: Textil, Calzado, Traje de baño, Sombreros
- Fotos adicionales requeridas por pieza (solo G3, hasta 4)
- **Información de Paquete (configurable por cliente):**
  - Número de Orden: si está activo, se captura obligatoriamente al iniciar la operación
  - Tipo de Retorno (RMA / RTS): si está activo, se selecciona obligatoriamente al iniciar; si es RTS se requiere razón de retorno

**Catálogo de SKUs**
- Registro de productos por cliente
- Campos: SKU, descripción, UPC, país de origen, composición (insumos)

---

### Operación / Inspección

**Flujo de un Tracking:**

1. **Inicio** — Se selecciona cliente, operador, número de tracking y cantidad declarada. Si el cliente tiene configurados campos de información de paquete, se solicitan también:
   - **Número de Orden** (si está activado en el cliente)
   - **Tipo de Retorno**: RMA o RTS (si está activado). Para RTS se requiere ingresar la razón de retorno.
2. **Escaneo de SKUs** — Validación por excepción según grado del cliente:
   - G1: Solo datos logísticos, sin inspección de producto
   - G2: Inspección estadística (porcentaje configurable, default 30%)
   - G3: Inspección al 100%, validación exhaustiva
3. **Cierre** — Se selecciona la Caja o Pallet de destino y se cierra el tracking. El sistema valida que el tipo de caja corresponda al contenido (Good Condition / Damage / Non-brand merchandise)

**SKUs no registrados en catálogo:**
- El sistema detecta automáticamente si el SKU no existe para ese cliente
- Se solicita: UPC (escaneado), SKU (manual), descripción, país de origen, composición
- Se requieren 3 fotografías obligatorias: etiqueta del producto, insumos/país de origen, pieza completa
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

**Secciones que soportan captura QR:**
- Fotografía de evidencia en el modal de registro de errores
- Fotos adicionales requeridas por pieza (G3) — cada tarjeta tiene su propio QR independiente; los modos pueden mezclarse (p. ej. foto 1 y 3 desde teléfono, foto 2 desde archivo)

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
| G1 | Flujo Rápido | Solo datos logísticos, sin validación de producto |
| G2 | Muestreo Estadístico | Porcentaje configurable (default 30%) |
| G3 | Control Total | 100% de piezas, validación exhaustiva + fotos adicionales |

Para G1, si no se captura país de origen ni composición durante la inspección, el sistema los completa automáticamente desde el catálogo de SKUs.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Base de datos | SQLite via sql.js (persistido en `database.bin`) |
| Frontend | HTML / CSS / JavaScript vanilla |
| Tipografía | Inter (UI) + IBM Plex Mono (datos) |
| Gráficas | Chart.js 4 |
| Fotos | Multer (almacenadas en `/uploads`) |
| QR | QRCodeJS (CDN) |

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
| POST | `/api/detalles/:id/fotos-adicionales` | Sube fotos adicionales G3 (multipart) |
| POST | `/api/detalles/:id/fotos-adicionales-url` | Guarda fotos adicionales G3 por URL (QR) |
