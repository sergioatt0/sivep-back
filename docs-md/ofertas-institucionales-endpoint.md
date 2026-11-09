# Dominio `ofertas institucionales` (FO-GGOL-015 v5)

Proxy autenticado a los endpoints de oferta institucional de SISDEP. SIVEP no
implementa el dominio: reenvía rutas y cuerpos tal cual y devuelve la respuesta del
upstream sin envolverla en `{ success, data }`. El cliente consume la misma
estructura que entrega SISDEP.

Implementación: `src/app.ts` (bloque "Ofertas institucionales (FO-GGOL-015 v5)").
Entradas del índice: `GET /`. Tests: `tests/ofertas-institucionales.test.js`.

La guía de análisis del dominio (modelo de datos, migraciones y hallazgos en SISDEP)
está en `docs-md/ofertas-institucionales.md`. Este documento describe **lo que SIVEP
expone hoy**, que en un punto difiere de esa guía (ver "Evidencias").

## Resumen

| Atributo            | Valor                                                              |
|---------------------|--------------------------------------------------------------------|
| Métodos             | `GET`, `POST`, `PATCH`, `DELETE` (evidencias: solo `GET` y `POST`)  |
| Prefijos backend    | `/social/oferta`, `/social/necesidad`, `/social/participanteOferta`, `/social/evidenciasOferta`, `/social/reportes/...`, `/dominios/...`, `/archivos/evidencias-oferta` |
| Upstream SISDEP     | `${SISDEP_BASE_URL}/api/...`                                       |
| Autenticación       | Header `x-access: <jwt>` en todas las rutas (obligatorio)          |
| Validación de `id`  | Numérico (`^\d+$`). En prellenado y descarga el param se llama `idVentero` / `idOferta` |
| Timeout upstream    | 15 s en JSON; 60 s en multipart y en Excel; 30 s en la descarga de evidencias |
| Tamaño máximo       | 50 MB en el alta de evidencias                                     |
| CORS                | Sujeto a `ALLOWED_ORIGINS`                                         |

## Rutas

### Oferta

| Método | Ruta SIVEP                               | Ruta SISDEP                                        | Notas                                     |
|--------|------------------------------------------|----------------------------------------------------|-------------------------------------------|
| GET    | `/social/oferta`                         | `/api/social/oferta`                               | Reenvía `req.query`.                      |
| GET    | `/social/oferta/paginated`               | `/api/social/oferta/paginated`                     | Reenvía `req.query`.                      |
| GET    | `/social/oferta/prellenado/:idVentero`   | `/api/social/oferta/prellenado/{idVentero}`        | `idVentero` numérico. Sin query.          |
| GET    | `/social/oferta/:id`                     | `/api/social/oferta/{id}`                          | `id` numérico. Sin query.                 |
| POST   | `/social/oferta`                         | `/api/social/oferta`                               | JSON del formato v5.                      |
| PATCH  | `/social/oferta/:id`                     | `/api/social/oferta/{id}`                          | `id` numérico + JSON.                     |
| DELETE | `/social/oferta/:id`                     | `/api/social/oferta/{id}`                          | `id` numérico.                            |

`/paginated` y `/prellenado/:idVentero` se registran **antes** que `/:id`. Express
resuelve en orden de registro: si `/:id` fuera primero, `prellenado` entraría como id
dinámico y el proxy respondería `400 ID inválido`.

### Necesidad

La crea el formulario **antes** de la oferta; su `id` viaja como `idNecesidad` en el
alta de la oferta.

| Método | Ruta SIVEP                        | Ruta SISDEP                             | Notas                 |
|--------|-----------------------------------|-----------------------------------------|-----------------------|
| GET    | `/social/necesidad`               | `/api/social/necesidad`                 | Reenvía `req.query`.  |
| GET    | `/social/necesidad/paginated`     | `/api/social/necesidad/paginated`       | Reenvía `req.query`.  |
| GET    | `/social/necesidad/:id`           | `/api/social/necesidad/{id}`            | `id` numérico.        |
| POST   | `/social/necesidad`               | `/api/social/necesidad`                 | JSON.                 |
| PATCH  | `/social/necesidad/:id`           | `/api/social/necesidad/{id}`            | `id` numérico + JSON. |
| DELETE | `/social/necesidad/:id`           | `/api/social/necesidad/{id}`            | `id` numérico.        |

### Participante de la oferta

Verificación y seguimiento (participó o no, beneficio otorgado, observaciones).

| Método | Ruta SIVEP                              | Ruta SISDEP                                       | Notas                 |
|--------|-----------------------------------------|---------------------------------------------------|-----------------------|
| GET    | `/social/participanteOferta`            | `/api/social/participanteOferta`                  | Reenvía `req.query`.  |
| GET    | `/social/participanteOferta/paginated`  | `/api/social/participanteOferta/paginated`        | Reenvía `req.query`.  |
| GET    | `/social/participanteOferta/:id`        | `/api/social/participanteOferta/{id}`             | `id` numérico.        |
| POST   | `/social/participanteOferta`            | `/api/social/participanteOferta`                  | JSON.                 |
| PATCH  | `/social/participanteOferta/:id`        | `/api/social/participanteOferta/{id}`             | `id` numérico + JSON. |
| DELETE | `/social/participanteOferta/:id`        | `/api/social/participanteOferta/{id}`             | `id` numérico.        |

### Evidencias

| Método | Ruta SIVEP                          | Ruta SISDEP                                   | Notas                                              |
|--------|-------------------------------------|-----------------------------------------------|----------------------------------------------------|
| GET    | `/social/evidenciasOferta`          | `/api/social/evidenciasOferta`                | Reenvía `req.query`.                               |
| GET    | `/social/evidenciasOferta/paginated`| `/api/social/evidenciasOferta/paginated`      | Reenvía `req.query`.                               |
| GET    | `/social/evidenciasOferta/:id`      | `/api/social/evidenciasOferta/{id}`           | `id` numérico.                                     |
| POST   | `/social/evidenciasOferta`          | `/api/social/evidenciasOferta`                | **Multipart**: parte `info` + archivo.             |
| GET    | `/archivos/evidencias-oferta/:idOferta/:filename` | `/api/archivos/evidencias-oferta/{idOferta}/{filename}` | Descarga binaria autenticada. Stream passthrough. |

`PATCH` y `DELETE` de evidencias **no se exponen**: SISDEP responde 403 siempre
("No es posible actualizar/eliminar las evidencias"). En SIVEP esas rutas no existen y
la petición termina en el 404 por defecto de Express, sin llamar al upstream.

### Catálogos del formulario

Todos son `GET` y reenvían `req.query` al upstream.

```
/dominios/tipoOferta          /dominios/nacionalidad        /dominios/estadoCivil
/dominios/tipoNecesidad       /dominios/parentesco          /dominios/sexo
/dominios/tipoConocimiento    /dominios/ocupacion           /dominios/tipoDocumento
/dominios/tipoEvidencia       /dominios/escolaridad         /dominios/programaOEntidad
/dominios/remisionOferta
```

Se reutilizan los catálogos de dirección que ya existían:
`/dominios/{municipio,comuna,barrio,nomenclaturaVial,orientacion}`.
`grupoEtnico` no tiene catálogo: es texto libre dentro de la oferta.

### Reporte Excel

| Método | Ruta SIVEP                                                    | Ruta SISDEP                                                     |
|--------|---------------------------------------------------------------|-----------------------------------------------------------------|
| POST   | `/social/reportes/reporteOfertasInstitucionalesIndex/excel`   | `/api/social/reportes/reporteOfertasInstitucionalesIndex/excel` |

Body JSON con **IDs explícitos**:

```json
{ "ids": ["501", "502"], "attribute": "id" }
```

La vista `vw_reporte_ofertas_institucionales_index` **no tiene `GET` de lista**: el
Excel solo acepta los ids que el cliente ya conoce. La lista se obtiene de
`GET /social/oferta` o `GET /social/oferta/paginated` (`id` + `fechaEjecucion`) y se
envía en ese orden. Es un `POST` con respuesta binaria: se reenvían `content-type`,
`content-length` y `content-disposition` (`attachment; filename="...xlsx"`). Si SISDEP
corta la conexión a mitad del *stream*, SIVEP destruye la respuesta en vez de dejarla
colgada.

## Envoltorios de respuesta (passthrough)

SIVEP no remodela el body: devuelve el mismo JSON y el mismo status de SISDEP.

| Operación                    | Body de SISDEP                                                                 |
|------------------------------|--------------------------------------------------------------------------------|
| `GET` colección              | `{ "entities": { "<entidad>": { "<id>": { ...campos } } } }` (objeto, no array) |
| `GET /:id`                   | igual al anterior, con un solo id                                              |
| `POST`                       | `201` + el mismo envoltorio con el id generado                                 |
| `PATCH`                      | `202` + el envoltorio actualizado                                              |
| `DELETE`                     | `202` + `{ "id": <id> }`. Si SISDEP no devuelve body, SIVEP responde `{ "success": true }` |
| `GET /paginated`             | `{ "entities": [ ... ], "name": "<entidad>", "totalCount": N, "totalPageCount": M }` |
| Catálogos `/dominios/x`      | `{ "entities": { "x": { "<id>": { "id", "descripcion", ... } } } }`            |
| `GET /social/oferta/prellenado/:idVentero` | **JSON puro, sin `entities`** (ver abajo)                          |

`<entidad>` es `oferta`, `necesidad`, `participanteOferta` o `evidenciasOferta`.

El prellenado es la excepción: lo arma un controlador a medida en SISDEP y responde
plano.

```jsonc
{
  "ventero": { /* Ventero */ },
  "persona": { /* Persona (mismo id que el ventero) */ },
  "direccionResidencia": { /* Direccion | null */ },
  "esAutorizado": true,
  "integrantes": [ { "integrante": { /* ... */ }, "persona": { /* ... */ } } ],
  "estudio": {
    "estudio": { /* último EstudioSocioEconomico | null */ },
    "aspectosSeguridadSocial": { /* | null */ },
    "aspectosPoblacionales": { /* | null */ }
  }
}
```

Si el ventero no existe, SISDEP responde `404` con `errors[0].detail = "No existe
ventero ni persona con id X"`; SIVEP copia el status y el detalle.

## Payload de la oferta (formato v5)

SIVEP **no filtra ni completa** el body de la oferta. Lo que envía el front llega
íntegro a SISDEP; por eso el contrato de campos se cierra en SISDEP
(`test/models/social/OfertaFormatoV5Test.java`) y no en este proxy. El test
`tests/ofertas-institucionales.test.js` fija el payload completo y verifica que viaje
campo por campo.

Bloques del formulario (nombres camelCase de las columnas v5):

| Bloque | Campos |
|---|---|
| Oferta (base) | `fechaEjecucion` (**única obligatoria de negocio**), `idVentero`, `idBeneficiario`, `idNecesidad`, `firmaSolicitante`, `firmaDiligencia` |
| Datos del vendedor | `nombreVentero`, `tipoDocumentoVentero`, `otroTipoDocumentoVentero`, `documentoVentero`, `idNacionalidadVentero`, `celularVentero`, `direccionResidenciaVentero`, `comunaResidenciaVentero`, `direccionPuestoVenta`, `barrioVenta`, `comunaVenta`, `esVendedorSolicitante`, `nombreSolicitante`, `documentoSolicitante` |
| Quien requiere la oferta | `beneficiarioNombre`, `beneficiarioEdad`, `tipoDocumentoBeneficiario`, `otroTipoDocumentoBeneficiario`, `documentoBeneficiario`, `idNacionalidadBeneficiario`, `celularBeneficiario`, `direccionResidenciaBeneficiario`, `municipioBeneficiario`, `comunaBeneficiario`, `idParentescoBeneficiario`, `sexoBeneficiario`, `ocupacionBeneficiario`, `afiliacionSaludBeneficiario`, `estadoCivilBeneficiario`, `escolaridadBeneficiario`, `grupoEtnicoBeneficiario`, `proteccionConstitucionalBeneficiario` (array) |
| Necesidades | `necesidadesSeleccionadas` (array) |
| Autorización | `recibioOferta`, `aceptaRemision`, `justificacionNoRemision`, `nombreFuncionario`, `documentoFuncionario`, `cargoFuncionario` |
| Aviso de privacidad | `autorizaTratamientoDatos`, `ciudadAutorizacion`, `fechaAutorizacion`, `tipoDocumentoFirmante`, `documentoFirmante` |

Reglas que el front debe respetar al armar el body:

- `idTipo` e `idConvenio` **no** se envían: el formulario v5 no los captura y en
  SISDEP son `NULLABLE` desde `V20261027.1`.
- No enviar `idUsuario`: `oferta` no lo guarda. `necesidad` lo toma del token.
- Los ids de catálogo v5 no tienen clave foránea, pero un id inexistente en
  `idTipo`/`idConvenio` provoca el `409` genérico de SISDEP.
- `proteccionConstitucionalBeneficiario` y `necesidadesSeleccionadas` son arreglos de
  strings; el resto de campos de texto son libres (`OTRO` + `otroTipoDocumento*`).

Payload mínimo que SISDEP acepta:

```json
{
  "fechaEjecucion": "2026-10-06T15:30:00",
  "idVentero": 2450,
  "idBeneficiario": 2451,
  "necesidadesSeleccionadas": ["educacion_becas"],
  "recibioOferta": true,
  "aceptaRemision": false
}
```

## Firmas

Las firmas del formulario no son evidencias: van a `sisdep_anexos.documento` con la
carpeta `OfertaInstitucional`, por el endpoint de archivos que ya existía.

```bash
# 1. Subir la firma (una llamada por firma)
curl -s -X POST "http://localhost:5001/archivos" \
  -H "x-access: $TOKEN" \
  -F 'info={"folder":"OfertaInstitucional","path":"archivos/OfertaInstitucional","nombreArchivo":"firma_solicitante.png","extension":".png"}' \
  -F 'file=@firma_solicitante.png'

# 2. Enviar el id devuelto en el alta de la oferta
#    { "archivos": [ { "id": 9001, "fullPath": "https://..." } ] }
#    → firmaSolicitante: 9001, firmaDiligencia: 9002
```

La descarga de una firma usa `GET /archivos/OfertaInstitucional/:filename`.
Si el front quiere poder listarlas después, debe enviar `modulo` e `idModulo` dentro
de `info`; si no, quedan como archivos huérfanos referenciados solo por
`firmaSolicitante` / `firmaDiligencia`.

## Evidencias

### Alta (multipart)

`POST /social/evidenciasOferta` es **multipart**, no JSON:

- parte `info`: `{ "idOferta": 501, "idTipoEvidencia": 4 }`
- una parte de archivo (la primera que encuentre SISDEP)

SIVEP reenvía el **stream** del request tal cual (mismo patrón que
`POST /operativa/actaInventario`), con el `content-type` y el `content-length`
originales. Nunca serializa el multipart como JSON. Si el `content-type` no empieza
por `multipart/form-data`, responde `400` sin llamar a SISDEP.

SISDEP guarda el archivo en `evidencias-oferta/<idOferta>/<timestamp>.<ext>` y
devuelve en `enlace` la URL pública del archivo.

```bash
curl -s -X POST "http://localhost:5001/social/evidenciasOferta" \
  -H "x-access: $TOKEN" \
  -F 'info={"idOferta":501,"idTipoEvidencia":4}' \
  -F 'archivo=@acta-entrega.pdf'
```

### Descarga autenticada (corrección a la guía anterior)

La guía `docs-md/ofertas-institucionales.md` (§6.2) dice que las evidencias no pasan
por el proxy de archivos y que hay que abrir `enlace` directo. **Eso está
desactualizado.** SISDEP sí expone la carpeta anidada:

```
GET {SISDEP}/api/archivos/evidencias-oferta/*file      (permiso social_ofertas)
```

Esa ruta con comodín no cabe en `GET /archivos/:folder/:filename` (dos segmentos de
carpeta), así que SIVEP registra un handler propio, **antes** de la ruta genérica:

```
GET /archivos/evidencias-oferta/:idOferta/:filename
```

- `idOferta` debe ser numérico (`400 idOferta inválido: debe ser numérico`).
- `filename` se valida contra `/`, `\` y `..` (`400 Ruta inválida`) y se reenvía
  codificado con `encodeURIComponent`.
- La respuesta se hace *streaming* y se copian `content-type`, `content-length` y
  `cache-control` del upstream.
- Si SISDEP responde error, se devuelve **JSON** (no el binario):
  `{ "success": false, "message": "<detalle>", "sesionVencida": true }` en `401`.
- Si SISDEP corta la conexión a mitad del *stream*, SIVEP destruye la respuesta: el
  cliente ve la descarga abortada, no una respuesta colgada.

```bash
# El nombre del archivo sale del campo `enlace` de la evidencia
curl -s -OJ "http://localhost:5001/archivos/evidencias-oferta/501/1729000000000.pdf" \
  -H "x-access: $TOKEN"
```

`enlace` sigue siendo utilizable por el front, pero es una URL de SISDEP: no valida
`x-access` por sí sola ni pasa por SIVEP. Si se necesita el token de la sesión y el
control de CORS, usar la ruta de SIVEP.

## Permisos: asimetrías del dominio

Los permisos los aplica SISDEP con el token del usuario; SIVEP no los revalida. Un
grupo con "Social ofertas" no alcanza para todo el formulario:

| Recurso | Módulos que acepta SISDEP |
|---|---|
| `oferta` (CRUD), `participanteOferta`, `evidenciasOferta`, Excel | `solo_lectura` (0), `social_ofertas` (20) |
| `oferta/prellenado/:idVentero` | `solo_lectura` (0), **`social_registro_ventero` (19)** |
| `necesidad` | `solo_lectura` (0), **`personas` (30)** |
| `remision` (flujo v4) | `solo_lectura` (0), **`personas` (30)** |
| carpeta `OfertaInstitucional` (firmas) | `solo_lectura` (0), `social_ofertas` (20) |

Consecuencias al probar con usuarios reales:

1. El **prellenado** exige `social_registro_ventero`, no `social_ofertas`. Un grupo con
   solo "Social ofertas" recibe `403` al abrir el formulario.
2. La **necesidad** exige `personas`. Sin ese módulo no se puede crear la necesidad
   previa y, por tanto, no se puede diligenciar la oferta completa. Decisión pendiente
   con el área: pedir a SISDEP que agregue `social_ofertas` a ese controlador, o exigir
   `personas` al grupo que usa el formulario.
3. `PATCH`/`DELETE` de evidencias responden `403` en SISDEP aunque el grupo tenga
   BORRAR. Por eso esas rutas no se exponen.

Si SISDEP responde `403`, SIVEP copia el `403` con el mensaje del upstream y **no**
marca `sesionVencida`.

## Remisión legado: no se expone

`remision` es el flujo de v4 (`id_necesidad` + `id_remitido_a` + `contacto_entidad`).
En el formato v5 la autorización de remisión vive dentro de `oferta`
(`aceptaRemision`, `justificacionNoRemision`). SIVEP **no** expone
`/social/remision`, así que el front v5 no puede caer en el flujo antiguo. Solo se
expone el catálogo `/dominios/remisionOferta`, que sí usa el formulario.

## Errores

| Código | Cuándo ocurre | Body |
|--------|---------------|------|
| 400 | `id`, `idVentero` o `idOferta` no numérico | `{ "success": false, "message": "ID inválido: debe ser numérico" }` / `"idVentero inválido..."` / `"idOferta inválido..."` |
| 400 | `filename` de evidencia con `/`, `\` o `..` | `{ "success": false, "message": "Ruta inválida" }` |
| 400 | Alta de evidencia sin `multipart/form-data` | `{ "success": false, "message": "Content-Type debe ser multipart/form-data (parte info + archivo)" }` |
| 401 | Falta el header `x-access` | `{ "success": false, "message": "Token no proporcionado" }` |
| 401 | SISDEP responde 401 (token vencido) | `{ "success": false, "message": "<detalle SISDEP>", "sesionVencida": true }` |
| 403 | Sin permiso en el módulo (ver asimetrías) | `{ "success": false, "message": "<detalle SISDEP>" }` |
| 404 | El recurso no existe, o `PATCH`/`DELETE` de evidencias (ruta no expuesta) | El 404 por defecto de Express (HTML) o el JSON de SISDEP |
| 406 | El JSON no deserializa al modelo | JSON de SISDEP |
| 409 | Falta `fechaEjecucion`, o `idTipo`/`idConvenio` inexistente. Es el error real de ofertas | `{ "success": false, "message": "<detalle SISDEP>" }` sin `sesionVencida` |
| 500 | Error inesperado del proxy | `{ "success": false, "message": "Error interno del proxy" }` |
| 504 | SISDEP no responde | `{ "success": false, "message": "El servidor remoto no respondió" }` |

El mensaje se toma de `errors[0].detail`, de `errors[0].title` o de `message`. Si no
hay ninguno se usa `Error en el servidor remoto`.

## Filtros y paginación

Los `GET` de colección reenvían `req.query` sin cambios; SISDEP la interpreta
(`GenericRepository.buildQuery`):

| Query param | Efecto |
|---|---|
| `page`, `size` | Paginación base 0 (default 10). |
| `sort` | `campo` o `campo,asc\|desc`. |
| `contains=txt` | `ILIKE %txt%` sobre los campos de texto del modelo. |
| `campo=valor` | Igualdad; repetido se convierte en `IN (...)`. |
| `campo__lt`, `__lte`, `__gt`, `__gte` | Rango. |
| `campo__between=a,b` | `BETWEEN`. |

`GET /social/oferta` sin filtros corta en `sisdep.consulta.maxFilas` (10 000 por
defecto) y **no garantiza orden**. Para listados de pantalla usar
`GET /social/oferta/paginated` con `sort`.

## Tests

`tests/ofertas-institucionales.test.js` (Node `node:test`) levanta un SISDEP simulado
y cubre:

- auth y reenvío de `x-access`, ruta y query en oferta y prellenado;
- `prellenado/abc` y `prellenado/12.5` → `400` **sin** llamar al upstream;
- orden de rutas (`/paginated` y `/prellenado` no caen en `/:id`), paginación, filtros
  repetidos y de rango;
- payload v5 completo (50 campos) idéntico en el upstream; `PATCH` solo con lo enviado;
- CRUD de `necesidad` y `participanteOferta`, incluidas las listas sin `/paginated`;
- alta de evidencia como multipart (se parsean `info` y los bytes del archivo en el
  mock; el proxy no la convierte a JSON) y rechazo de `application/json` con `400`;
- `PATCH`/`DELETE` de evidencias `404` sin llamar al upstream;
- descarga de evidencia anidada: bytes idénticos, `content-type`, `content-length` y
  `cache-control`, `401` sin token, `400` con `idOferta` inválido y `404` del upstream
  como JSON;
- los 13 catálogos;
- `401` de SISDEP con `sesionVencida` y `409` con el `detail`;
- Excel: bytes idénticos, `content-type`, `content-disposition` y `content-length`, y
  error del upstream como JSON;
- corte del upstream a mitad del *stream* (evidencia y Excel): la respuesta se aborta
  en vez de quedar colgada.

## Ejemplos curl

```bash
TOKEN="<token devuelto por /login>"
```

```bash
# Prellenado del formulario
curl -s "http://localhost:5001/social/oferta/prellenado/2450" -H "x-access: $TOKEN"

# Listado paginado
curl -s "http://localhost:5001/social/oferta/paginated?page=0&size=20&sort=fechaEjecucion,desc" \
  -H "x-access: $TOKEN"

# Crear la necesidad previa
curl -s -X POST "http://localhost:5001/social/necesidad" \
  -H "x-access: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"idTipoNecesidad":3,"descripcion":"OTRO: requiere lentes","idPersona":2450}'

# Crear la oferta (payload v5 completo en el cuerpo)
curl -s -X POST "http://localhost:5001/social/oferta" \
  -H "x-access: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fechaEjecucion":"2026-10-06T15:30:00","idVentero":2450,"idBeneficiario":2451,"idNecesidad":71,"necesidadesSeleccionadas":["educacion_becas"],"recibioOferta":true,"aceptaRemision":false}'

# Reporte Excel con ids explícitos
curl -s -X POST "http://localhost:5001/social/reportes/reporteOfertasInstitucionalesIndex/excel" \
  -H "x-access: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"ids":["501","502"],"attribute":"id"}' -o ofertas.xlsx
```

## Pendientes y decisiones del equipo

- **Validación de campos v5 (por verificar)**: el contrato vive en
  `OfertaFormatoV5Test.java` de SISDEP. El payload de los tests de SIVEP replica la
  lista de columnas de la migración `V20261006.1`; si SISDEP renombra un campo, ambos
  lados deben actualizarse a la vez.
- **`necesidad` con permiso `personas`**: decidir si SISDEP agrega `social_ofertas` al
  controlador o si el grupo del formulario debe tener `personas`.
- **Excel sin lista**: no hay `GET` de la vista del reporte, así que el cliente debe
  resolver los ids. Confirmar con el área si el reporte se expone en el front.
- **Envoltorios**: la forma `{ entities: ... }` y el body de página se leyeron en el
  código de SISDEP; no se validaron contra una llamada real. Los tests de SIVEP fijan
  el passthrough, no la forma del dominio.
- **`POST /social/oferta` sin `fechaEjecucion`** devuelve el `409` genérico de SISDEP.
  Si el front necesita un `400` explicativo, la validación debe hacerse en el front: el
  proxy no valida campos para no divergir del contrato.

## Fuentes

- Implementación SIVEP: `src/app.ts` (bloques "Ofertas institucionales" y "Evidencias
  de oferta" dentro de la sección de archivos).
- Tests: `tests/ofertas-institucionales.test.js`.
- Guía del dominio y hallazgos en SISDEP: `docs-md/ofertas-institucionales.md`.
- Patrón de proxy multipart: `POST /operativa/actaInventario`.
- Patrón de proxy binario: `GET /general/direccionCompleta/excel` y
  `GET /archivos/:folder/:filename`.
