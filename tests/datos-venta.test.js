'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const PUESTO_ID = 55;
const VENTERO_ID = 300;

const DATOS_VENTA_FIXTURE = {
  id: PUESTO_ID,
  idVentero: VENTERO_ID,
  idClaseVenta: 1,
  desActividadEconomica: 'Comercio al por menor',
  idDireccion: 100123,
  nombreEstablecimiento: 'Tienda Doña Ana',
  observaciones: null
};

/**
 * Mock con estado de SISDEP. Ahora el POST del proxy es un upsert: primero lee
 * el puesto del ventero (GET por idVentero) y, si existe, actualiza con PATCH.
 */
function startSisdepMock() {
  return new Promise((resolve) => {
    let mode = 'ok'; // 'ok' | 'conflict' | 'reglaNegocio' | 'sinPermiso' | 'getDetalleFalla'
    let puestos;
    let siguienteId;
    const requests = [];

    const reset = () => {
      puestos = { [PUESTO_ID]: { ...DATOS_VENTA_FIXTURE } };
      siguienteId = PUESTO_ID + 1;
    };
    reset();

    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        let body = null;
        if (rawBody.length) {
          try { body = JSON.parse(rawBody.toString('utf8')); } catch { body = rawBody.toString('utf8'); }
        }
        requests.push({ method: req.method, path: req.url, headers: req.headers, body });

        if (!req.headers['x-access']) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: 'Token inválido' }));
        }

        res.setHeader('Content-Type', 'application/json');

        // ---- Catálogo de clase de venta ----
        if (req.method === 'GET' && /^\/api\/dominios\/claseVenta(\?.*)?$/.test(req.url)) {
          res.statusCode = 200;
          return res.end(JSON.stringify({
            entities: { claseVenta: {
              1: { id: 1, descripcion: 'Ambulante' },
              2: { id: 2, descripcion: 'Semiestacionaria' },
              3: { id: 3, descripcion: 'Estacionaria' }
            } }
          }));
        }

        // ---- GET /datosVenta (lista por idVentero) ----
        if (req.method === 'GET' && /^\/api\/ventero\/datosVenta(\?.*)?$/.test(req.url)) {
          const idVentero = new URL(req.url, 'http://x').searchParams.get('idVentero');
          const filas = Object.values(puestos)
            .filter((x) => !idVentero || String(x.idVentero) === String(idVentero));
          res.statusCode = 200;
          return res.end(JSON.stringify({
            entities: { datosVenta: Object.fromEntries(filas.map((f) => [f.id, f])) }
          }));
        }

        const porId = req.url.match(/^\/api\/ventero\/datosVenta\/(\d+)$/);

        // ---- GET /datosVenta/:id (puesto actual) ----
        if (req.method === 'GET' && porId) {
          if (mode === 'getDetalleFalla') {
            res.statusCode = 500;
            return res.end(JSON.stringify({ message: 'Error interno' }));
          }
          const actual = puestos[Number(porId[1])];
          if (!actual) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ errors: [{ title: 'No encontrado', detail: 'Puesto no encontrado' }] }));
          }
          res.statusCode = 200;
          return res.end(JSON.stringify(actual));
        }

        // ---- POST /datosVenta (crear) ----
        if (req.method === 'POST' && req.url === '/api/ventero/datosVenta') {
          if (mode === 'sinPermiso') {
            res.statusCode = 403;
            return res.end(JSON.stringify({ message: 'No autorizado' }));
          }
          if (mode === 'conflict') {
            res.statusCode = 409;
            return res.end(JSON.stringify({ message: 'El ventero ya tiene un puesto de venta' }));
          }
          const nuevo = { ...(body || {}), id: siguienteId++ };
          puestos[nuevo.id] = nuevo;
          res.statusCode = 201;
          return res.end(JSON.stringify(nuevo));
        }

        // ---- PATCH /datosVenta/:id ----
        if (req.method === 'PATCH' && porId) {
          const id = Number(porId[1]);
          if (mode === 'sinPermiso') {
            res.statusCode = 403;
            return res.end(JSON.stringify({ message: 'No autorizado' }));
          }
          if (mode === 'conflict') {
            res.statusCode = 409;
            return res.end(JSON.stringify({ message: 'El ventero ya tiene un puesto de venta' }));
          }
          if (mode === 'reglaNegocio') {
            res.statusCode = 409;
            return res.end(JSON.stringify({ detail: 'La operación viola una regla de negocio.' }));
          }
          const actual = puestos[id];
          if (!actual) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ errors: [{ title: 'No encontrado', detail: 'Puesto no encontrado' }] }));
          }
          const { id: _ignorado, ...cambios } = body || {};
          Object.assign(actual, cambios);
          res.statusCode = 200;
          return res.end(JSON.stringify(actual));
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'Ruta mock no reconocida: ' + req.method + ' ' + req.url }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        setMode: (m) => { mode = m; },
        reset: () => { reset(); requests.length = 0; mode = 'ok'; },
        borrarPuesto: (id) => { delete puestos[id]; },
        getPuesto: (id) => puestos[id],
        requests,
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

describe('Puesto de venta (datos_venta) proxy', () => {
  let sisdep, appServer, appPort;

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    appPort = appServer.address().port;
  });

  beforeEach(() => sisdep.reset());

  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  // ---------- POST /ventero/datosVenta (upsert) ----------
  describe('POST /ventero/datosVenta', () => {
    test('upsert: con puesto existente hace PATCH fusionado con el id y devuelve su respuesta', async () => {
      const payload = { idVentero: VENTERO_ID, idDireccion: 100123, nombreEstablecimiento: 'Tienda Doña Ana' };
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta', { 'x-access': 'tok' }, payload);
      assert.equal(status, 200);

      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'PATCH');
      assert.equal(last.path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(last.body.id, PUESTO_ID, 'SISDEP exige el id de la ruta en el cuerpo');
      assert.equal(last.body.idVentero, VENTERO_ID);
      assert.equal(last.body.idClaseVenta, 1, 'conserva los valores actuales');
      assert.equal(last.body.idDireccion, 100123);

      assert.equal(body.idVentero, VENTERO_ID);
      assert.equal(body.idDireccion, 100123);
    });

    test('crea (201) cuando el ventero no tiene puesto, con los campos obligatorios', async () => {
      sisdep.borrarPuesto(PUESTO_ID);
      const payload = { idVentero: VENTERO_ID, idClaseVenta: 2, desActividadEconomica: 'Semiestacionaria', idDireccion: 100123 };
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta', { 'x-access': 'tok' }, payload);
      assert.equal(status, 201);

      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'POST');
      assert.equal(last.path, '/api/ventero/datosVenta');
      assert.equal(last.body.id, undefined, 'SISDEP asigna el id');
      assert.equal(last.body.idVentero, VENTERO_ID);
      assert.equal(last.body.idClaseVenta, 2);
      assert.equal(body.idVentero, VENTERO_ID);
    });

    test('descarta el id del cuerpo: en el upsert manda el id existente', async () => {
      await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { id: 999, idVentero: VENTERO_ID, idDireccion: 100123 });
      const last = sisdep.requests.at(-1);
      assert.equal(last.path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(last.body.id, PUESTO_ID);
      assert.equal(last.body.idVentero, VENTERO_ID);
    });

    test('422 al crear sin idVentero (no llama a SISDEP)', async () => {
      sisdep.borrarPuesto(PUESTO_ID);
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idClaseVenta: 1, desActividadEconomica: 'Comercio' });
      assert.equal(status, 422);
      assert.equal(body.success, false);
      assert.equal(body.codigo, 'DATOS_INVALIDOS');
      assert.match(body.message, /idVentero/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('422 al crear sin idClaseVenta', async () => {
      sisdep.borrarPuesto(PUESTO_ID);
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_ID, desActividadEconomica: 'Comercio' });
      assert.equal(status, 422);
      assert.match(body.message, /idClaseVenta/);
    });

    test('422 al crear con desActividadEconomica vacía', async () => {
      sisdep.borrarPuesto(PUESTO_ID);
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_ID, idClaseVenta: 1, desActividadEconomica: '   ' });
      assert.equal(status, 422);
      assert.match(body.message, /desActividadEconomica/);
    });

    test('422 al crear con idClaseVenta fuera del catálogo (no llama a SISDEP)', async () => {
      sisdep.borrarPuesto(PUESTO_ID);
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_ID, idClaseVenta: 4, desActividadEconomica: 'Comercio' });
      assert.equal(status, 422);
      assert.equal(body.codigo, 'DATOS_INVALIDOS');
      assert.match(body.message, /idClaseVenta/);
      assert.equal(sisdep.requests.filter((r) => r.method === 'POST').length, 0);
    });

    test('propaga 409 cuando el ventero ya tiene puesto', async () => {
      sisdep.setMode('conflict');
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_ID, idDireccion: 100123 });
      assert.equal(status, 409);
      assert.equal(body.success, false);
      assert.match(body.message, /ya tiene un puesto/);
    });

    test('403 de SISDEP: mensaje claro de permiso sobre el puesto de venta', async () => {
      sisdep.setMode('sinPermiso');
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_ID, idDireccion: 100123 });
      assert.equal(status, 403);
      assert.equal(body.success, false);
      assert.match(body.message, /Sin permiso para escribir el puesto de venta/);
    });

    test('401 sin x-access', async () => {
      const { status } = await httpRequest(appPort, 'POST', '/ventero/datosVenta', {}, { idVentero: VENTERO_ID });
      assert.equal(status, 401);
    });
  });

  // ---------- PATCH /ventero/datosVenta/:id ----------
  describe('PATCH /ventero/datosVenta/:id', () => {
    test('200 envía el registro fusionado (id de la ruta + cambios) y devuelve la respuesta', async () => {
      const { status, body } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idDireccion: 100123 });
      assert.equal(status, 200);

      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'PATCH');
      assert.equal(last.path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(last.body.id, PUESTO_ID);
      assert.equal(last.body.idVentero, VENTERO_ID, 'completa con el registro actual');
      assert.equal(last.body.idClaseVenta, 1);
      assert.equal(last.body.idDireccion, 100123);

      assert.equal(body.id, PUESTO_ID);
      assert.equal(body.idDireccion, 100123);
    });

    test('no envía null en las columnas NOT NULL: conserva el valor actual', async () => {
      const { status } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idClaseVenta: null, idDireccion: 555 });
      assert.equal(status, 200);

      const last = sisdep.requests.at(-1);
      assert.equal(Object.prototype.hasOwnProperty.call(last.body, 'idClaseVenta'), false);
      assert.equal(last.body.idDireccion, 555);
      assert.equal(sisdep.getPuesto(PUESTO_ID).idClaseVenta, 1);
    });

    test('fail-open: si no se puede leer el puesto, igual inyecta el id y reenvía', async () => {
      sisdep.setMode('getDetalleFalla');
      const { status } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idDireccion: 777 });
      assert.equal(status, 200);

      const last = sisdep.requests.at(-1);
      assert.equal(last.path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(last.body.id, PUESTO_ID);
      assert.equal(last.body.idDireccion, 777);
      assert.equal(Object.prototype.hasOwnProperty.call(last.body, 'idVentero'), false);
    });

    test('422 con idClaseVenta fuera del catálogo (no llama a SISDEP)', async () => {
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idClaseVenta: 4, desActividadEconomica: 'Comercio' });
      assert.equal(status, 422);
      assert.equal(body.codigo, 'DATOS_INVALIDOS');
      assert.match(body.message, /idClaseVenta/);
      assert.equal(sisdep.requests.filter((r) => r.method === 'PATCH').length, 0);
    });

    test('409 genérico con idClaseVenta en el cuerpo: 422 nombrando el campo', async () => {
      sisdep.setMode('reglaNegocio');
      const { status, body } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idClaseVenta: 1, desActividadEconomica: 'Comercio' });
      assert.equal(status, 422);
      assert.equal(body.codigo, 'DATOS_INVALIDOS');
      assert.match(body.message, /idClaseVenta/);
    });

    test('403 de SISDEP: mensaje claro de permiso sobre el puesto de venta', async () => {
      sisdep.setMode('sinPermiso');
      const { status, body } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idDireccion: 100123 });
      assert.equal(status, 403);
      assert.match(body.message, /Sin permiso para escribir el puesto de venta/);
    });

    test('400 con id no numérico', async () => {
      const { status, body } = await httpRequest(appPort, 'PATCH', '/ventero/datosVenta/abc',
        { 'x-access': 'tok' }, { idDireccion: 100123 });
      assert.equal(status, 400);
      assert.match(body.message, /ID inválido/);
    });

    test('propaga 409 cuando el ventero ya tiene puesto', async () => {
      sisdep.setMode('conflict');
      const { status, body } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idDireccion: 100123 });
      assert.equal(status, 409);
      assert.equal(body.success, false);
    });

    test('401 sin x-access', async () => {
      const { status } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`, {}, { idDireccion: 100123 });
      assert.equal(status, 401);
    });
  });

  // ---------- GET /ventero/:id/puesto (lectura existente) ----------
  describe('GET /ventero/:id/puesto', () => {
    test('200 devuelve la lista de datosVenta del ventero', async () => {
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'GET', `/ventero/${VENTERO_ID}/puesto`, { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body[0].id, PUESTO_ID);

      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'GET');
      assert.match(last.path, /^\/api\/ventero\/datosVenta\?/);
      assert.match(last.path, /idVentero=300/);
    });
  });

  // ---------- GET / (listado de endpoints) ----------
  describe('GET /', () => {
    test('el listado incluye /ventero/datosVenta', async () => {
      const { status, body } = await httpRequest(appPort, 'GET', '/');
      assert.equal(status, 200);
      const entrada = body.endpoints.find((e) => e.path === '/ventero/datosVenta[/:id]');
      assert.ok(entrada, 'falta la entrada /ventero/datosVenta[/:id]');
      assert.equal(entrada.method, 'POST|PATCH');
      assert.match(entrada.description, /datos_venta/);
    });
  });
});
