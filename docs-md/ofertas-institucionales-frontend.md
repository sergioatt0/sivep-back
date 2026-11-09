# Integración del frontend: ofertas institucionales

Guía de consumo de las rutas de SIVEP para el formulario FO-GGOL-015 v5. SIVEP es un proxy autenticado a SISDEP: el frontend llama a SIVEP y recibe las respuestas de SISDEP sin una transformación adicional.

## 1. Base URL y autenticación

Configura la URL del backend SIVEP por ambiente, por ejemplo `http://localhost:5001` en desarrollo. Las rutas de esta guía **no llevan `/api`**.

Todas las llamadas requieren el token de SISDEP en `x-access`:

```http
x-access: <token>
```

Para solicitudes JSON usa `Content-Type: application/json`. Para formularios `multipart/form-data`, usa `FormData` y **no establezcas `Content-Type` manualmente**: el navegador debe incluir el `boundary`.

Ejemplo de helper JSON:

```js
async function sivepJson(path, token, options = {}) {
  const response = await fetch(`${SIVEP_BASE_URL}${path}`, {
    ...options,
    headers: {
      'x-access': token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message || 'Error en SIVEP'), {
    status: response.status,
    body,
  });
  return body;
}
```

## 2. Flujo recomendado

1. Carga los catálogos necesarios y busca el vendedor informal con los flujos existentes de SIVEP.
2. Si se conoce el vendedor, consulta `GET /social/oferta/prellenado/:idVentero`.
3. Crea la necesidad con `POST /social/necesidad` y conserva su ID.
4. Sube las firmas con `POST /archivos` y conserva los IDs de archivo devueltos.
5. Crea la oferta con `POST /social/oferta`, incluyendo los IDs anteriores.
6. Después de crear la oferta, carga sus evidencias con `POST /social/evidenciasOferta`.

Las evidencias son opcionales según el flujo del formulario. `participanteOferta` corresponde al seguimiento posterior, no al alta inicial.

## 3. Rutas disponibles

### Oferta y prellenado

| Operación | Ruta SIVEP |
|---|---|
| Listar ofertas | `GET /social/oferta` |
| Listar paginadas | `GET /social/oferta/paginated` |
| Consultar detalle | `GET /social/oferta/:id` |
| Prellenar por vendedor | `GET /social/oferta/prellenado/:idVentero` |
| Crear / editar / eliminar | `POST /social/oferta`, `PATCH /social/oferta/:id`, `DELETE /social/oferta/:id` |

El prellenado devuelve JSON plano, no un objeto `entities`. Incluye `ventero`, `persona`, `direccionResidencia`, `esAutorizado`, `integrantes` y `estudio`. Si no existe el vendedor, responde `404`.

### Necesidades, participantes y evidencias

| Recurso | Lista | Lista paginada | Detalle | Escritura |
|---|---|---|---|---|
| Necesidad | `GET /social/necesidad` | `GET /social/necesidad/paginated` | `GET /social/necesidad/:id` | `POST`, `PATCH /:id`, `DELETE /:id` |
| Participante | `GET /social/participanteOferta` | `GET /social/participanteOferta/paginated` | `GET /social/participanteOferta/:id` | `POST`, `PATCH /:id`, `DELETE /:id` |
| Evidencia | `GET /social/evidenciasOferta` | `GET /social/evidenciasOferta/paginated` | `GET /social/evidenciasOferta/:id` | Solo `POST /social/evidenciasOferta` |

En colección se pueden usar filtros y paginación de SISDEP, por ejemplo:

```text
GET /social/oferta/paginated?page=0&size=20&sort=fechaEjecucion,desc
```

`PATCH` y `DELETE` de evidencias no están disponibles; SISDEP los rechaza. No muestres acciones de edición o borrado para una evidencia.

### Catálogos

Todos son `GET` y sus respuestas conservan el envoltorio de SISDEP:

```text
/dominios/tipoOferta          /dominios/tipoNecesidad
/dominios/tipoConocimiento    /dominios/tipoEvidencia
/dominios/nacionalidad        /dominios/parentesco
/dominios/ocupacion           /dominios/escolaridad
/dominios/estadoCivil          /dominios/sexo
/dominios/tipoDocumento        /dominios/programaOEntidad
/dominios/remisionOferta
```

También se pueden usar los catálogos ya existentes, como `/dominios/municipio`, `/dominios/comuna` y `/dominios/barrio`.

## 4. Payload de la oferta

El proxy reenvía el JSON tal como llega. El único campo de negocio identificado como obligatorio es `fechaEjecucion`; manda los demás campos que captura el formulario. Los nombres son camelCase.

```json
{
  "fechaEjecucion": "2026-10-06T15:30:00",
  "idVentero": 2450,
  "idBeneficiario": 2451,
  "idNecesidad": 71,
  "firmaSolicitante": 9001,
  "firmaDiligencia": 9002,
  "nombreVentero": "MARIA RESTREPO",
  "documentoVentero": "10101010",
  "beneficiarioNombre": "JUAN RESTREPO",
  "necesidadesSeleccionadas": ["educacion_becas"],
  "recibioOferta": true,
  "aceptaRemision": false,
  "autorizaTratamientoDatos": true
}
```

Campos relevantes por sección:

- **Vendedor:** `nombreVentero`, `tipoDocumentoVentero`, `otroTipoDocumentoVentero`, `documentoVentero`, `idNacionalidadVentero`, `celularVentero`, `direccionResidenciaVentero`, `comunaResidenciaVentero`, `direccionPuestoVenta`, `barrioVenta`, `comunaVenta`, `esVendedorSolicitante`, `nombreSolicitante`, `documentoSolicitante`.
- **Beneficiario:** `beneficiarioNombre`, `beneficiarioEdad`, `tipoDocumentoBeneficiario`, `otroTipoDocumentoBeneficiario`, `documentoBeneficiario`, `idNacionalidadBeneficiario`, `celularBeneficiario`, `direccionResidenciaBeneficiario`, `municipioBeneficiario`, `comunaBeneficiario`, `idParentescoBeneficiario`, `sexoBeneficiario`, `ocupacionBeneficiario`, `afiliacionSaludBeneficiario`, `estadoCivilBeneficiario`, `escolaridadBeneficiario`, `grupoEtnicoBeneficiario`, `proteccionConstitucionalBeneficiario`.
- **Necesidad y autorización:** `necesidadesSeleccionadas`, `recibioOferta`, `aceptaRemision`, `justificacionNoRemision`, `nombreFuncionario`, `documentoFuncionario`, `cargoFuncionario`.
- **Privacidad:** `autorizaTratamientoDatos`, `ciudadAutorizacion`, `fechaAutorizacion`, `tipoDocumentoFirmante`, `documentoFirmante`.

`necesidadesSeleccionadas` y `proteccionConstitucionalBeneficiario` son arreglos. No envíes `idUsuario`, `idTipo` ni `idConvenio`: el formulario v5 no los captura y el proxy no los completa.

La necesidad se crea antes de la oferta. El token aporta el usuario; no agregues `idUsuario` al body:

```json
{
  "idTipoNecesidad": 3,
  "descripcion": "Requiere apoyo educativo",
  "idPersona": 2450
}
```

## 5. Firmas y evidencias multipart

### Subir una firma

`POST /archivos` acepta multipart con una parte `info` y una parte de archivo. En `info`, usa `folder: "OfertaInstitucional"` y `path: "archivos/OfertaInstitucional"`.

```js
const form = new FormData();
form.append('info', JSON.stringify({
  folder: 'OfertaInstitucional',
  path: 'archivos/OfertaInstitucional',
  nombreArchivo: file.name,
  extension: '.png',
}));
form.append('file', file);

const response = await fetch(`${SIVEP_BASE_URL}/archivos`, {
  method: 'POST',
  headers: { 'x-access': token },
  body: form,
});
const { archivos } = await response.json();
const firmaSolicitante = archivos[0].id;
```

Sube cada firma y guarda su `id` para el alta de oferta.

### Subir evidencia

Envía `POST /social/evidenciasOferta` como multipart. `info` contiene `idOferta` e `idTipoEvidencia`; adjunta el archivo:

```js
const form = new FormData();
form.append('info', JSON.stringify({ idOferta, idTipoEvidencia }));
form.append('archivo', file);

await fetch(`${SIVEP_BASE_URL}/social/evidenciasOferta`, {
  method: 'POST',
  headers: { 'x-access': token },
  body: form,
});
```

El alta de evidencia debe hacerse después de crear la oferta, porque requiere su ID.

### Descargar evidencia

El campo `enlace` devuelto por SISDEP identifica el archivo. Para descargarlo usando la sesión de SIVEP, usa:

```text
GET /archivos/evidencias-oferta/:idOferta/:filename
```

La ruta devuelve binario y requiere `x-access`. `idOferta` debe ser numérico; `filename` debe ser solo el nombre del archivo, no una ruta.

## 6. Respuestas, reporte y permisos

- Las listas y detalles suelen venir bajo `entities`; `/paginated` devuelve `entities` como arreglo y datos de paginación. El prellenado es la excepción: JSON plano.
- `POST` devuelve el status y body de SISDEP (normalmente `201`); `PATCH` y `DELETE` también conservan el status upstream. No presupongas un envoltorio propio de SIVEP.
- El reporte es `POST /social/reportes/reporteOfertasInstitucionalesIndex/excel`, con JSON como `{ "ids": ["501", "502"], "attribute": "id" }`. La respuesta es un archivo Excel; no hay una ruta GET para listar los IDs del reporte.
- El permiso de oferta es `social_ofertas`, pero el prellenado requiere `social_registro_ventero` y necesidad requiere `personas`. Un `403` normalmente indica que falta uno de esos módulos.
- Un `401` indica token ausente o vencido; SISDEP puede incluir `sesionVencida: true`. Un `409` puede indicar falta de `fechaEjecucion` u otro dato que SISDEP no pudo guardar.

En el formato v5, la decisión de remisión se guarda en la oferta (`aceptaRemision` y `justificacionNoRemision`). El endpoint legado `/social/remision` no está expuesto.
