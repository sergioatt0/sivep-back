# Sensibilización NN con puesto de venta — instrucciones para el front de SIVEP

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
