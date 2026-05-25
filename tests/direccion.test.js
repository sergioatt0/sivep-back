'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const CATALOGOS = {
  municipio: [{ id: 1, descripcion: 'Medellín', codigo: '05001' }, { id: 2, descripcion: 'Bello' }],
  comuna: [{ id: 10, descripcion: 'La Candelaria' }, { id: 11, descripcion: 'Laureles' }],
  barrio: [{ id: 105, descripcion: 'Centro' }, { id: 106, descripcion: 'San Diego' }],
  nomenclaturaVial: [{ id: 1, descripcion: 'Calle' }, { id: 2, descripcion: 'Carrera' }],
  orientacion: [{ id: 1, descripcion: 'Norte' }, { id: 2, descripcion: 'Sur' }]
};

const DIRECCION_FIXTURE = {
  id: 100123,
  cruceDesde: 1, numeroDesde: 50, letraDesde: null, orientacionDesde: null,
  cruceHasta: 2, numeroHasta: 30, letraHasta: null, orientacionHasta: null,
  numero: 15, complemento: null,
  idMunicipio: 1, idComuna: 10, idBarrio: 105,
  localizacion: null, enUso: false
};

function startSisdepMock() {
  return new Promise((resolve) => {
    let mode = 'ok'; // 'ok' | 'auth-fail' | 'validar-existe' | 'validar-similares' | 'create-409' | 'excel-error'
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

        if (mode === 'auth-fail' || !req.headers['x-access']) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: 'Token inválido' }));
        }

        res.setHeader('Content-Type', 'application/json');

        // ---- Catálogos ----
        const catMatch = req.url.match(/^\/api\/dominios\/(\w+)(\?.*)?$/);
        if (req.method === 'GET' && catMatch && CATALOGOS[catMatch[1]]) {
          res.statusCode = 200;
          return res.end(JSON.stringify(CATALOGOS[catMatch[1]]));
        }

        // ---- POST /validar ----
        if (req.method === 'POST' && req.url === '/api/general/direccion/validar') {
          if (mode === 'validar-existe') {
            res.statusCode = 200;
            return res.end(JSON.stringify({
              existe: true,
              id: 98765,
              enUso: false,
              direccion: { ...DIRECCION_FIXTURE, id: 98765 },
              similares: []
            }));
          }
          if (mode === 'validar-similares') {
            res.statusCode = 200;
            return res.end(JSON.stringify({
              existe: false, id: null, enUso: false, direccion: null,
              similares: [{ id: 2688, diferencia: ['idBarrio', 'idComuna'], direccion: { ...DIRECCION_FIXTURE, id: 2688, idBarrio: 252, idComuna: 9 } }]
            }));
          }
          res.statusCode = 200;
          return res.end(JSON.stringify({ existe: false, id: null, enUso: false, direccion: null, similares: [] }));
        }

        // ---- POST /direccion (crear) ----
        if (req.method === 'POST' && req.url === '/api/general/direccion') {
          if (mode === 'create-409') {
            res.statusCode = 409;
            return res.end(JSON.stringify({ message: 'Duplicado' }));
          }
          res.statusCode = 200;
          return res.end(JSON.stringify({ ...DIRECCION_FIXTURE, ...(body || {}) }));
        }

        // ---- GET /direccion ----
        if (req.method === 'GET' && /^\/api\/general\/direccion(\?.*)?$/.test(req.url)) {
          res.statusCode = 200;
          return res.end(JSON.stringify([DIRECCION_FIXTURE]));
        }

        // ---- GET /direccion/:id ----
        const dirIdMatch = req.url.match(/^\/api\/general\/direccion\/(\d+)$/);
        if (req.method === 'GET' && dirIdMatch) {
          res.statusCode = 200;
          return res.end(JSON.stringify({ ...DIRECCION_FIXTURE, id: Number(dirIdMatch[1]) }));
        }
        // ---- PATCH /direccion/:id ----
        if (req.method === 'PATCH' && dirIdMatch) {
          res.statusCode = 200;
          return res.end(JSON.stringify({ ...DIRECCION_FIXTURE, id: Number(dirIdMatch[1]), ...(body || {}) }));
        }

        // ---- direccionCompleta ----
        if (req.method === 'GET' && /^\/api\/general\/direccionCompleta\/paginated(\?.*)?$/.test(req.url)) {
          res.statusCode = 200;
          return res.end(JSON.stringify({
            entities: [{ ...DIRECCION_FIXTURE, municipio: 'Medellín', comuna: 'La Candelaria', barrio: 'Centro' }],
            totalCount: 1, totalPageCount: 1
          }));
        }
        if (req.method === 'GET' && /^\/api\/general\/direccionCompleta\/count(\?.*)?$/.test(req.url)) {
          res.statusCode = 200;
          return res.end(JSON.stringify({ count: 1 }));
        }
        if (req.method === 'GET' && /^\/api\/general\/direccionCompleta\/excel(\?.*)?$/.test(req.url)) {
          if (mode === 'excel-error') {
            res.statusCode = 500;
            return res.end(JSON.stringify({ message: 'No se pudo generar el excel' }));
          }
          // Binario fake (header "PK" + bytes)
          const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Length', String(xlsx.length));
          res.setHeader('Content-Disposition', 'attachment; filename="direcciones.xlsx"');
          return res.end(xlsx);
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

function rawHttp(port, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) : null;
    const opts = {
      host: '127.0.0.1', port, path, method,
      headers: { ...headers, ...(data && !headers['content-type'] ? { 'Content-Type': 'application/json' } : {}), ...(data ? { 'Content-Length': data.length } : {}) }
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        let parsed = buf;
        if (ct.includes('application/json')) {
          try { parsed = JSON.parse(buf.toString('utf8')); } catch { parsed = buf.toString('utf8'); }
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('Dirección proxy', () => {
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

  // ---------- catálogos ----------
  describe('GET /api/dominios/* (catálogos)', () => {
    for (const cat of ['municipio', 'comuna', 'barrio', 'nomenclaturaVial', 'orientacion']) {
      test(`200 ${cat}`, async () => {
        const { status, body } = await rawHttp(appPort, 'GET', `/api/dominios/${cat}`, { 'x-access': 'tok' });
        assert.equal(status, 200);
        assert.ok(Array.isArray(body));
        assert.ok(body[0].id);
        assert.ok(body[0].descripcion);
      });
    }

    test('401 sin x-access (municipio)', async () => {
      const { status, body } = await rawHttp(appPort, 'GET', '/api/dominios/municipio', {});
      assert.equal(status, 401);
      assert.equal(body.success, false);
    });

    test('query params se reenvían al upstream (comuna?idMunicipio=1)', async () => {
      sisdep.clearRequests();
      await rawHttp(appPort, 'GET', '/api/dominios/comuna?idMunicipio=1', { 'x-access': 'tok' });
      const last = sisdep.requests.at(-1);
      assert.match(last.path, /idMunicipio=1/);
    });
  });

  // ---------- /validar ----------
  describe('POST /api/general/direccion/validar', () => {
    test('200 cuando no existe ni hay similares', async () => {
      sisdep.setMode('ok');
      const { status, body } = await rawHttp(appPort, 'POST', '/api/general/direccion/validar',
        { 'x-access': 'tok' },
        { cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, idMunicipio: 1 }
      );
      assert.equal(status, 200);
      assert.equal(body.existe, false);
      assert.equal(body.id, null);
      assert.deepEqual(body.similares, []);
    });

    test('200 existe=true devuelve id reusable', async () => {
      sisdep.setMode('validar-existe');
      const { status, body } = await rawHttp(appPort, 'POST', '/api/general/direccion/validar',
        { 'x-access': 'tok' },
        { cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, idMunicipio: 1 }
      );
      assert.equal(status, 200);
      assert.equal(body.existe, true);
      assert.equal(body.id, 98765);
    });

    test('200 con similares lista candidates con campo diferencia', async () => {
      sisdep.setMode('validar-similares');
      const { status, body } = await rawHttp(appPort, 'POST', '/api/general/direccion/validar',
        { 'x-access': 'tok' },
        { cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, idMunicipio: 1 }
      );
      assert.equal(status, 200);
      assert.equal(body.existe, false);
      assert.equal(body.similares.length, 1);
      assert.deepEqual(body.similares[0].diferencia, ['idBarrio', 'idComuna']);
    });

    test('401 sin x-access', async () => {
      const { status } = await rawHttp(appPort, 'POST', '/api/general/direccion/validar', {}, { cruceDesde: 1 });
      assert.equal(status, 401);
    });

    test('body se reenvía intacto al upstream', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const payload = { cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, idMunicipio: 1, idComuna: 10, idBarrio: 105 };
      await rawHttp(appPort, 'POST', '/api/general/direccion/validar', { 'x-access': 'tok' }, payload);
      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'POST');
      assert.equal(last.path, '/api/general/direccion/validar');
      assert.deepEqual(last.body, payload);
    });
  });

  // ---------- POST /direccion ----------
  describe('POST /api/general/direccion', () => {
    test('200 crea y devuelve el id asignado', async () => {
      sisdep.setMode('ok');
      const payload = {
        cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30,
        numero: 15, complemento: 'Apto 301',
        idMunicipio: 1, idComuna: 10, idBarrio: 105,
        localizacion: { type: 'Point', coordinates: [-75.5814, 6.2476] }
      };
      const { status, body } = await rawHttp(appPort, 'POST', '/api/general/direccion', { 'x-access': 'tok' }, payload);
      assert.equal(status, 200);
      assert.ok(body.id);
      assert.equal(body.complemento, 'Apto 301');
      assert.deepEqual(body.localizacion, { type: 'Point', coordinates: [-75.5814, 6.2476] });
    });

    test('propaga 409 cuando hay duplicado upstream', async () => {
      sisdep.setMode('create-409');
      const { status, body } = await rawHttp(appPort, 'POST', '/api/general/direccion',
        { 'x-access': 'tok' }, { cruceDesde: 1, numeroDesde: 50, cruceHasta: 2, numeroHasta: 30, idMunicipio: 1 }
      );
      assert.equal(status, 409);
      assert.equal(body.success, false);
      assert.match(body.message, /Duplicado/);
    });

    test('401 sin x-access', async () => {
      const { status } = await rawHttp(appPort, 'POST', '/api/general/direccion', {}, { cruceDesde: 1 });
      assert.equal(status, 401);
    });
  });

  // ---------- GET ----------
  describe('GET /api/general/direccion', () => {
    test('200 lista', async () => {
      sisdep.setMode('ok');
      const { status, body } = await rawHttp(appPort, 'GET', '/api/general/direccion', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body[0].id, DIRECCION_FIXTURE.id);
    });

    test('200 con ?enUso=true reenviado al upstream', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      await rawHttp(appPort, 'GET', '/api/general/direccion?enUso=true', { 'x-access': 'tok' });
      const last = sisdep.requests.at(-1);
      assert.match(last.path, /enUso=true/);
    });
  });

  describe('GET /api/general/direccion/:id', () => {
    test('200 detalle', async () => {
      sisdep.setMode('ok');
      const { status, body } = await rawHttp(appPort, 'GET', '/api/general/direccion/77', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.equal(body.id, 77);
    });

    test('400 id no numérico', async () => {
      const { status, body } = await rawHttp(appPort, 'GET', '/api/general/direccion/abc', { 'x-access': 'tok' });
      assert.equal(status, 400);
      assert.match(body.message, /ID inválido/);
    });
  });

  describe('PATCH /api/general/direccion/:id', () => {
    test('200 actualiza y reenvía body', async () => {
      sisdep.setMode('ok');
      const { status, body } = await rawHttp(appPort, 'PATCH', '/api/general/direccion/5', { 'x-access': 'tok' }, { complemento: 'Casa 2' });
      assert.equal(status, 200);
      assert.equal(body.id, 5);
      assert.equal(body.complemento, 'Casa 2');
    });

    test('400 con id no numérico', async () => {
      const { status } = await rawHttp(appPort, 'PATCH', '/api/general/direccion/abc', { 'x-access': 'tok' }, { complemento: 'X' });
      assert.equal(status, 400);
    });
  });

  // ---------- direccionCompleta ----------
  describe('GET /api/general/direccionCompleta/*', () => {
    test('200 paginated con query params', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const { status, body } = await rawHttp(appPort, 'GET',
        '/api/general/direccionCompleta/paginated?page=0&size=10', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.equal(body.totalCount, 1);
      assert.equal(body.entities[0].municipio, 'Medellín');
      const last = sisdep.requests.at(-1);
      assert.match(last.path, /page=0/);
      assert.match(last.path, /size=10/);
    });

    test('200 count', async () => {
      sisdep.setMode('ok');
      const { status, body } = await rawHttp(appPort, 'GET',
        '/api/general/direccionCompleta/count', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.equal(body.count, 1);
    });

    test('200 excel sirve binario con content-disposition', async () => {
      sisdep.setMode('ok');
      const { status, headers, raw } = await rawHttp(appPort, 'GET',
        '/api/general/direccionCompleta/excel', { 'x-access': 'tok' });
      assert.equal(status, 200);
      assert.match(headers['content-type'], /spreadsheetml\.sheet/);
      assert.match(headers['content-disposition'], /direcciones\.xlsx/);
      // Header XLSX/ZIP comienza con PK\x03\x04
      assert.equal(raw[0], 0x50);
      assert.equal(raw[1], 0x4b);
    });

    test('excel propaga error como JSON', async () => {
      sisdep.setMode('excel-error');
      const { status, body } = await rawHttp(appPort, 'GET',
        '/api/general/direccionCompleta/excel', { 'x-access': 'tok' });
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.match(body.message, /No se pudo generar/);
    });

    test('401 sin x-access (paginated)', async () => {
      const { status } = await rawHttp(appPort, 'GET',
        '/api/general/direccionCompleta/paginated', {});
      assert.equal(status, 401);
    });
  });
});
