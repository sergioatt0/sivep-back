'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TIPOS_FIXTURE = [
  { id: 1, descripcion: 'Grave' },
  { id: 2, descripcion: 'Media' },
  { id: 3, descripcion: 'Baja' },
  { id: 4, descripcion: 'En prioridad' }
];

const REPORTE_FIXTURE = {
  id: 1,
  direccionReporte: 'Cra 50 # 30 - 10',
  idUsuarioReporta: 42,
  idVenteroReportado: 1234,
  idTipoReporteSivep: 1,
  enlaceFotografia: 'https://example/foto.jpg',
  enlaceFirma: 'https://example/firma.png'
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
        requests.push({
          method: req.method,
          path: req.url,
          headers: req.headers,
          body
        });

        const accessHeader = req.headers['x-access'];
        if (mode === 'auth-fail' || !accessHeader) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message: 'Token inválido' }));
          return;
        }
        if (mode === '404') {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message: 'No encontrado' }));
          return;
        }
        if (mode === '500') {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message: 'Error en el servicio' }));
          return;
        }

        // --- ruteo dummy ---
        res.setHeader('Content-Type', 'application/json');

        // tipoReporteSivep collection
        if (/^\/api\/dominios\/tipoReporteSivep\/?(\?.*)?$/.test(req.url)) {
          if (req.method === 'GET') { res.statusCode = 200; return res.end(JSON.stringify(TIPOS_FIXTURE)); }
          if (req.method === 'POST') {
            const created = { id: 99, ...(body || {}) };
            res.statusCode = 201; return res.end(JSON.stringify(created));
          }
        }
        // tipoReporteSivep item
        const tipoIdMatch = req.url.match(/^\/api\/dominios\/tipoReporteSivep\/(\d+)$/);
        if (tipoIdMatch) {
          const id = Number(tipoIdMatch[1]);
          if (req.method === 'GET') {
            const found = TIPOS_FIXTURE.find((t) => t.id === id);
            if (!found) { res.statusCode = 404; return res.end(JSON.stringify({ message: 'No encontrado' })); }
            res.statusCode = 200; return res.end(JSON.stringify(found));
          }
          if (req.method === 'PATCH') {
            res.statusCode = 200; return res.end(JSON.stringify({ id, ...(body || {}) }));
          }
          if (req.method === 'DELETE') {
            res.statusCode = 204; return res.end();
          }
        }

        // reporteSivep paginated
        if (/^\/api\/social\/reporteSivep\/paginated(\?.*)?$/.test(req.url)) {
          if (req.method === 'GET') {
            res.statusCode = 200;
            return res.end(JSON.stringify({
              content: [REPORTE_FIXTURE],
              totalElements: 1,
              totalPages: 1,
              number: 0,
              size: 10
            }));
          }
        }
        // reporteSivep collection
        if (/^\/api\/social\/reporteSivep\/?(\?.*)?$/.test(req.url)) {
          if (req.method === 'GET') { res.statusCode = 200; return res.end(JSON.stringify([REPORTE_FIXTURE])); }
          if (req.method === 'POST') {
            const created = { id: 999, ...(body || {}) };
            res.statusCode = 201; return res.end(JSON.stringify(created));
          }
        }
        // reporteSivep item
        const repIdMatch = req.url.match(/^\/api\/social\/reporteSivep\/(\d+)$/);
        if (repIdMatch) {
          const id = Number(repIdMatch[1]);
          if (req.method === 'GET') {
            res.statusCode = 200; return res.end(JSON.stringify({ ...REPORTE_FIXTURE, id }));
          }
          if (req.method === 'PATCH') {
            res.statusCode = 200; return res.end(JSON.stringify({ ...REPORTE_FIXTURE, id, ...(body || {}) }));
          }
          if (req.method === 'DELETE') {
            res.statusCode = 204; return res.end();
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

describe('Reporte SIVEP proxy', () => {
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

  // ---------- tipoReporteSivep ----------
  describe('GET /api/dominios/tipoReporteSivep', () => {
    test('200 retorna catálogo', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/api/dominios/tipoReporteSivep', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.equal(body.length, 4);
      assert.equal(body[0].descripcion, 'Grave');
    });

    test('401 sin x-access', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/api/dominios/tipoReporteSivep');
      assert.equal(status, 401);
      assert.equal(body.success, false);
    });

    test('propaga 500 del upstream', async () => {
      sisdep.setMode('500');
      const { status, body } = await httpRequest(appPort, 'GET', '/api/dominios/tipoReporteSivep', { 'x-access': 'tok' });
      assert.equal(status, 500);
      assert.equal(body.success, false);
    });
  });

  describe('GET /api/dominios/tipoReporteSivep/:id', () => {
    test('200 retorna item', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/api/dominios/tipoReporteSivep/2', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.equal(body.id, 2);
      assert.equal(body.descripcion, 'Media');
    });

    test('400 con id no numérico', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/api/dominios/tipoReporteSivep/abc', { 'x-access': 'tok' });
      assert.equal(status, 400);
      assert.match(body.message, /ID inválido/);
    });

    test('propaga 404 cuando id no existe en upstream', async () => {
      sisdep.setMode('ok');
      const { status } = await httpRequest(appPort, 'GET', '/api/dominios/tipoReporteSivep/9999', { 'x-access': 'tok' });
      assert.equal(status, 404);
    });
  });

  describe('POST /api/dominios/tipoReporteSivep', () => {
    test('201 crea nuevo tipo y reenvía body', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const payload = { descripcion: 'Urgente' };
      const { status, body } = await httpRequest(appPort, 'POST', '/api/dominios/tipoReporteSivep', { 'x-access': 'tok' }, payload);
      assert.equal(status, 201);
      assert.equal(body.descripcion, 'Urgente');
      // upstream recibió el body
      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'POST');
      assert.equal(last.body.descripcion, 'Urgente');
      assert.equal(last.headers['x-access'], 'tok');
    });
  });

  describe('PATCH /api/dominios/tipoReporteSivep/:id', () => {
    test('200 actualiza y reenvía body', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'PATCH', '/api/dominios/tipoReporteSivep/3', { 'x-access': 'tok' }, { descripcion: 'Baja*' });
      assert.equal(status, 200);
      assert.equal(body.id, 3);
      assert.equal(body.descripcion, 'Baja*');
    });

    test('400 con id no numérico', async () => {
      const { status } = await httpRequest(appPort, 'PATCH', '/api/dominios/tipoReporteSivep/xyz', { 'x-access': 'tok' }, { descripcion: 'X' });
      assert.equal(status, 400);
    });
  });

  describe('DELETE /api/dominios/tipoReporteSivep/:id', () => {
    test('204 elimina (devuelve fallback JSON cuando upstream no manda body)', async () => {
      sisdep.setMode('ok');
      const { status } = await httpRequest(appPort, 'DELETE', '/api/dominios/tipoReporteSivep/4', { 'x-access': 'tok' });
      assert.equal(status, 204);
    });

    test('401 sin x-access', async () => {
      const { status } = await httpRequest(appPort, 'DELETE', '/api/dominios/tipoReporteSivep/4');
      assert.equal(status, 401);
    });
  });

  // ---------- reporteSivep ----------
  describe('GET /api/social/reporteSivep', () => {
    test('200 retorna lista', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/api/social/reporteSivep', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body[0].direccionReporte, 'Cra 50 # 30 - 10');
    });
  });

  describe('GET /api/social/reporteSivep/paginated', () => {
    test('200 con query params reenviados al upstream', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'GET', '/api/social/reporteSivep/paginated?page=0&size=10&sort=id,desc', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.equal(body.totalElements, 1);
      // El mock recibe los query params tal cual
      const last = sisdep.requests.at(-1);
      assert.match(last.path, /\/api\/social\/reporteSivep\/paginated\?/);
      assert.match(last.path, /page=0/);
      assert.match(last.path, /size=10/);
      assert.match(last.path, /sort=id%2Cdesc|sort=id,desc/);
    });

    test('NO se confunde con la ruta /:id (registro de /paginated va primero)', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const { status } = await httpRequest(appPort, 'GET', '/api/social/reporteSivep/paginated', { 'x-access': 'tok' });
      assert.equal(status, 200);
      const last = sisdep.requests.at(-1);
      assert.equal(last.path.split('?')[0], '/api/social/reporteSivep/paginated');
    });
  });

  describe('GET /api/social/reporteSivep/:id', () => {
    test('200 retorna reporte con id solicitado', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'GET', '/api/social/reporteSivep/77', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.equal(body.id, 77);
      assert.equal(body.idTipoReporteSivep, 1);
    });

    test('400 con id no numérico', async () => {
      const { status } = await httpRequest(appPort, 'GET', '/api/social/reporteSivep/abc', { 'x-access': 'tok' });
      assert.equal(status, 400);
    });
  });

  describe('POST /api/social/reporteSivep', () => {
    test('201 crea reporte y reenvía body completo', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const payload = {
        direccionReporte: 'Cl 10 # 20-30',
        idUsuarioReporta: 1,
        idVenteroReportado: 16613,
        idTipoReporteSivep: 2,
        enlaceFotografia: 'https://example/x.jpg',
        enlaceFirma: 'https://example/y.png'
      };
      const { status, body } = await httpRequest(appPort, 'POST', '/api/social/reporteSivep', { 'x-access': 'tok' }, payload);
      assert.equal(status, 201);
      assert.equal(body.id, 999);
      assert.equal(body.direccionReporte, 'Cl 10 # 20-30');
      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'POST');
      assert.deepEqual(last.body, payload);
    });

    test('propaga 401 del upstream cuando token es rechazado', async () => {
      sisdep.setMode('auth-fail');
      const { status } = await httpRequest(appPort, 'POST', '/api/social/reporteSivep', { 'x-access': 'tok-malo' }, { direccionReporte: 'x' });
      assert.equal(status, 401);
    });
  });

  describe('PATCH /api/social/reporteSivep/:id', () => {
    test('200 actualiza y reenvía body', async () => {
      sisdep.setMode('ok');
      const { status, body } = await httpRequest(appPort, 'PATCH', '/api/social/reporteSivep/5', { 'x-access': 'tok' }, { idTipoReporteSivep: 3 });
      assert.equal(status, 200);
      assert.equal(body.id, 5);
      assert.equal(body.idTipoReporteSivep, 3);
    });
  });

  describe('DELETE /api/social/reporteSivep/:id', () => {
    test('204 elimina', async () => {
      sisdep.setMode('ok');
      const { status } = await httpRequest(appPort, 'DELETE', '/api/social/reporteSivep/5', { 'x-access': 'tok' });
      assert.equal(status, 204);
    });

    test('400 con id no numérico', async () => {
      const { status } = await httpRequest(appPort, 'DELETE', '/api/social/reporteSivep/abc', { 'x-access': 'tok' });
      assert.equal(status, 400);
    });
  });
});
