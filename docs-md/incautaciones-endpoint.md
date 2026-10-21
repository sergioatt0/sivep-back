# Dominio `incautaciones` (reconocimiento + acta de inventario)

Proxy autenticado a los endpoints de incautaciones de SISDEP. SIVEP reenvía la respuesta del upstream tal cual al frontend, sin envolverla en `{ success, data }`. El cliente consume la misma estructura que SISDEP devuelve.

Implementación: `src/app.ts` (bloque "Operativa — Incautaciones"). Entradas del índice: `GET /`.

## Resumen

| Atributo            | Valor                                                              |
|---------------------|--------------------------------------------------------------------|
| Métodos             | `GET`, `POST`, `PATCH`, `DELETE`                                   |
| Prefijo backend     | `/operativa/reconocimientoIncautacion` y `/operativa/actaInventario`|
| Upstream SISDEP     | `${SISDEP_BASE_URL}/api/operativa/...`                             |
| Autenticación       | Header `x-access: <jwt>` en todas las rutas (obligatorio)          |
| Validación de `id`  | Debe ser numérico (regex `^\d+$`)                                  |
| Timeout upstream    | 15 s en JSON; 60 s en alta y edición de acta                       |
| Tamaño máximo       | 50 MB por request en alta y edición de acta                        |
| CORS                | Sujeto a `ALLOWED_ORIGINS`                                         |

## Relación reconocimiento ↔ acta

Un reconocimiento de incautación tiene cero o un acta de inventario. El enlace es el campo `idReconocimientoIncautacion` del acta.

```
reconocimientoIncautacion (1)  --  0..1  actaInventario
        id                      <--     idReconocimientoIncautacion (único)
```

- La columna `id_reconocimiento_incautacion` es `unique` en la base de datos de SISDEP. Un reconocimiento no puede tener dos actas.
- `idReconocimientoIncautacion` acepta `null`. Un acta puede existir sin reconocimiento.
- La clave foránea no declara `ON DELETE`. SISDEP usa la acción por defecto de Postgres. Ver "Pendientes".

## Rutas

### Reconocimiento de incautación

| Método | Ruta SIVEP                                     | Ruta SISDEP                                          | Parámetros / body                      |
|--------|------------------------------------------------|------------------------------------------------------|----------------------------------------|
| GET    | `/operativa/reconocimientoIncautacion`          | `/api/operativa/reconocimientoIncautacion`           | Query libre, se reenvía a SISDEP.      |
| GET    | `/operativa/reconocimientoIncautacion/paginated`| `/api/operativa/reconocimientoIncautacion/paginated` | Query libre (`page`, `size`, filtros). |
| GET    | `/operativa/reconocimientoIncautacion/:id`      | `/api/operativa/reconocimientoIncautacion/{id}`      | `id` numérico.                         |
| POST   | `/operativa/reconocimientoIncautacion`          | `/api/operativa/reconocimientoIncautacion`           | JSON del reconocimiento.               |
| PATCH  | `/operativa/reconocimientoIncautacion/:id`      | `/api/operativa/reconocimientoIncautacion/{id}`      | `id` numérico + JSON.                  |
| DELETE | `/operativa/reconocimientoIncautacion/:id`      | `/api/operativa/reconocimientoIncautacion/{id}`      | `id` numérico.                         |

### Acta de inventario

| Método | Ruta SIVEP                          | Ruta SISDEP                               | Parámetros / body                            |
|--------|-------------------------------------|-------------------------------------------|----------------------------------------------|
| GET    | `/operativa/actaInventario`         | `/api/operativa/actaInventario`           | Query libre, se reenvía a SISDEP.            |
| GET    | `/operativa/actaInventario/paginated`| `/api/operativa/actaInventario/paginated`| Query libre (`page`, `size`, filtros).       |
| GET    | `/operativa/actaInventario/stream`  | `/api/operativa/actaInventario/stream`    | Query libre. Ver nota de orden de rutas.     |
| GET    | `/operativa/actaInventario/:id`     | `/api/operativa/actaInventario/{id}`      | `id` numérico.                               |
| POST   | `/operativa/actaInventario`         | `/api/operativa/actaInventario`           | `multipart/form-data`: parte `info` + archivo opcional. |
| PATCH  | `/operativa/actaInventario/:id`     | `/api/operativa/actaInventario/{id}`      | `id` numérico + multipart igual al alta.     |
| DELETE | `/operativa/actaInventario/:id`     | `/api/operativa/actaInventario/{id}`      | `id` numérico.                               |

`GET` sobre las rutas de lista reenvía `req.query` sin cambios. `GET /:id` no envía query al upstream.

## Campos

### `ReconocimientoIncautacion`

| Campo                   | Tipo   | Obligatorio | Descripción                                  |
|-------------------------|--------|-------------|----------------------------------------------|
| `id`                    | long   | no (generado)| Identificador.                              |
| `elementosIncautados`   | texto  | no          | Elementos incautados, texto libre.           |
| `senalesReconocimiento` | texto  | no          | Señales particulares del reconocimiento.     |
| `idUsuarioDiligencia`   | long   | **sí**      | Usuario que realizó la diligencia.           |
| `idPersona`             | long   | no          | Persona asociada.                            |

### Acta de inventario

| Campo                        | Tipo    | Obligatorio | Descripción                                          |
|------------------------------|---------|-------------|------------------------------------------------------|
| `id`                         | long    | no (generado)| Identificador.                                      |
| `serialActa`                 | texto   | **sí**      | Serial del acta. Único en la base de datos.          |
| `nombrePolicia`              | texto   | **sí**      | Nombre del policía.                                  |
| `placaPolicia`               | texto   | **sí**      | Placa del policía.                                   |
| `pdfActa`                    | texto   | no          | URL del PDF. La escribe SISDEP al guardar el archivo.|
| `esNn`                       | boolean | **sí**      | Indica si el acta es NN.                             |
| `idDireccionIncautacion`     | long    | no          | Dirección donde ocurrió la incautación.              |
| `idFuncionarioAcompana`      | long    | **sí**      | Funcionario que acompaña.                            |
| `fecha`                      | fecha   | **sí**      | Fecha del acta.                                      |
| `descripcion`                | texto   | no          | Descripción libre.                                   |
| `idReconocimientoIncautacion`| long    | no          | Enlace al reconocimiento. Único.                     |
| `idTareaOperativa`           | long    | no          | Tarea operativa asociada.                            |
| `idDescongestion`            | long    | no          | Descongestión asociada.                              |
| `idEntrega`                  | long    | no          | Entrega asociada. Única.                             |

Restricción de la base de datos: `idDescongestion` e `idEntrega` no pueden tener valor al mismo tiempo. Los dos en `null` están permitidos.

### Parte `info` del multipart

La parte `info` lleva el JSON del acta. SISDEP lo convierte al modelo y guarda el archivo si viene. Si viene archivo, SISDEP lo escribe en disco y llena `pdfActa` con la URL pública. El cliente no envía `pdfActa` en el alta.

## Autenticación

Todas las rutas exigen el header `x-access` con el JWT de `POST /login`.

| Caso                                    | Respuesta                                                              |
|-----------------------------------------|------------------------------------------------------------------------|
| Falta el header `x-access`              | 401 local, sin llamar a SISDEP.                                        |
| SISDEP responde 401 (token vencido)     | Se copia el código y se agrega `"sesionVencida": true` al body.        |
| SISDEP responde 403 (sin permiso)       | 403 con el mensaje de SISDEP. No lleva `sesionVencida`.                |

El JWT se reenvía a SISDEP en el header `x-access`. En el multipart también se reenvía `content-length`.

## Ejemplos curl

Definir el token antes de los ejemplos:

```bash
TOKEN="<token devuelto por /login>"
```

### Listar reconocimientos paginados

```bash
curl -s "http://localhost:5001/operativa/reconocimientoIncautacion/paginated?page=0&size=20" \
  -H "x-access: $TOKEN" \
  -H 'Accept: application/json'
```

### Crear un reconocimiento

```bash
curl -s -X POST "http://localhost:5001/operativa/reconocimientoIncautacion" \
  -H "x-access: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "elementosIncautados": "Tres bolsas con mercancía sin registro sanitario",
    "senalesReconocimiento": "Caja metálica azul con candado",
    "idUsuarioDiligencia": 12,
    "idPersona": 345
  }'
```

### Crear un acta de inventario con archivo

```bash
curl -s -X POST "http://localhost:5001/operativa/actaInventario" \
  -H "x-access: $TOKEN" \
  -F 'info={"serialActa":"ACTA-2026-0001","nombrePolicia":"JUAN PEREZ","placaPolicia":"12345","esNn":false,"idFuncionarioAcompana":12,"fecha":"2026-01-15T09:30:00","idReconocimientoIncautacion":77}' \
  -F 'archivo=@acta.pdf'
```

No enviar `Content-Type: application/json` en esta ruta. El proxy rechaza el request si el `Content-Type` no empieza por `multipart/form-data`.

### Editar el acta y reemplazar el PDF

```bash
curl -s -X PATCH "http://localhost:5001/operativa/actaInventario/45" \
  -H "x-access: $TOKEN" \
  -F 'info={"serialActa":"ACTA-2026-0001","nombrePolicia":"JUAN PEREZ","placaPolicia":"12345","esNn":false,"idFuncionarioAcompana":12,"fecha":"2026-01-15T09:30:00","idReconocimientoIncautacion":77}' \
  -F 'archivo=@acta-corregida.pdf'
```

### Descargar el PDF del acta

SIVEP no tiene un endpoint de descarga de PDF. `pdfActa` ya es una URL pública de SISDEP. Se lee en el detalle y se descarga directa:

```bash
# 1. Leer el detalle y extraer la URL del PDF
curl -s "http://localhost:5001/operativa/actaInventario/45" \
  -H "x-access: $TOKEN" \
  -H 'Accept: application/json' \
  | grep -o 'https[^"]*acta-inventario[^"]*'

# 2. Descargar el archivo con la URL del paso 1
curl -s -o acta-45.pdf "<url devuelta en el paso 1>"
```

`/api/proxy-image` no sirve para esto. Ese proxy exige que el recurso sea `image/*` y rechaza el PDF con 400.

## Respuestas

La forma de cada respuesta la define SISDEP. SIVEP no la modifica.

| Ruta                | Forma del body (SISDEP)                                                     |
|---------------------|-----------------------------------------------------------------------------|
| `GET .../paginated` | Objeto de página (`Page` de Ebean).                                         |
| `GET .../stream`    | Igual que la lista. SIVEP no reenvía el stream: espera la respuesta completa y responde con `.json()`. |
| `GET` (lista)       | `{ "entities": { "<entidad>": { "<id>": { ...campos } } } }`                 |
| `GET /:id`          | `{ "entities": { "<entidad>": { "<id>": { ...campos } } } }`                 |
| `POST`              | `{ "entities": { "<entidad>": { "<id>": { ...campos } } } }`                 |
| `PATCH`             | `{ "entities": { "<entidad>": { "<id>": { ...campos } } } }`                 |
| `DELETE`            | `{ "id": <id> }` con código 202. Si SISDEP no devuelve body, SIVEP responde `{ "success": true }`. |

`<entidad>` es `reconocimientoIncautacion` o `actaInventario`.

El shape exacto de estas respuestas viene del controlador genérico de SISDEP. No se validó contra una llamada real. Ver "Pendientes".

## Errores

| Código | Cuándo ocurre                                             | Body                                                                     |
|--------|-----------------------------------------------------------|--------------------------------------------------------------------------|
| 400    | `id` no es numérico en `GET`, `PATCH` o `DELETE` con `/:id`| `{ "success": false, "message": "ID inválido: debe ser numérico" }`      |
| 400    | Falta `Content-Type` o no es multipart en el alta o la edición del acta | `{ "success": false, "message": "Content-Type debe ser multipart/form-data" }` |
| 401    | Falta el header `x-access`                                | `{ "success": false, "message": "Token no proporcionado" }`              |
| 401    | SISDEP responde 401 (sesión vencida)                      | `{ "success": false, "message": "<mensaje SISDEP>", "sesionVencida": true }` |
| 4xx    | SISDEP rechaza el request (sin permisos, no existe, dato duplicado) | `{ "success": false, "message": "<mensaje SISDEP>" }`           |
| 500    | Error inesperado en el proxy                              | `{ "success": false, "message": "Error interno del proxy" }`             |
| 504    | SISDEP no responde (15 s en JSON, 60 s en multipart)      | `{ "success": false, "message": "El servidor remoto no respondió" }`     |

El mensaje de SISDEP se toma de `errors[0].detail`, de `errors[0].title` o de `message`. Si no hay ninguno, el mensaje es `Error en el servidor remoto`.

## Orden de rutas en Express

`/paginated` y `/stream` se registran antes de `/:id`. Express resuelve las rutas en orden de registro. Si `/:id` se registrara primero, capturaría `paginated` y `stream` como id dinámico y respondería 400 por "ID inválido".

No cambiar el orden de este bloque.

## Pendientes y decisiones del equipo

- **Permisos en SISDEP (por verificar)**. `ReconocimientoIncautacionController` asocia los módulos `bodegas_retenciones` y `solo_lectura`. `ActaInventarioController` asocia `operativa_incautaciones` y `solo_lectura`. El reconocimiento no usa `operativa_incautaciones`. Confirmar si es intencional o si falta el módulo correcto.
- **Quién genera `serialActa` (por verificar)**. La columna es `not null unique`. SIVEP no lo genera. Confirmar si lo envía el frontend o si SISDEP lo debe calcular.
- **`elementosIncautados` como texto libre**. Hoy es `varchar` sin estructura. Definir si se mantiene así o si pasa a una lista de ítems con tipo y cantidad.
- **Shape del CRUD genérico (por verificar)**. La forma `{ entities: { ... } }` y el body de página se leyeron en el código de SISDEP, pero no se validaron contra una llamada real. Confirmar con una prueba integrada.
- **`/stream` a través de SIVEP (por verificar)**. El proxy no reenvía el stream: espera la respuesta completa y llama a `.json()`. Con muchas filas puede consumir mucha memoria o superar el límite de tamaño de Express. Probar con un volumen real y evaluar reenviar el stream sin parsear.
- **Borrado con acta asociada (por verificar)**. La clave foránea `id_reconocimiento_incautacion` no declara `ON DELETE`. Con la acción por defecto de Postgres, borrar un reconocimiento con acta debe fallar por violación de clave foránea. Probar el caso y confirmar el código de error que entrega SISDEP.
- **Descarga de PDF**. No hay endpoint dedicado. El frontend usa la URL de `pdfActa` directo. Evaluar un proxy de PDF con la misma lista de orígenes permitidos que `/api/proxy-image`.

## Variables de entorno relevantes

| Variable          | Descripción                                                  |
|-------------------|--------------------------------------------------------------|
| `SISDEP_BASE_URL` | Base URL del API SISDEP (sin slash final).                   |
| `ALLOWED_ORIGINS` | Lista de orígenes permitidos por CORS, separados por coma.   |

## Fuentes

- Implementación SIVEP: `src/app.ts` (bloque "Operativa — Incautaciones").
- Modelo SISDEP: `app/models/operativa/ReconocimientoIncautacion.java`, `app/models/operativa/ActaInventario.java`.
- Tabla SISDEP: `postgres/6 operativa.sql` (`sisdep_operativa.acta_inventario`).
- Controlador SISDEP: `app/controllers/operativa/ActaInventarioController.java`.
- Rutas SISDEP: `conf/rutas_operativa.routes`.
