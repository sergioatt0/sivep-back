'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// PNG de 1x1 transparente, lo mínimo para que el handler lo dé por válido.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Sirve una imagen en cualquier ruta. Hace de origen permitido.
function startImagenMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/png');
      res.end(PNG_1X1);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function httpGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let parsed;
        try { parsed = JSON.parse(raw.toString('utf8')); } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, contentType: res.headers['content-type'] });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const proxy = (url) => `/api/proxy-image?url=${encodeURIComponent(url)}`;

describe('Proxy de imágenes: filtro de origen', () => {
  let imagenes;
  let appServer;
  let appPort;
  let permitido;

  before(async () => {
    imagenes = await startImagenMock();
    permitido = `http://127.0.0.1:${imagenes.port}`;
    // Dos orígenes permitidos: el mock (para el caso válido) y uno con nombre de
    // host, para poder probar el ataque de sufijo sin que el puerto estorbe.
    process.env.IMAGE_ALLOWED_ORIGINS = `${permitido},http://imagenes.test`;
    process.env.SISDEP_BASE_URL = permitido;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    appPort = appServer.address().port;
  });

  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => imagenes.server.close(r));
  });

  test('200 con una URL del origen permitido', async () => {
    const { status, contentType } = await httpGet(appPort, proxy(`${permitido}/foto.png`), { 'x-access': 'tok' });
    assert.equal(status, 200);
    assert.match(contentType, /^image\//);
  });

  // El corazón del arreglo: antes se comparaba con startsWith y estas tres
  // pasaban el filtro, llevándose el x-access del usuario a un servidor ajeno.
  test('403 cuando el host solo comparte el prefijo (sufijo de dominio)', async () => {
    const { status, body } = await httpGet(
      appPort, proxy('http://imagenes.test.ejemplo-externo.test/foto.png'), { 'x-access': 'tok' });
    assert.equal(status, 403);
    assert.equal(body.success, false);
  });

  test('403 cuando el origen permitido va como credencial embebida', async () => {
    const { status, body } = await httpGet(
      appPort, proxy('http://imagenes.test@ejemplo-externo.test/foto.png'), { 'x-access': 'tok' });
    assert.equal(status, 403);
    assert.equal(body.success, false);
  });

  test('403 con esquema que no es http ni https', async () => {
    const { status } = await httpGet(appPort, proxy('file:///etc/passwd'), { 'x-access': 'tok' });
    assert.equal(status, 403);
  });

  test('403 con una URL mal formada', async () => {
    const { status } = await httpGet(appPort, proxy('no-es-una-url'), { 'x-access': 'tok' });
    assert.equal(status, 403);
  });

  test('403 con un origen ajeno cualquiera', async () => {
    const { status } = await httpGet(appPort, proxy('https://ejemplo-externo.test/foto.png'), { 'x-access': 'tok' });
    assert.equal(status, 403);
  });

  test('401 sin x-access, antes de mirar la URL', async () => {
    const { status, body } = await httpGet(appPort, proxy(`${permitido}/foto.png`));
    assert.equal(status, 401);
    assert.equal(body.success, false);
  });

  test('400 sin parámetro url', async () => {
    const { status, body } = await httpGet(appPort, '/api/proxy-image', { 'x-access': 'tok' });
    assert.equal(status, 400);
    assert.equal(body.success, false);
  });
});
