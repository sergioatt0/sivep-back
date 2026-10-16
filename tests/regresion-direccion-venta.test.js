'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Token con el formato de SISDEP: solo importan los claims userId y groupId.
function token(userId, groupId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ userId, groupId })}.firma`;
}
const CON_PERMISO = token(40, 5);

// persona -> ventero en SISDEP (SIVEP solo conoce el idPersona).
const PERSONA_A_VENTERO = { 321: 300 };

const DIRECCION_ID = 100123;
const PUESTO_ID = 55;

const SENSIBILIZACION_BASE = {
  id: 100,
  numeroSerie: 'A-100',
  idTipo: 1,
  fecha: '2026-10-01T09:00:00',
  idUsuario: 7,
  idPersona: 321,
  idDatosVenta: PUESTO_ID,
  idSectorInterno: null,
  latitud: 6.25,
  longitud: -75.56,
  localizacion: { type: 'Point', coordinates: [-75.56, 6.25] },
  completo: false
};

/**
 * Mock de SISDEP con estado: mantiene direcciones, puestos de venta y
 * sensibilizaciones. Reproduce la derivación real de idDatosVenta a partir de
 * idPersona (SISDEP ignora el idDatosVenta que envíe el cliente).
 */
function startSisdepMock() {
  return new Promise((resolve) => {
    let state;
    const reset = () => {
      state = {
        direcciones: {}, // id -> direccion creada
        puestos: { [PUESTO_ID]: { id: PUESTO_ID, idVentero: 300, idDireccion: null, nombreEstablecimiento: 'Tienda Doña Ana', observaciones: null } },
        sensis: { 100: { ...SENSIBILIZACION_BASE } },
        siguienteId: { direccion: DIRECCION_ID, puesto: PUESTO_ID + 1, sensi: 200 }
      };
    };
    reset();

    const requests = [];

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = null;
        if (raw) {
          try { body = JSON.parse(raw); } catch { body = raw; }
        }
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;
        const q = Object.fromEntries(url.searchParams);
        requests.push({ method: req.method, path: p, query: q, headers: req.headers, body });

        const ok = (status, json) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
        };
        const ent = (nombre, filas) => ({ entities: { [nombre]: Object.fromEntries(filas.map((f) => [f.id, f])) } });

        if (!req.headers['x-access']) return ok(401, { message: 'Token inválido' });

        // ---- Direcciones ----
        if (p === '/api/general/direccion' && req.method === 'POST') {
          const nueva = { ...(body || {}), id: state.siguienteId.direccion++ };
          state.direcciones[nueva.id] = nueva;
          return ok(200, nueva);
        }
        let m = p.match(/^\/api\/general\/direccion\/(\d+)$/);
        if (m && req.method === 'PATCH') {
          const id = Number(m[1]);
          state.direcciones[id] = { ...(state.direcciones[id] || {}), ...(body || {}), id };
          return ok(200, state.direcciones[id]);
        }

        // ---- Puesto de venta (datos_venta) ----
        if (p === '/api/ventero/datosVenta' && req.method === 'GET') {
          const filas = Object.values(state.puestos).filter((x) => !q.idVentero || String(x.idVentero) === q.idVentero);
          return ok(200, ent('datosVenta', filas));
        }
        if (p === '/api/ventero/datosVenta' && req.method === 'POST') {
          const nuevo = { ...(body || {}), id: state.siguienteId.puesto++ };
          state.puestos[nuevo.id] = nuevo;
          return ok(201, nuevo);
        }
        m = p.match(/^\/api\/ventero\/datosVenta\/(\d+)$/);
        if (m) {
          const id = Number(m[1]);
          const actual = state.puestos[id];
          if (!actual) return ok(404, { errors: [{ title: 'No encontrado', detail: 'Puesto no encontrado' }] });
          if (req.method === 'GET') return ok(200, actual);
          if (req.method === 'PATCH') {
            // SISDEP ignora el id del cuerpo: manda el de la URL.
            const { id: _ignorado, ...cambios } = body || {};
            Object.assign(actual, cambios);
            return ok(200, actual);
          }
        }

        // ---- Fichas de la sensibilización (vacías en el mock) ----
        m = p.match(/^\/api\/operativa\/(sensibilizacionFormales|sensibilizacionInformales)$/);
        if (m) return ok(200, ent(m[1], []));

        // ---- Sensibilización: venta (sensibilización + puesto + dirección) ----
        m = p.match(/^\/api\/operativa\/sensibilizacion\/(\d+)\/venta$/);
        if (m) {
          const s = state.sensis[m[1]];
          if (!s) return ok(404, { errors: [{ title: 'No encontrado', detail: 'Item no encontrado.' }] });
          const puesto = s.idDatosVenta != null ? state.puestos[s.idDatosVenta] : null;
          const direccion = puesto && puesto.idDireccion != null ? state.direcciones[puesto.idDireccion] ?? null : null;
          return ok(200, { ...s, datosVenta: puesto ? { ...puesto, direccion } : null, titular: null });
        }

        // ---- Sensibilización: lista y creación ----
        if (p === '/api/operativa/sensibilizacion' && req.method === 'GET') {
          const filas = Object.values(state.sensis).filter((s) => !q.numeroSerie || s.numeroSerie === q.numeroSerie);
          return ok(200, ent('sensibilizacion', filas));
        }
        if (p === '/api/operativa/sensibilizacion' && req.method === 'POST') {
          // SISDEP deriva el puesto desde el idPersona e ignora el idDatosVenta del cliente.
          const idVentero = PERSONA_A_VENTERO[body?.idPersona] ?? null;
          const puesto = idVentero == null ? null : Object.values(state.puestos).find((x) => x.idVentero === idVentero) ?? null;
          const nueva = {
            ...(body || {}),
            id: state.siguienteId.sensi++,
            idDatosVenta: puesto ? puesto.id : null,
            esNn: body?.idPersona == null
          };
          state.sensis[nueva.id] = nueva;
          return ok(201, ent('sensibilizacion', [nueva]));
        }

        // ---- Sensibilización: detalle y edición ----
        m = p.match(/^\/api\/operativa\/sensibilizacion\/(\d+)$/);
        if (m) {
          const s = state.sensis[m[1]];
          if (!s) return ok(404, { errors: [{ title: 'No encontrado', detail: 'Item no encontrado.' }] });
          if (req.method === 'GET') return ok(200, ent('sensibilizacion', [s]));
          if (req.method === 'PATCH') {
            Object.assign(s, body || {});
            return ok(200, ent('sensibilizacion', [s]));
          }
        }

        // ---- Permisos ----
        if (p === '/api/seguridad/permisoModuloGrupo') {
          return ok(200, ent('permisoModuloGrupo', [{
            id: 1, idGrupo: Number(q.idGrupo), idModuloSistema: Number(q.idModuloSistema), leer: true, escribir: Number(q.idGrupo) === 5
          }]));
        }

        ok(404, { message: 'Ruta mock no reconocida: ' + req.method + ' ' + req.url });
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        requests,
        get state() { return state; },
        reset: () => { reset(); requests.length = 0; },
        clearRequests: () => { requests.length = 0; }
      });
    });
  });
}

function httpRequest(port, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: { ...headers, ...(data ? { 'Content-Length': data.length, 'Content-Type': 'application/json' } : {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('Regresión: dirección -> puesto de venta -> sensibilización', () => {
  let sisdep;
  let appServer;
  let port;

  const ultimo = () => sisdep.requests.at(-1);
  const enviadosA = (metodo, ruta) => sisdep.requests.filter((r) => r.method === metodo && r.path === ruta);

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    port = appServer.address().port;
  });

  beforeEach(() => sisdep.reset());

  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  // ============================================================
  // Cadena completa
  // ============================================================
  describe('cadena completa', () => {
    test('la dirección creada y enlazada en datos_venta llega a la sensibilización', async () => {
      // 1) Crear la dirección con localizacion GeoJSON.
      const dir = await httpRequest(port, 'POST', '/general/direccion', { 'x-access': 'tok' }, {
        cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, numero: 15,
        idMunicipio: 1, idComuna: 10, idBarrio: 105,
        localizacion: { type: 'Point', coordinates: [-75.5814, 6.2476] }
      });
      assert.equal(dir.status, 200);
      const idDireccion = dir.body.id;
      assert.equal(idDireccion, DIRECCION_ID);
      // SISDEP guarda la geometría en 3D: el proxy normaliza antes de enviarla.
      assert.equal(ultimo().path, '/api/general/direccion');
      assert.equal(ultimo().body.localizacion, 'POINT Z (-75.5814 6.2476 0)');
      assert.equal(sisdep.state.direcciones[idDireccion].localizacion, 'POINT Z (-75.5814 6.2476 0)');

      // 2) Leer el puesto del ventero: todavía no tiene dirección.
      const puesto = await httpRequest(port, 'GET', '/ventero/300/puesto', { 'x-access': 'tok' });
      assert.equal(puesto.status, 200);
      assert.equal(puesto.body.length, 1);
      assert.equal(puesto.body[0].id, PUESTO_ID);
      assert.equal(puesto.body[0].idDireccion, null);

      // 3) Enlazar la dirección al puesto.
      const enlace = await httpRequest(port, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`, { 'x-access': 'tok' }, { idDireccion });
      assert.equal(enlace.status, 200);
      assert.equal(enlace.body.idDireccion, idDireccion);
      assert.equal(ultimo().path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(sisdep.state.puestos[PUESTO_ID].idDireccion, idDireccion);

      // 4) Crear la sensibilización del ventero (sin idDatosVenta: lo deriva SISDEP).
      const creada = await httpRequest(port, 'POST', '/operativa/sensibilizacion', { 'x-access': CON_PERMISO }, {
        numeroSerie: 'R-1', idTipo: 1, fecha: '2026-10-20T09:00:00', idPersona: 321,
        latitud: 6.2476, longitud: -75.5814
      });
      assert.equal(creada.status, 201);
      const idSensi = creada.body.sensibilizacion.id;
      assert.equal(idSensi, 200);

      const enviadoPost = enviadosA('POST', '/api/operativa/sensibilizacion')[0].body;
      assert.equal(enviadoPost.idDatosVenta, undefined, 'SIVEP no debe inventar el puesto');
      assert.equal(enviadoPost.localizacion, 'POINT (-75.5814 6.2476)', 'deriva la geometría desde lat/long');
      assert.equal(sisdep.state.sensis[idSensi].idDatosVenta, PUESTO_ID, 'SISDEP derivó el puesto desde idPersona');

      // 5) El detalle debe devolver la dirección enlazada.
      const detalle = await httpRequest(port, 'GET', `/operativa/sensibilizacion/${idSensi}`, { 'x-access': CON_PERMISO });
      assert.equal(detalle.status, 200);
      assert.equal(detalle.body.sensibilizacion.id, idSensi);
      assert.equal(detalle.body.datosVenta.id, PUESTO_ID);
      assert.equal(detalle.body.datosVenta.idDireccion, idDireccion);
      assert.equal(detalle.body.datosVenta.direccion.id, idDireccion);
      assert.equal(detalle.body.datosVenta.direccion.idBarrio, 105);
      assert.equal(detalle.body.datosVenta.direccion.localizacion, 'POINT Z (-75.5814 6.2476 0)');
    });

    test('sin enlazar la dirección, el detalle no trae dirección (control negativo)', async () => {
      const creada = await httpRequest(port, 'POST', '/operativa/sensibilizacion', { 'x-access': CON_PERMISO }, {
        numeroSerie: 'R-2', idTipo: 1, fecha: '2026-10-21T09:00:00', idPersona: 321, idDatosVenta: 99999
      });
      assert.equal(creada.status, 201);
      const idSensi = creada.body.sensibilizacion.id;

      const detalle = await httpRequest(port, 'GET', `/operativa/sensibilizacion/${idSensi}`, { 'x-access': CON_PERMISO });
      assert.equal(detalle.status, 200);
      assert.equal(detalle.body.datosVenta.id, PUESTO_ID, 'SISDEP ignora el idDatosVenta del cliente');
      assert.equal(detalle.body.datosVenta.idDireccion, null);
      assert.equal(detalle.body.datosVenta.direccion, null);
    });

    test('la dirección sobrevive a la edición de la sensibilización', async () => {
      const dir = await httpRequest(port, 'POST', '/general/direccion', { 'x-access': 'tok' }, {
        cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, idMunicipio: 1,
        localizacion: { type: 'Point', coordinates: [-75.5, 6.2] }
      });
      assert.equal(dir.status, 200);
      const dirId = dir.body.id;
      assert.equal(typeof dirId, 'number');
      await httpRequest(port, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`, { 'x-access': 'tok' }, { idDireccion: dirId });

      const editada = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO },
        { observaciones: 'completada', latitud: 6.3, longitud: -75.6 });
      assert.equal(editada.status, 200);
      assert.equal(ultimo().body.localizacion, 'POINT (-75.6 6.3)');
      assert.equal(ultimo().body.idDatosVenta, PUESTO_ID, 'el PATCH conserva el puesto');

      const detalle = await httpRequest(port, 'GET', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO });
      assert.equal(detalle.body.datosVenta.direccion.id, dirId);
    });
  });

  // ============================================================
  // Escritura del puesto de venta (datosVenta)
  // ============================================================
  describe('POST|PATCH /ventero/datosVenta[/:id] (casos no cubiertos)', () => {
    test('PATCH con id no numérico: 400 y no llama a SISDEP', async () => {
      sisdep.clearRequests();
      const { status, body } = await httpRequest(port, 'PATCH', '/ventero/datosVenta/1.5',
        { 'x-access': 'tok' }, { idDireccion: DIRECCION_ID });
      assert.equal(status, 400);
      assert.match(body.message, /ID inválido/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('POST sin x-access: 401 y no llama a SISDEP', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(port, 'POST', '/ventero/datosVenta', {}, { idVentero: 300 });
      assert.equal(status, 401);
      assert.equal(sisdep.requests.length, 0);
    });

    test('PATCH de un puesto inexistente: propaga el 404 del upstream', async () => {
      const { status, body } = await httpRequest(port, 'PATCH', '/ventero/datosVenta/7777',
        { 'x-access': 'tok' }, { idDireccion: DIRECCION_ID });
      assert.equal(status, 404);
      assert.equal(body.success, false);
      assert.match(body.message, /Puesto no encontrado/);
    });

    test('PATCH reenvía el id de la URL en la ruta', async () => {
      const { status } = await httpRequest(port, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idDireccion: DIRECCION_ID });
      assert.equal(status, 200);
      assert.equal(ultimo().path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(sisdep.state.puestos[PUESTO_ID].idDireccion, DIRECCION_ID);
    });

    // Documenta el comportamiento actual: a diferencia del POST, el PATCH no
    // descarta el id del cuerpo (viaja tal cual a SISDEP).
    test('documenta: el PATCH no descarta el id del cuerpo', async () => {
      sisdep.clearRequests();
      await httpRequest(port, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`, { 'x-access': 'tok' },
        { id: 999, idDireccion: DIRECCION_ID });
      const enviado = ultimo();
      assert.equal(enviado.path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(enviado.body.id, 999);
      assert.equal(sisdep.state.puestos[PUESTO_ID].id, PUESTO_ID, 'el mock ignora el id del cuerpo');
    });
  });

  // ============================================================
  // Normalización de la geometría en /general/direccion
  // ============================================================
  describe('normalización POINT Z en /general/direccion (casos no cubiertos)', () => {
    async function postDireccion(localizacion) {
      const payload = { cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, idMunicipio: 1 };
      if (localizacion !== undefined) payload.localizacion = localizacion;
      const r = await httpRequest(port, 'POST', '/general/direccion', { 'x-access': 'tok' }, payload);
      return { r, enviado: ultimo().body };
    }

    test('localizacion null se reenvía como null, no se omite', async () => {
      sisdep.clearRequests();
      const { enviado } = await postDireccion(null);
      assert.equal(Object.prototype.hasOwnProperty.call(enviado, 'localizacion'), true);
      assert.equal(enviado.localizacion, null);
    });

    test('WKT que no es POINT se reenvía sin cambios', async () => {
      const { enviado } = await postDireccion('LINESTRING (0 0, 1 1)');
      assert.equal(enviado.localizacion, 'LINESTRING (0 0, 1 1)');
    });

    test('GeoJSON que no es Point se reenvía sin cambios', async () => {
      const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-75.5, 6.2] } };
      const { enviado } = await postDireccion(feature);
      assert.deepEqual(enviado.localizacion, feature);
    });

    test('GeoJSON con z explícito cero conserva el cero', async () => {
      const { enviado } = await postDireccion({ type: 'Point', coordinates: [-75.5, 6.2, 0] });
      assert.equal(enviado.localizacion, 'POINT Z (-75.5 6.2 0)');
    });

    test('PATCH WKT 2D -> POINT Z', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(port, 'PATCH', '/general/direccion/9', { 'x-access': 'tok' },
        { localizacion: 'POINT (-75.5814 6.2476)' });
      assert.equal(status, 200);
      assert.equal(ultimo().path, '/api/general/direccion/9');
      assert.equal(ultimo().body.localizacion, 'POINT Z (-75.5814 6.2476 0)');
    });

    test('PATCH WKT 3D se reenvía sin cambios', async () => {
      const { status } = await httpRequest(port, 'PATCH', '/general/direccion/9', { 'x-access': 'tok' },
        { localizacion: 'POINT Z (-75.5814 6.2476 12)' });
      assert.equal(status, 200);
      assert.equal(ultimo().body.localizacion, 'POINT Z (-75.5814 6.2476 12)');
    });
  });

  // ============================================================
  // Geometría de la sensibilización
  // ============================================================
  describe('derivación de localizacion en sensibilizaciones (casos no cubiertos)', () => {
    test('POST no deriva si falta latitud o longitud', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', { 'x-access': CON_PERMISO }, {
        numeroSerie: 'R-3', idTipo: 1, fecha: '2026-10-22T09:00:00', idPersona: 321, longitud: -75.5
      });
      assert.equal(status, 201);
      const enviado = enviadosA('POST', '/api/operativa/sensibilizacion')[0].body;
      assert.equal(enviado.localizacion, undefined);
      assert.equal(enviado.latitud, undefined);
    });

    test('PATCH cambiando solo la longitud usa la latitud guardada', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO },
        { longitud: -75.6 });
      assert.equal(status, 200);
      const enviado = enviadosA('PATCH', '/api/operativa/sensibilizacion/100')[0].body;
      assert.equal(enviado.localizacion, 'POINT (-75.6 6.25)');
      assert.equal(enviado.latitud, 6.25);
    });

    test('PATCH sin coordenadas conserva la geometría guardada', async () => {
      sisdep.clearRequests();
      await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO }, { observaciones: 'x' });
      const enviado = enviadosA('PATCH', '/api/operativa/sensibilizacion/100')[0].body;
      assert.equal(enviado.localizacion, 'POINT (-75.56 6.25)');
    });

    // Documenta el comportamiento actual: si el payload trae latitud/longitud y
    // localizacion, el merge deja el localizacion del payload tal cual.
    test('documenta: un localizacion explícito gana sobre el derivado', async () => {
      sisdep.clearRequests();
      await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO },
        { latitud: 6.3, longitud: -75.7, localizacion: 'POINT (1 2)' });
      const enviado = enviadosA('PATCH', '/api/operativa/sensibilizacion/100')[0].body;
      assert.equal(enviado.localizacion, 'POINT (1 2)');
      assert.equal(enviado.latitud, 6.3);
      assert.equal(enviado.longitud, -75.7);
    });

    // Documenta el comportamiento actual: un localizacion GeoJSON se reenvía sin
    // normalizar a WKT 3D (a diferencia de /general/direccion).
    test('documenta: un localizacion GeoJSON no se normaliza', async () => {
      sisdep.clearRequests();
      const geojson = { type: 'Point', coordinates: [-75.7, 6.3] };
      await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO },
        { localizacion: geojson });
      const enviado = enviadosA('PATCH', '/api/operativa/sensibilizacion/100')[0].body;
      assert.deepEqual(enviado.localizacion, geojson);
    });

    // Documenta el comportamiento actual: borrar latitud (null) no borra la
    // geometría vieja, así que el registro queda con datos contradictorios.
    test('documenta: latitud null conserva la geometría anterior', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO },
        { latitud: null, longitud: null });
      assert.equal(status, 200);
      const enviado = enviadosA('PATCH', '/api/operativa/sensibilizacion/100')[0].body;
      assert.equal(enviado.latitud, null);
      assert.equal(enviado.longitud, null);
      assert.equal(enviado.localizacion, 'POINT (-75.56 6.25)');
    });
  });
});
