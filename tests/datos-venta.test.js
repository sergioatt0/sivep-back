'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const DATOS_VENTA_FIXTURE = {
  id: 55,
  idVentero: 300,
  idDireccion: 100123,
  nombreEstablecimiento: 'Tienda Doña Ana',
  observaciones: null
};

function startSisdepMock() {
  return new Promise((resolve) => {
    let mode = 'ok'; // 'ok' | 'conflict'
    const requests = [];

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

        // ---- GET /datosVenta (puesto actual) ----
        if (req.method === 'GET' && /^\/api\/ventero\/datosVenta(\?.*)?$/.test(req.url)) {
          res.statusCode = 200;
          return res.end(JSON.stringify({
            entities: { datosVenta: { 55: { ...DATOS_VENTA_FIXTURE } } }
          }));
        }

        // ---- POST /datosVenta (crear) ----
        if (req.method === 'POST' && req.url === '/api/ventero/datosVenta') {
          if (mode === 'conflict') {
            res.statusCode = 409;
            return res.end(JSON.stringify({ message: 'El ventero ya tiene un puesto de venta' }));
          }
          res.statusCode = 201;
          return res.end(JSON.stringify({ ...DATOS_VENTA_FIXTURE, ...(body || {}) }));
        }

        // ---- PATCH /datosVenta/:id ----
        const patchMatch = req.url.match(/^\/api\/ventero\/datosVenta\/(\d+)$/);
        if (req.method === 'PATCH' && patchMatch) {
          if (mode === 'conflict') {
            res.statusCode = 409;
            return res.end(JSON.stringify({ message: 'El ventero ya tiene un puesto de venta' }));
          }
          res.statusCode = 200;
          return res.end(JSON.stringify({ ...DATOS_VENTA_FIXTURE, id: Number(patchMatch[1]), ...(body || {}) }));
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

  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  // ---------- POST /ventero/datosVenta ----------
  describe('POST /ventero/datosVenta', () => {
    test('201 reenvía el cuerpo (idVentero + idDireccion) a /api/ventero/datosVenta', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const payload = { idVentero: 300, idDireccion: 100123, nombreEstablecimiento: 'Tienda Doña Ana' };
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta', { 'x-access': 'tok' }, payload);
      assert.equal(status, 201);

      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'POST');
      assert.equal(last.path, '/api/ventero/datosVenta');
      assert.equal(last.body.idVentero, 300);
      assert.equal(last.body.idDireccion, 100123);
      assert.equal(last.body.nombreEstablecimiento, 'Tienda Doña Ana');

      // La respuesta del upstream se devuelve tal cual
      assert.equal(body.idVentero, 300);
      assert.equal(body.idDireccion, 100123);
    });

    test('descarta el id del cuerpo: SISDEP lo asigna', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { id: 999, idVentero: 300, idDireccion: 100123 });
      const last = sisdep.requests.at(-1);
      assert.equal(last.body.id, undefined);
      assert.equal(last.body.idVentero, 300);
      assert.equal(last.body.idDireccion, 100123);
    });

    test('propaga 409 cuando el ventero ya tiene puesto', async () => {
      sisdep.setMode('conflict');
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: 300, idDireccion: 100123 });
      assert.equal(status, 409);
      assert.equal(body.success, false);
      assert.match(body.message, /ya tiene un puesto/);
    });

    test('401 sin x-access', async () => {
      sisdep.setMode('ok');
      const { status } = await httpRequest(appPort, 'POST', '/ventero/datosVenta', {}, { idVentero: 300 });
      assert.equal(status, 401);
    });
  });

  // ---------- PATCH /ventero/datosVenta/:id ----------
  describe('PATCH /ventero/datosVenta/:id', () => {
    test('200 reenvía el cuerpo a /api/ventero/datosVenta/<id> y devuelve la respuesta', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'PATCH', '/ventero/datosVenta/55',
        { 'x-access': 'tok' }, { idDireccion: 100123 });
      assert.equal(status, 200);

      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'PATCH');
      assert.equal(last.path, '/api/ventero/datosVenta/55');
      assert.equal(last.body.idDireccion, 100123);

      assert.equal(body.id, 55);
      assert.equal(body.idDireccion, 100123);
    });

    test('400 con id no numérico', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'PATCH', '/ventero/datosVenta/abc',
        { 'x-access': 'tok' }, { idDireccion: 100123 });
      assert.equal(status, 400);
      assert.match(body.message, /ID inválido/);
    });

    test('propaga 409 cuando el ventero ya tiene puesto', async () => {
      sisdep.setMode('conflict');
      const { status, body } = await httpRequest(appPort, 'PATCH', '/ventero/datosVenta/55',
        { 'x-access': 'tok' }, { idDireccion: 100123 });
      assert.equal(status, 409);
      assert.equal(body.success, false);
    });

    test('401 sin x-access', async () => {
      sisdep.setMode('ok');
      const { status } = await httpRequest(appPort, 'PATCH', '/ventero/datosVenta/55', {}, { idDireccion: 100123 });
      assert.equal(status, 401);
    });
  });

  // ---------- GET /ventero/:id/puesto (lectura existente) ----------
  describe('GET /ventero/:id/puesto', () => {
    test('200 devuelve la lista de datosVenta del ventero', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'GET', '/ventero/300/puesto', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body[0].id, 55);

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
