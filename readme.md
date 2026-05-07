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

El servidor queda disponible en **`http://localhost:5001`**.

> **TLS en desarrollo:** el backend corre en HTTP plano. La autenticación viaja
> en el header `x-access` (JWT), no en cookies, así que no hace falta HTTPS
> para trabajar local. En producción, el TLS lo termina un reverse proxy
> (ver sección [Despliegue](#despliegue)).

## Variables de entorno

Ver `.env.example` para la plantilla completa. Variables relevantes:

| Variable            | Descripción                                                   | Default en código                                     |
|---------------------|---------------------------------------------------------------|--------------------------------------------------------|
| `NODE_ENV`          | `development` o `production`.                                | `development`                                          |
| `PORT`              | Puerto HTTP. En desarrollo siempre escucha en 5001.          | 8080 (prod) / 5001 (dev, fijo)                         |
| `ALLOWED_ORIGINS`   | Lista de orígenes permitidos por CORS, separados por coma.   | `[]` (niega todo salvo peticiones sin Origin)          |
| `SISDEP_BASE_URL`   | Base del API SISDEP, sin slash final.                        | `https://www.medellin.gov.co/sisdep/back`              |

### Convención de archivos `.env`

- **`.env.example`** (commiteado): plantilla de referencia con los nombres de variables.
- **`.env.development.local`** (ignorado por git): copia local de cada desarrollador con sus valores.
- Nunca commitear archivos con credenciales reales.

## Endpoints

Una vez corriendo, `GET http://localhost:5001/` devuelve la lista de endpoints:

| Método | Ruta                                | Auth (`x-access`) | Descripción                                               |
|--------|-------------------------------------|-------------------|-----------------------------------------------------------|
| GET    | `/`                                 | No                | Listado de endpoints disponibles.                         |
| POST   | `/login`                            | No                | Autentica contra SISDEP. Body: `{ username, password }`. |
| GET    | `/ventero-completo/:id`             | **Sí**            | Datos combinados de ventero + persona.                    |
| GET    | `/api/proxy-image?url=...`          | **Sí**            | Proxy de imágenes del dominio `medellin.gov.co`.          |

### Smoke test

```bash
# Login contra el entorno de pruebas (credenciales: admin / prueba123)
curl -s -X POST http://localhost:5001/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"prueba123"}'

# Obtener ventero (reemplazar TOKEN con el valor de `token` devuelto arriba)
curl -s http://localhost:5001/ventero-completo/1 -H "x-access: TOKEN"
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
dist/                   # salida compilada (generada por tsc, ignorada por git)
docs/                   # bitácoras e informes
```

## Despliegue

El backend corre **HTTP plano** también en producción. El TLS se termina en un
reverse proxy (nginx, Traefik, ALB de AWS, Cloud Run, etc.). Esto mantiene el
código del servidor igual en todos los entornos y centraliza la gestión de
certificados en una capa dedicada que sabe renovarlos (Let's Encrypt, ACM…).

### Ejemplo mínimo con nginx

Asumiendo que el backend escucha en el puerto `8080` dentro de la red interna
y el dominio público es `api.sivep.example`:

```nginx
# /etc/nginx/sites-available/sivep-backend.conf

# Redirección HTTP → HTTPS
server {
    listen 80;
    server_name api.sivep.example;
    return 301 https://$host$request_uri;
}

# Terminación TLS y proxy al backend
server {
    listen 443 ssl http2;
    server_name api.sivep.example;

    ssl_certificate     /etc/letsencrypt/live/api.sivep.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.sivep.example/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    client_max_body_size 12M;   # coincide con el limit de express.json (10M)

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }
}
```

Notas operativas:

- Si el backend se va a leer `X-Forwarded-For` para logs o rate-limiting,
  activar `app.set('trust proxy', 1)` en Express.
- Obtener y renovar el certificado con Certbot:
  `sudo certbot --nginx -d api.sivep.example`.
- Si se despliega en contenedor (Docker), exponer solo el puerto interno a la
  red del proxy — no publicarlo al host.
