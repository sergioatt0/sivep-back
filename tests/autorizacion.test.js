'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Fila de la vista SolicitudAutorizacionReporte: autorización + datos del ventero.
const AUTORIZACION_FIXTURE = {
  id: 1,
  nombres: 'Juan',
  apellidos: 'Pérez',
  documento: '10203040',
  tipoDocumento: 'Cédula',
  radicadoMercurio: '2024-123456',
  motivoAutorizacion: 'Venta estacionaria',
  fechaInicial: '2026-01-01T00:00:00',
  fechaFinal: '2026-12-31T00:00:00',
  barrio: 'La Candelaria',
  comuna: '10'
};

// Mock de SISDEP. Acepta cualquier ruta y registra el último request para inspección.
function startSisdepMock() {
  return new Promise((resolve) => {
    let mode = 'ok'; // 'ok' | '404' | 'auth-fail' | '500'
    const requests = []; // historial: { method, path, headers, body }

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = null;
        if (raw) {
          try { body = JSON.parse(raw); } catch { body = raw; }
        }
        requests.push({ method: req.method, path: req.url, headers: req.headers, body });

        const accessHeader = req.headers['x-access'];
        if (mode === 'auth-fail' || !accessHeader) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message: 'Token inválido' }));
          return;
        }
        if (mode === '500') {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message: 'Error en el servicio' }));
          return;
        }

        res.setHeader('Content-Type', 'application/json');

        // Vista de reporte de autorizaciones (devuelve lista filtrable por query params)
        if (/^\/api\/regulaciones\/reportes\/SolicitudAutorizacionReporte(\?.*)?$/.test(req.url)) {
          if (req.method === 'GET') {
            res.statusCode = 200;
            return res.end(JSON.stringify([AUTORIZACION_FIXTURE]));
          }
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
    const opts = {
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: { ...headers, ...(data ? { 'Content-Length': data.length, 'Content-Type': 'application/json' } : {}) }
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('Autorización (búsqueda por radicado mercurio) proxy', () => {
  let sisdep;
  let appServer;
  let appPort;

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

  describe('GET /regulaciones/autorizacion', () => {
    test('200 retorna autorizaciones con datos del ventero', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/regulaciones/autorizacion', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body[0].radicadoMercurio, '2024-123456');
      assert.equal(body[0].documento, '10203040');
    });

    test('reenvía radicadoMercurio (exacto) como query param al upstream', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const { status } = await httpRequest(appPort, 'GET', '/regulaciones/autorizacion?radicadoMercurio=2024-123456', { 'x-access': 'tok' });
      assert.equal(status, 200);
      const last = sisdep.requests.at(-1);
      assert.match(last.path, /^\/api\/regulaciones\/reportes\/SolicitudAutorizacionReporte\?/);
      assert.match(last.path, /radicadoMercurio=2024-123456/);
    });

    test('reenvía contains (parcial) como query param al upstream', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const { status } = await httpRequest(appPort, 'GET', '/regulaciones/autorizacion?contains=2024', { 'x-access': 'tok' });
      assert.equal(status, 200);
      const last = sisdep.requests.at(-1);
      assert.match(last.path, /contains=2024/);
    });

    test('401 sin x-access', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/regulaciones/autorizacion');
      assert.equal(status, 401);
      assert.equal(body.success, false);
    });

    test('propaga 500 del upstream', async () => {
      sisdep.setMode('500');
      const { status, body } = await httpRequest(appPort, 'GET', '/regulaciones/autorizacion', { 'x-access': 'tok' });
      assert.equal(status, 500);
      assert.equal(body.success, false);
    });
  });
});
