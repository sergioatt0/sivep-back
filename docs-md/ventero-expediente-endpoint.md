# Endpoint `GET /ventero/:id/expediente`

Proxy autenticado al expediente completo del ventero en SISDEP. Reenvía la respuesta del upstream tal cual al frontend (sin envolverla en `{ success, data }`), así el cliente consume la misma estructura que SISDEP devuelve.

## Resumen

| Atributo            | Valor                                                                  |
|---------------------|------------------------------------------------------------------------|
| Método              | `GET`                                                                  |
| Ruta backend        | `/ventero/:id/expediente`                                              |
| Upstream SISDEP     | `${SISDEP_BASE_URL}/api/ventero/ventero/{id}/expediente`               |
| Autenticación       | Header `x-access: <jwt>` (obligatorio)                                 |
| Validación de `id`  | Debe ser numérico (regex `^\d+$`)                                      |
| Timeout upstream    | 15 segundos                                                            |
| CORS                | Sujeto a `ALLOWED_ORIGINS`                                             |

## Request

### Parámetros de ruta

| Nombre | Tipo    | Requerido | Descripción                  |
|--------|---------|-----------|------------------------------|
| `id`   | integer | sí        | ID del ventero en SISDEP.    |

### Headers

| Header     | Requerido | Descripción                                              |
|------------|-----------|----------------------------------------------------------|
| `x-access` | sí        | JWT obtenido del endpoint `POST /login`.                 |
| `Accept`   | no        | Recomendado: `application/json`.                         |

### Ejemplo curl

```bash
TOKEN="<token devuelto por /login>"
curl -s http://localhost:5001/ventero/1/expediente \
  -H "x-access: $TOKEN" \
  -H 'Accept: application/json'
```

## Response

### `200 OK` — Estructura

La respuesta es un passthrough del upstream SISDEP. El frontend la consume con la misma forma:

```json
{
  "ventero": {
    "id": 1,
    "esRegulado": true,
    "idEstadoCivil": 2,
    "idProteccionConstitucional": [],
    "grupoSisben": 13,
    "idMunicipioSisben": 1,
    "idEscolaridad": 2,
    "tituloObtenido": "4 DE PRIMARIA",
    "municipioNacimiento": "AMALFI",
    "departamentoNacimiento": "ANTIOQUIA",
    "esCancelado": false,
    "enlaceEscanerFormato": "https://sisdep.innovacion.it.com/sisdep/back/api/archivos/pdf-venteros/1769604557844.pdf",
    "idUsuarioRegistra": 0,
    "hojaVidaPrestada": false,
    "enlace": "https://sisdep.innovacion.it.com/sisdep/back/fotos-ventero/1770123847461.jpg",
    "estrato": 2,
    "esFallecido": false,
    "consecutivo": 1,
    "sabeFirmar": false,
    "reubicacion": false,
    "referenciaReubicacion": null
  },
  "persona": {
    "id": 1,
    "nombre1": "ABELARDO",
    "apellido1": "MUÑOZ",
    "idTipoDocumento": 1,
    "documento": "7249378",
    "fechaExpedicion": "1981-11-02T19:00:00",
    "lugarExpedicion": "PAZ DE RÍO",
    "idNacionalidad": 1,
    "idDireccionResidencia": 5,
    "fechaRegistro": "2022-09-18T19:00:00",
    "idSexo": 3,
    "idTipoPersona": 1,
    "esFormal": true,
    "telefonoCelular": 3126884807,
    "fechaNacimiento": "1963-02-09T19:00:00"
  },
  "direccionResidencia": {
    "id": 5,
    "cruceDesde": 1,
    "numeroDesde": 33,
    "cruceHasta": 2,
    "numeroHasta": 74,
    "letraHasta": "E",
    "idMunicipio": 1,
    "idBarrio": 77,
    "idComuna": 16,
    "localizacion": null
  },
  "datosVenta": [
    {
      "id": 2,
      "idClaseVenta": 3,
      "idDireccion": 4989,
      "idTipologiaVenta": 7,
      "idActividadEconomicaActual": 2,
      "desActividadEconomica": "COMESTIBLES VARIOS",
      "atiendeTitular": true,
      "idVentero": 1,
      "idDia": [1, 2, 3, 4, 5, 6],
      "horaInicio": 11,
      "horaFin": 21,
      "idAmoblamiento": 258,
      "direccion": {
        "id": 4989,
        "cruceDesde": 1,
        "numeroDesde": 65,
        "cruceHasta": 2,
        "numeroHasta": 74,
        "idMunicipio": 1,
        "idBarrio": 262,
        "idComuna": 7,
        "localizacion": null
      },
      "amoblamiento": {
        "id": 258,
        "idTenenciaPropiedad": 3,
        "idTipoModulo": 24,
        "idTipoOtroModulo": 3,
        "idEstado": 1,
        "tieneServiciosPublicos": false,
        "frente": 2.25,
        "fondo": 3.5,
        "alto": 2.4
      },
      "terceros": []
    }
  ]
}
```

### Códigos de error

| Código | Cuándo ocurre                                                       | Body                                                                |
|--------|---------------------------------------------------------------------|---------------------------------------------------------------------|
| 400    | `id` no es numérico                                                 | `{ "success": false, "message": "ID inválido: debe ser numérico" }` |
| 401    | Falta header `x-access`                                             | `{ "success": false, "message": "Token no proporcionado" }`         |
| 4xx    | SISDEP rechaza la petición (token vencido, sin permisos, no existe) | `{ "success": false, "message": "<mensaje SISDEP>" }`               |
| 504    | SISDEP no responde dentro del timeout (15s)                         | `{ "success": false, "message": "El servidor remoto no respondió" }`|
| 500    | Error inesperado en el proxy                                        | `{ "success": false, "message": "Error interno del proxy" }`        |

## Diferencia con `/ventero-completo/:id`

| Aspecto             | `/ventero-completo/:id`                                       | `/ventero/:id/expediente`                                  |
|---------------------|---------------------------------------------------------------|------------------------------------------------------------|
| Llamadas a SISDEP   | 2 (`/ventero/{id}` y `/persona/{id}`) en paralelo             | 1 (`/ventero/{id}/expediente`)                             |
| Forma de respuesta  | `{ success, ventero, persona }`                               | Passthrough del upstream                                   |
| Datos incluidos     | Ventero + persona                                             | Ventero + persona + dirección + datos de venta + amoblamiento |
| Caso de uso         | Vista resumida                                                | Vista completa de expediente                               |

## Variables de entorno relevantes

| Variable           | Descripción                                                  |
|--------------------|--------------------------------------------------------------|
| `SISDEP_BASE_URL`  | Base URL del API SISDEP (sin slash final).                   |
| `ALLOWED_ORIGINS`  | Lista de orígenes permitidos por CORS, separados por coma.   |

## Tests

Ver `tests/ventero-expediente.test.ts`. La suite levanta un servidor mock de SISDEP en `127.0.0.1` y valida:

- 200 con passthrough idéntico de la estructura del expediente.
- 401 cuando falta `x-access`.
- 400 cuando `id` no es numérico (protege de path injection).
- 5xx/4xx propagados correctamente desde el upstream.
- 504 cuando el upstream no responde a tiempo.

Ejecutar con:

```bash
npm test
```
