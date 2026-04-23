# webapp_back_pe — Backend SIVEP

API proxy en Node.js + TypeScript + Express que media entre la aplicación web de SIVEP y el sistema SISDEP (`medellin.gov.co/sisdep`). Valida autenticación, normaliza respuestas y sirve imágenes del dominio oficial vía un proxy con allowlist.

## Requisitos

- Node.js 20.x (probado con 20.19.5)
- npm

## Setup local

```bash
git clone <url-del-repo>
cd sivep-back

# 1. Instalar dependencias
npm install

# 2. Crear el archivo de entorno local a partir de la plantilla
cp .env.example .env.development.local

# 3. Ajustar valores en .env.development.local si hace falta
#    (los valores por defecto sirven para arrancar contra el entorno de pruebas)

# 4. Arrancar el servidor
npm start
```

El servidor queda disponible en **`https://localhost:5001`** (HTTPS con certificado autofirmado — el navegador mostrará una advertencia, es normal en desarrollo).

## Variables de entorno

Ver `.env.example` para la plantilla completa. Variables relevantes:

| Variable            | Descripción                                                   | Default en código                                     |
|---------------------|---------------------------------------------------------------|--------------------------------------------------------|
| `NODE_ENV`          | `development` o `production`.                                | `development`                                          |
| `PORT`              | Puerto HTTP. En desarrollo siempre escucha en 5001.          | 8080 (prod) / 5001 (dev, fijo)                         |
| `SSL_KEY_PATH`      | Ruta a la llave privada del cert SSL (solo desarrollo).      | —                                                      |
| `SSL_CERT_PATH`     | Ruta al certificado SSL (solo desarrollo).                   | —                                                      |
| `ALLOWED_ORIGINS`   | Lista de orígenes permitidos por CORS, separados por coma.   | `[]` (niega todo salvo peticiones sin Origin)          |
| `SISDEP_BASE_URL`   | Base del API SISDEP, sin slash final.                        | `https://www.medellin.gov.co/sisdep/back`              |

### Convención de archivos `.env`

- **`.env.example`** (commiteado): plantilla de referencia con los nombres de variables.
- **`.env.development.local`** (ignorado por git): copia local de cada desarrollador con sus valores.
- Nunca commitear archivos con credenciales reales.

## Endpoints

Una vez corriendo, `GET https://localhost:5001/` devuelve la lista de endpoints:

| Método | Ruta                                | Auth (`x-access`) | Descripción                                               |
|--------|-------------------------------------|-------------------|-----------------------------------------------------------|
| GET    | `/`                                 | No                | Listado de endpoints disponibles.                         |
| POST   | `/login`                            | No                | Autentica contra SISDEP. Body: `{ username, password }`. |
| GET    | `/ventero-completo/:id`             | **Sí**            | Datos combinados de ventero + persona.                    |
| GET    | `/api/proxy-image?url=...`          | **Sí**            | Proxy de imágenes del dominio `medellin.gov.co`.          |

### Smoke test

```bash
# Login contra el entorno de pruebas (credenciales: admin / prueba123)
curl -sk -X POST https://localhost:5001/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"prueba123"}'

# Obtener ventero (reemplazar TOKEN con el valor de `token` devuelto arriba)
curl -sk https://localhost:5001/ventero-completo/1 -H "x-access: TOKEN"
```

## Scripts npm

| Script        | Acción                                                    |
|---------------|-----------------------------------------------------------|
| `npm start`   | Compila (`tsc`) y ejecuta `node dist/app.js`.             |
| `npm run build` | Solo compila TypeScript → `dist/`.                      |
| `npm run dev` | Ejecuta `src/app.ts` directamente con `ts-node` (ESM).    |

## Estructura

```
src/
  app.ts                # servidor Express, rutas y proxy a SISDEP
  controllers/          # (reservado)
  routes/               # (reservado)
  views/                # (reservado)
certs/                  # certificados SSL para desarrollo
dist/                   # salida compilada (generada por tsc)
docs/                   # bitácoras e informes
```
