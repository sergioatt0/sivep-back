'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Mock de SISDEP que registra la ruta exacta que recibió, para poder verificar
// cómo llegan los query params después del cambio de parser de Express 5.
function startSisdepMock() {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push({ path: req.url });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([]));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests, clear: () => (requests.length = 0) });
    });
  });
}

function httpGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Endurecimiento HTTP y reenvío de query params', () => {
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

  describe('cabeceras de seguridad', () => {
    test('van en la respuesta, incluso en rutas sin autenticar', async () => {
      const { headers } = await httpGet(appPort, '/');
      assert.equal(headers['x-content-type-options'], 'nosniff');
      assert.equal(headers['x-frame-options'], 'DENY');
      assert.equal(headers['referrer-policy'], 'no-referrer');
      assert.match(headers['content-security-policy'], /default-src 'none'/);
      assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    });

    test('también van en una respuesta rechazada por falta de token', async () => {
      const { status, headers } = await httpGet(appPort, '/dominios/municipio');
      assert.equal(status, 401);
      assert.equal(headers['x-content-type-options'], 'nosniff');
      assert.equal(headers['x-frame-options'], 'DENY');
    });

    test('HSTS solo se emite en producción', async () => {
      // Este proceso corre con NODE_ENV=test, así que no debe aparecer.
      const { headers } = await httpGet(appPort, '/');
      assert.equal(headers['strict-transport-security'], undefined);
    });
  });

  // Express 5 cambió el parser de query por defecto. Como el backend reenvía
  // req.query tal cual al upstream, estas pruebas fijan el contrato.
  describe('reenvío de query params al upstream', () => {
    test('parámetros planos llegan intactos', async () => {
      sisdep.clear();
      const { status } = await httpGet(appPort, '/dominios/municipio?page=0&size=5&contains=2024', { 'x-access': 'tok' });
      assert.equal(status, 200);
      const path = sisdep.requests.at(-1).path;
      assert.match(path, /page=0/);
      assert.match(path, /size=5/);
      assert.match(path, /contains=2024/);
    });

    test('parámetros repetidos no se pierden', async () => {
      sisdep.clear();
      await httpGet(appPort, '/dominios/municipio?id=1&id=2', { 'x-access': 'tok' });
      const path = sisdep.requests.at(-1).path;
      assert.match(path, /id(\[\]|%5B%5D)?=1/);
      assert.match(path, /id(\[\]|%5B%5D)?=2/);
    });

    test('parámetros anidados conservan la forma', async () => {
      sisdep.clear();
      await httpGet(appPort, '/dominios/municipio?filtro%5Bcampo%5D=valor', { 'x-access': 'tok' });
      const path = decodeURIComponent(sisdep.requests.at(-1).path);
      assert.match(path, /filtro\[campo\]=valor/);
    });

    test('un valor con caracteres especiales llega escapado', async () => {
      sisdep.clear();
      await httpGet(appPort, '/dominios/municipio?contains=' + encodeURIComponent('a&b c'), { 'x-access': 'tok' });
      // Se mira la ruta CRUDA: el & del valor debe ir como %26, o el upstream lo
      // leeria como separador y partiria el filtro en dos parametros.
      const path = sisdep.requests.at(-1).path;
      assert.match(path, /contains=a%26b(\+|%20)c/);
      assert.equal(path.split('?')[1].split('&').length, 1, 'el valor no debe partirse en dos parametros');
    });
  });
});
