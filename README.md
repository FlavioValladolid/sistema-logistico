# 📦 Sistema Logístico de Inspección v1.0

Sistema completo de inspección de calidad y trazabilidad para operaciones logísticas.

## 🚀 Instalación y arranque

```bash
cd sistema-logistico
cd backend
npm install
node server.js
```

Luego abrir: **http://localhost:3000**

## 📋 Módulos incluidos

### Administración
- **Clientes** — Configuración de Grados de Confianza (G1/G2/G3) y módulos
- **Catálogo SKUs** — Registro de productos con país de origen e insumos

### Operación
- **Dashboard** — Estadísticas en tiempo real
- **Trackings** — Lista y filtrado de todos los envíos
- **Operación / Inspección** — Flujo completo de inspección:
  - Fase 1: Inicio del Tracking (cliente, número de caja, cantidad declarada)
  - Fase 2: Escaneo de SKUs con validación por excepción
  - Fase 3: Cierre y generación de manifiesto

### Reportes
- **Manifiestos** — Documento completo de auditoría con evidencias fotográficas
- **Impresión/PDF** — Soporte nativo de impresión

## 🔐 Grados de Confianza

| Grado | Nombre | Descripción |
|-------|--------|-------------|
| G1 | Flujo Rápido | Solo datos logísticos |
| G2 | Muestreo | Inspección estadística (default 30%) |
| G3 | Control Total | 100% de piezas obligatorio |

## ⚠ Reglas del Sistema

- El tracking **no puede cerrarse** si hay errores sin fotografía de evidencia
- Ante cualquier discrepancia se genera una **alerta de inventario** automática
- Los productos con error deben marcarse físicamente con **"Caja de Dañados"**
- El número de caja se **hereda automáticamente** a todos los SKUs de la sesión

## 🗃 Estructura de archivos

```
sistema-logistico/
├── backend/
│   ├── server.js       # API REST + SQLite
│   ├── database.bin    # Base de datos (se crea automáticamente)
│   └── node_modules/
├── frontend/
│   ├── index.html      # Dashboard
│   ├── clientes.html   # Administración de clientes
│   ├── skus.html       # Catálogo de SKUs
│   ├── trackings.html  # Lista de trackings
│   ├── operacion.html  # Módulo de inspección
│   ├── reportes.html   # Reportes y manifiestos
│   ├── css/main.css    # Estilos globales
│   └── js/
│       ├── app.js      # API client + utilities
│       └── shell.js    # Layout compartido
└── uploads/            # Fotografías de evidencia
```
