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
3. **Cierre** — Se captura el número de Caja o Pallet y se cierra el tracking

**SKUs no registrados en catálogo:**
- El sistema detecta automáticamente si el SKU no existe para ese cliente
- Se solicita: UPC (escaneado), SKU (manual), descripción, país de origen, composición
- Se requieren 3 fotografías obligatorias: etiqueta del producto, insumos/país de origen, pieza completa
- El SKU se guarda automáticamente en el catálogo del cliente

**Validaciones activas:**
- El tracking no puede cerrarse si hay errores sin fotografía de evidencia
- Cualquier discrepancia entre cantidad declarada e inspeccionada genera una alerta automática
- Los productos con error deben marcarse físicamente con etiqueta "Caja de Dañados"

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
- Acceso directo a corrección de cada tracking

**Manifiesto de Tracking:**
- Muestra número de orden, tipo de retorno y razón RTS cuando aplican

---

### Dashboard

**Estadísticas en tiempo real:**
- Total de trackings (abiertos / cerrados)
- Piezas inspeccionadas
- Errores registrados
- Discrepancias de inventario

**Gráfica Hora por Hora (Productividad):**
- Barras: unidades procesadas por hora
- Línea: meta UPH × número de operadores activos en esa hora
- Barra verde = meta alcanzada o superada; barra cyan = por debajo de meta
- Tooltip con % de eficiencia por hora
- Filtros: Hoy / Semana / Mes, por cliente, por operador
- Cuando se filtra por operador específico, la meta es UPH × 1 (individual)
- Horas en zona horaria local del servidor

---

## Grados de Confianza

| Grado | Nombre | Inspección |
|-------|--------|------------|
| G1 | Flujo Rápido | Solo datos logísticos, sin validación de producto |
| G2 | Muestreo Estadístico | Porcentaje configurable (default 30%) |
| G3 | Control Total | 100% de piezas, validación exhaustiva |

Para G1, si no se captura país de origen ni composición durante la inspección, el sistema los completa automáticamente desde el catálogo de SKUs.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Base de datos | SQLite via sql.js (persistido en `database.bin`) |
| Frontend | HTML / CSS / JavaScript vanilla |
| Gráficas | Chart.js 4 |
| Fotos | Multer (almacenadas en `/uploads`) |

---

## Estructura de archivos

```
sistema-logistico/
├── backend/
│   ├── server.js         # API REST + lógica de negocio
│   ├── database.bin      # Base de datos SQLite (se crea automáticamente)
│   └── node_modules/
├── frontend/
│   ├── index.html        # Dashboard + gráfica hora por hora
│   ├── clientes.html     # Administración de clientes
│   ├── skus.html         # Catálogo de SKUs
│   ├── trackings.html    # Lista y filtrado de trackings
│   ├── operacion.html    # Módulo de inspección
│   ├── reportes.html     # Reportes por caja/pallet y manifiestos
│   ├── css/main.css      # Estilos globales
│   └── js/
│       ├── app.js        # API client + utilidades compartidas
│       └── shell.js      # Layout y navegación compartida
└── uploads/              # Fotografías de evidencia
```
