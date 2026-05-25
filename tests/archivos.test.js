'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]); // header PNG mínimo

function startSisdepMock() {
  return new Promise((resolve) => {
    let mode = 'ok'; // 'ok' | 'auth-fail' | 'upload-500' | 'not-found'
    const requests = [];

    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        requests.push({
          method: req.method,
          path: req.url,
          headers: req.headers,
          bodyLength: rawBody.length,
          bodyText: rawBody.toString('utf8').slice(0, 500)
        });

        const accessHeader = req.headers['x-access'];
        if (mode === 'auth-fail' || !accessHeader) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ message: 'Token inválido' }));
        }

        // ---- POST /api/archivos ----
        if (req.method === 'POST' && req.url === '/api/archivos') {
          if (mode === 'upload-500') {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ message: 'Falla guardando' }));
          }
          // Devuelve estructura típica
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({
            archivos: [{
              id: 12345,
              folder: 'Social',
              path: 'archivos_uploaded/Social',
              fullPath: 'https://mock/sisdep/archivos/Social/1716578432123.png',
              nombreArchivo: 'firma_1716578432123.png',
              extension: '.png',
              uploadedBytes: rawBody.length
            }]
          }));
        }

        // ---- GET /api/archivos/:folder/:filename ----
        const fileMatch = req.url.match(/^\/api\/archivos\/([^\/]+)\/([^\/?]+)(?:\?.*)?$/);
        if (req.method === 'GET' && fileMatch) {
          if (mode === 'not-found') {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ message: 'Archivo no existe' }));
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Content-Length', String(FAKE_PNG.length));
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.end(FAKE_PNG);
        }

        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
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

function rawHttp(port, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { host: '127.0.0.1', port, path, method, headers };
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
    if (body) req.write(body);
    req.end();
  });
}

function makeMultipart(infoJson, fileBuffer, filename = 'firma.png', mime = 'image/png') {
  const boundary = '----TestBoundary' + Math.random().toString(16).slice(2);
  const CRLF = '\r\n';
  const head =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="info"${CRLF}` +
    `Content-Type: application/json${CRLF}${CRLF}` +
    JSON.stringify(infoJson) + CRLF +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mime}${CRLF}${CRLF}`;
  const tail = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), fileBuffer, Buffer.from(tail, 'utf8')]);
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    boundary
  };
}

describe('Archivos proxy', () => {
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

  // ---------- POST ----------
  describe('POST /api/archivos', () => {
    test('200 reenvía multipart y devuelve { archivos: [...] }', async () => {
      sisdep.setMode('ok');
      sisdep.clearRequests();
      const info = {
        folder: 'Social', path: 'archivos_uploaded/Social',
        nombreArchivo: 'firma.png', extension: '.png',
        modulo: 'ReporteSivep', observacion: 'Firma test'
      };
      const mp = makeMultipart(info, FAKE_PNG);
      const { status, body } = await rawHttp(appPort, 'POST', '/archivos',
        { 'x-access': 'tok', 'content-type': mp.contentType, 'content-length': mp.body.length },
        mp.body
      );
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.archivos));
      assert.equal(body.archivos[0].fullPath, 'https://mock/sisdep/archivos/Social/1716578432123.png');

      // El upstream recibió el body completo y los headers correctos
      const last = sisdep.requests.at(-1);
      assert.equal(last.method, 'POST');
      assert.equal(last.path, '/api/archivos');
      assert.equal(last.headers['x-access'], 'tok');
      assert.match(last.headers['content-type'], /multipart\/form-data; boundary=/);
      assert.equal(last.bodyLength, mp.body.length);
      assert.ok(last.bodyText.includes('Content-Disposition: form-data; name="info"'));
      assert.ok(last.bodyText.includes('Content-Disposition: form-data; name="file"'));
    });

    test('401 sin x-access', async () => {
      const mp = makeMultipart({ folder: 'Social' }, FAKE_PNG);
      const { status, body } = await rawHttp(appPort, 'POST', '/archivos',
        { 'content-type': mp.contentType, 'content-length': mp.body.length },
        mp.body
      );
      assert.equal(status, 401);
      assert.equal(body.success, false);
    });

    test('400 cuando Content-Type no es multipart', async () => {
      const { status, body } = await rawHttp(appPort, 'POST', '/archivos',
        { 'x-access': 'tok', 'content-type': 'application/json', 'content-length': 2 },
        Buffer.from('{}')
      );
      assert.equal(status, 400);
      assert.match(body.message, /multipart/i);
    });

    test('propaga 500 del upstream', async () => {
      sisdep.setMode('upload-500');
      const mp = makeMultipart({ folder: 'Social' }, FAKE_PNG);
      const { status, body } = await rawHttp(appPort, 'POST', '/archivos',
        { 'x-access': 'tok', 'content-type': mp.contentType, 'content-length': mp.body.length },
        mp.body
      );
      assert.equal(status, 500);
      assert.equal(body.success, false);
    });
  });

  // ---------- GET ----------
  describe('GET /api/archivos/:folder/:filename', () => {
    test('200 sirve el binario con content-type del upstream', async () => {
      sisdep.setMode('ok');
      const { status, headers, raw } = await rawHttp(appPort, 'GET', '/archivos/Social/1716578432123.png',
        { 'x-access': 'tok' }
      );
      assert.equal(status, 200);
      assert.equal(headers['content-type'], 'image/png');
      assert.equal(raw.length, FAKE_PNG.length);
      assert.deepEqual(raw, FAKE_PNG);
    });

    test('401 sin x-access', async () => {
      const { status, body } = await rawHttp(appPort, 'GET', '/archivos/Social/x.png', {});
      assert.equal(status, 401);
      assert.equal(body.success, false);
    });

    test('400 con path traversal en filename', async () => {
      const { status, body } = await rawHttp(appPort, 'GET',
        '/archivos/Social/' + encodeURIComponent('..%2F..%2Fetc%2Fpasswd'),
        { 'x-access': 'tok' }
      );
      // El doble encoding deja '..' literal en filename → debe bloquearse
      assert.equal(status, 400);
      assert.match(body.message, /Ruta inválida/);
    });

    test('propaga 404 cuando el archivo no existe en upstream', async () => {
      sisdep.setMode('not-found');
      const { status, body } = await rawHttp(appPort, 'GET', '/archivos/Social/inexistente.png',
        { 'x-access': 'tok' }
      );
      assert.equal(status, 404);
      assert.equal(body.success, false);
      assert.match(body.message, /Archivo no existe/);
    });
  });
});
