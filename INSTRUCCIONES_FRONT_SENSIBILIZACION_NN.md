# Sensibilización NN con puesto de venta — instrucciones para los front de SIVEP y SISDEP

> Secciones 1 a 9: front de **SIVEP** (consume sivep-back). Sección 10: front web de **SISDEP** (`sisdep-front`, consume sisdep-back directamente).

**Fecha:** 19/10/2026 · **Rama:** `feature/sensibilizacion-nn-puesto-venta` (sivep-back y sisdep-back)
**Requiere:** SISDEP con la migración `V20261019.1` (ya aplicada en UAT) y el despliegue de los dos back con estos cambios.

## 1. Qué se arregla

En una sensibilización **NN** (sin vendedor identificado) se perdían la **dirección**, la **clase de venta** y la **actividad económica**. Esos datos no van en la sensibilización: van en su **puesto de venta** (`datosVenta`). Hasta ahora el puesto exigía un ventero, así que una NN no podía tener puesto.

Ahora una NN tiene su propio puesto (sin ventero), enlazado a la sensibilización. Lo crea y lo enlaza SIVEP: **el front solo manda `datosVenta` dentro de la misma sensibilización.**

## 2. Crear una sensibilización NN con su puesto

**Paso 1 — Crear la dirección del puesto.** Cada puesto necesita **su propia dirección nueva**: una dirección que ya usa otro puesto se rechaza.

```http
POST /general/direccion
{ "cruceDesde": 2, "numeroDesde": 79, "letraDesde": null,
  "cruceHasta": 1, "numeroHasta": 44, "letraHasta": null,
  "numero": 18, "idBarrio": 2, "idComuna": 12 }
```

`cruceDesde`, `numeroDesde`, `cruceHasta` y `numeroHasta` son obligatorios. La respuesta trae el `id` de la dirección.

**Paso 2 — Crear la sensibilización con `datosVenta`:**

```http
POST /operativa/sensibilizacion
{
  "numeroSerie": "A-1234",
  "idTipo": 1,
  "fecha": "2026-10-19T09:00:00",
  "idSectorInterno": 67,
  "latitud": 6.2442, "longitud": -75.5812,
  "observaciones": "…",
  "datosVenta": {
    "idClaseVenta": 1,
    "desActividadEconomica": "Venta de frutas",
    "idDireccion": 8301,
    "observaciones": "esquina del parque"
  }
}
```

Respuesta `201`:

```json
{ "success": true,
  "sensibilizacion": { "id": 19300, "esNn": true, "idDatosVenta": 4300, "…": "…" },
  "datosVenta": { "id": 4300, "idVentero": null, "idClaseVenta": 1, "desActividadEconomica": "Venta de frutas",
                  "idDireccion": 8301, "idSectorInterno": 67, "atiendeTitular": false } }
```

Reglas de `datosVenta`:

| Campo | Al crear | Notas |
|---|---|---|
| `idClaseVenta` | **Obligatorio** | Del catálogo de clase de venta |
| `desActividadEconomica` | **Obligatorio** | Texto, no vacío |
| `idDireccion` | Recomendado | La del paso 1. Única por puesto |
| `idSectorInterno` | No | Si no llega, toma el territorio de la sensibilización (igual que SISDEP) |
| `observaciones`, `atiendeTitular`, `idCostado`, `idTipologiaVenta`, `idActividadEconomicaActual`, `idActividadEconomicaOpcional`, `idDia`, `horaInicio`, `horaFin`, `idAmoblamiento` | No | Opcionales |
| `id`, `idVentero` | **No enviar** | Los decide el back |

Si SISDEP rechaza la sensibilización, SIVEP borra el puesto que acababa de crear: no quedan puestos sueltos.

## 3. Editar el puesto de una NN

Mandar solo lo que cambia, dentro de `datosVenta`:

```http
PATCH /operativa/sensibilizacion/19300
{ "datosVenta": { "desActividadEconomica": "Venta de frutas y verduras" }, "motivo": "Corrección" }
```

- Se actualiza **el mismo puesto**; lo que no se manda se conserva (dirección, clase…).
- Si la NN no tenía puesto (registros anteriores a este cambio), se crea y se enlaza.
- Para cambiar la dirección: crear una nueva (paso 1) y mandar su `idDireccion`. Para corregir la misma dirección: `PATCH /general/direccion/{id}`.

## 4. Asignar el vendedor a una NN

```http
PATCH /operativa/sensibilizacion/19300
{ "idPersona": 89423 }
```

- Si el ventero **no tiene puesto propio**, el puesto de la NN **pasa a ser del ventero**; no se pierde nada.
- Si el ventero **ya tenía puesto**, la sensibilización queda enlazada al puesto del ventero.
- También se puede mandar `datosVenta` en el mismo PATCH: se aplica al puesto que queda.

## 5. Sensibilización con vendedor identificado

También acepta `datosVenta`: SIVEP crea o actualiza **el puesto del ventero** (`idPersona`). No hace falta llamar aparte a `/ventero/datosVenta`, aunque ese endpoint sigue funcionando igual.

## 6. Consultar

```http
GET /operativa/sensibilizacion/19300
```

Trae `sensibilizacion`, `datosVenta` (con `direccion` completa, incluidas las coordenadas) y `titular` (`null` en NN).

## 7. Errores

| Código | Cuándo | Mensaje (ejemplo) |
|---|---|---|
| `422` | Falta la clase de venta o la actividad al crear el puesto | "El campo idClaseVenta es obligatorio" |
| `422` | La dirección ya es de otro puesto | "La dirección 8284 ya pertenece a otro puesto de venta: cree una dirección nueva para este puesto (POST /general/direccion)." |
| `422` | NN sin territorio | "Una sensibilización sin ventero (NN) debe tener territorio (idSectorInterno)" |
| `409` | Número de serie repetido | "El número de serie … ya está registrado" |
| `403` | Sin permiso de escritura | — |

**Campos descartados:** si el cuerpo trae campos que no son de la sensibilización (por ejemplo, la dirección suelta fuera de `datosVenta`), la respuesta incluye `"camposDescartados": ["…"]`. Si aparece, hay que revisar el formulario: esos datos **no se guardaron**.

## 8. Qué cambia en la pantalla

1. En el formulario de NN, los campos de dirección, clase de venta y actividad se envían **dentro de `datosVenta`**, y la dirección se crea antes con `POST /general/direccion`.
2. Al editar una NN, precargar desde `GET /operativa/sensibilizacion/{id}` → `datosVenta`.
3. Si la respuesta trae `camposDescartados`, mostrar un aviso.

## 9. Cómo se probó

- Pruebas automáticas de sivep-back: 192 / 192, de ellas 10 nuevas en `tests/sensibilizaciones-nn-puesto.test.js`.
- Prueba de punta a punta (19/10/2026) con sivep-back y sisdep-back locales sobre la base de UAT:
  - crear NN con puesto, consultar, editar;
  - asignar vendedor por SIVEP (con `datosVenta`) y solo por SISDEP;
  - dirección repetida y puesto incompleto (422).
  - Los datos de prueba se borraron al terminar.

## 10. Front web de SISDEP (`sisdep-front`)

El front de SISDEP tiene el mismo problema: en `src/operativa/components/SensibilizacionForm.tsx`, `persisteVenta` solo guarda el puesto cuando hay vendedor; en NN no hace nada (comentario *"NN sin puesto vinculado: los campos capturados solo alimentan la vista previa"*). Además, `toSubmitValues` borra `idDatosVenta` antes de enviar.

SISDEP no tiene el atajo de `datosVenta` anidado (eso es solo de SIVEP): el front de SISDEP llama a los endpoints de siempre. Los usuarios del módulo de sensibilización ya tienen permiso para escribir puesto y dirección (commit `369c17f`).

### 10.1 Cargar el puesto de una NN

Hoy el puesto se busca con `GET /api/ventero/datosVenta?idVentero={idPersona}`, que en NN no trae nada. Para NN (o siempre, porque sirve para los dos casos):

```http
GET /api/operativa/sensibilizacion/{id}/venta
```

Trae `datosVenta` (con `direccion` completa) y `titular` (`null` en NN). Con eso se llenan `ventaData`, `direccionVentaData` y el formulario (`poblarCamposVenta`).

### 10.2 Guardar el puesto de una NN

En `persisteVenta`, agregar la rama NN (cuando no hay `idPersona`):

1. **Si la NN ya tiene puesto** (`ventaData?.id`): se usa la rama que ya existe (`updateDatosVenta` + `updateDireccion`). No cambia nada.
2. **Si no tiene puesto:**
   1. Crear la dirección: `POST /api/general/direccion` con `dirBody`. Siempre **una dirección nueva**: una dirección no puede ser de dos puestos (si se repite, SISDEP responde `409` genérico).
   2. Crear el puesto **sin `idVentero`**:
      ```http
      POST /api/ventero/datosVenta
      { "idClaseVenta": 1, "desActividadEconomica": "Venta de frutas",
        "idDireccion": 8301, "idSectorInterno": 67 }
      ```
      `idClaseVenta` y `desActividadEconomica` son **obligatorios**: si faltan, no crear el puesto y avisar al usuario (antes de guardar). `atiendeTitular` queda en `false` si no se manda.
   3. Devolver el `id` del puesto creado para enlazarlo a la sensibilización (10.3).

Esquema del cambio:

```ts
// persisteVenta pasa a devolver el id del puesto nuevo de una NN (o undefined)
const persisteVenta = async (): Promise<number | undefined> => {
  // … código actual (venta del ventero) …
  } else if (!idPersona) {
    if (!ventaBody.idClaseVenta || !ventaBody.desActividadEconomica) {
      throw new Error('Para el puesto de venta indique clase de venta y actividad económica');
    }
    let idDirCreada: number | undefined;
    if (hayDireccion) {
      const dirResp = await direccionInsert(dirBody);
      idDirCreada = extractOneFromSolicitudAPI(dirResp, generalList.direccion)?.id;
    }
    const nuevaVenta: any = { ...ventaBody };          // sin idVentero
    if (idDirCreada) nuevaVenta.idDireccion = idDirCreada;
    const sectorId = form.getFieldValue('idSectorInterno') ?? idSectorTarea ?? initialValues?.idSectorInterno;
    if (sectorId) nuevaVenta.idSectorInterno = sectorId;
    const ventaResp = await datosVentaInsert(nuevaVenta);
    return extractOneFromSolicitudAPI(ventaResp, venteroList.datosVenta)?.id;
  }
};
```

### 10.3 Enlazar el puesto a la sensibilización

`toSubmitValues` hoy hace `delete result.idDatosVenta`. Para NN hay que enviarlo:

```ts
const idPuestoNn = await persisteVenta();
const datos = toSubmitValues(values);
if (idPuestoNn) datos.idDatosVenta = idPuestoNn;   // solo NN
await onSubmit(datos);
```

- Al **crear** (`POST /api/operativa/sensibilizacion`) y al **editar** (`PATCH /api/operativa/sensibilizacion/{id}`), SISDEP guarda el `idDatosVenta` que manda el cliente **solo en NN**. Con vendedor lo ignora y enlaza el puesto del vendedor, así que no hace falta cambiar ese caso.
- Si la NN ya tenía puesto, no hace falta mandar `idDatosVenta`: el PATCH sin esa clave conserva el enlace.

### 10.4 Asignar el vendedor a una NN

No requiere nada nuevo: `PATCH /api/operativa/sensibilizacion/{id}` con `idPersona`. SISDEP pasa el puesto de la NN al vendedor si este no tenía puesto; si ya tenía, enlaza el del vendedor.

### 10.5 Errores

Hoy `persisteVenta` atrapa cualquier error y sigue con *"La sensibilización se guardó de igual forma"*. En NN conviene **no guardar la sensibilización** si falla el puesto (o al menos mostrar el error real), porque es justo lo que hacía perder los datos.

| Endpoint | Código | Causa |
|---|---|---|
| `POST /api/ventero/datosVenta` | `409` | La dirección ya es de otro puesto, o falta clase/actividad |
| `POST /api/ventero/datosVenta` | `403` | El grupo no tiene permiso de escritura en sensibilización |
| `POST /api/general/direccion` | `400` | Faltan `cruceDesde`, `numeroDesde`, `cruceHasta` o `numeroHasta` |

### 10.6 Resumen de cambios en `sisdep-front`

| Archivo | Cambio |
|---|---|
| `SensibilizacionForm.tsx` (efecto de carga) | En NN cargar el puesto con `GET /api/operativa/sensibilizacion/{id}/venta` |
| `SensibilizacionForm.tsx` (`persisteVenta`) | Rama NN: crear dirección + puesto sin ventero; devolver su `id` |
| `SensibilizacionForm.tsx` (`preSubmit`) | Poner `idDatosVenta` del puesto nuevo en lo que se envía; no tragar el error en NN |
| `SensibilizacionCreateForm.tsx` | Sin cambios: ese formulario no captura puesto ni dirección |

Requiere sisdep-back con la migración `V20261019.1` y el commit `bbade07` desplegados.
