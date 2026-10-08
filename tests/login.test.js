'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Token con el formato de SISDEP (header.payload.firma). Solo importa el "exp".
function tokenQueVence(fechaIso) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(new Date(fechaIso).getTime() / 1000) })}.firma`;
}

const EXPIRA = '2026-11-01T05:00:00.000Z';

// Mock de SISDEP con los casos del login real (contrato {"errors":[{title,detail}]}).
function startSisdepMock() {
  return new Promise((resolve) => {
    const usuarios = {
      permanente: { id: 10, grupo: 3, ego: { esActivo: true, esTemporal: false, fechaVencimiento: null } },
      temporal: { id: 11, grupo: 5, ego: { esActivo: true, esTemporal: true, fechaVencimiento: '2026-10-31' } },
      inactivo_en_ego: { id: 12, grupo: 3, ego: { esActivo: false, esTemporal: false, fechaVencimiento: null } }
    };
    const rechazos = {
      malo: 'Credenciales inválidas.',
      vencido: 'Su acceso temporal venció el 30/09/2026. Solicite al administrador que lo extienda.',
      sin_activar: 'Usuario no activado por el administrador.'
    };
    const requests = [];
    let ultimoLogin = null;

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        requests.push({ method: req.method, path: req.url, headers: req.headers, body });
        res.setHeader('Content-Type', 'application/json');
        const responder = (status, json) => { res.statusCode = status; res.end(JSON.stringify(json)); };

        if (req.method === 'POST' && req.url === '/login') {
          if (rechazos[body.username]) {
            return responder(400, { errors: [{ title: 'Error accediendo', detail: rechazos[body.username] }] });
          }
          const u = usuarios[body.username];
          ultimoLogin = body.username;
          if (!u) return responder(400, { errors: [{ title: 'Error accediendo', detail: 'Credenciales inválidas.' }] });
          return responder(200, { status: 'logged!, welcome board', idGrupo: u.grupo, token: tokenQueVence(EXPIRA), idUser: u.id });
        }

        if (req.method === 'GET' && req.url === '/api/seguridad/usuario/ego') {
          const actual = usuarios[ultimoLogin];
          return responder(200, {
            entities: { usuario: { [actual.id]: { id: actual.id, nombre: 'Nombre', apellido: 'Apellido', email: 'x@y.co', idGrupo: actual.grupo, ...actual.ego } } }
          });
        }

        if (req.method === 'PATCH' && req.url === '/api/seguridad/usuario/ego/password') {
          if (req.headers['x-access'] === 'vencido') {
            return responder(401, { errors: [{ title: 'Sin acceso', detail: 'Token vencido' }] });
          }
          if (body.password === 'debil') {
            return responder(409, { errors: [{ title: 'Clave no segura', detail: 'Agregue otra palabra o dos.' }] });
          }
          return responder(202, { status: 'password updated' });
        }

        if (req.method === 'GET' && req.url.startsWith('/reset/')) {
          return responder(200, { status: 'Enviando correo, si existe.' });
        }

        if (req.method === 'GET' && req.url === '/api/dominios/tipoReporteSivep') {
          return responder(401, { errors: [{ title: 'Sin acceso', detail: 'Su sesión venció. Ingrese de nuevo.' }] });
        }

        responder(404, { message: 'Ruta mock no reconocida: ' + req.method + ' ' + req.url });
      });
    });

    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests }));
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
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('Login y contraseña contra SISDEP', () => {
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

  const login = (username, password = 'clave') =>
    httpRequest(appPort, 'POST', '/login', {}, { username, password });

  describe('POST /login', () => {
    test('usuario permanente: token y datos, sin vigencia', async () => {
      const { status, body } = await login('permanente');
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.ok(body.token);
      assert.equal(body.user.id, 10);
      assert.equal(body.user.esTemporal, false);
      assert.equal(body.user.fechaVencimiento, null);
      assert.equal(body.user.sesionExpira, EXPIRA);
    });

    test('usuario temporal vigente: entra y recibe su fecha de vencimiento', async () => {
      const { status, body } = await login('temporal');
      assert.equal(status, 200);
      assert.equal(body.user.esTemporal, true);
      assert.equal(body.user.fechaVencimiento, '2026-10-31');
      assert.equal(body.user.sesionExpira, EXPIRA);
    });

    test('temporal vencido: 401 con el mensaje de SISDEP y código propio', async () => {
      const { status, body } = await login('vencido');
      assert.equal(status, 401);
      assert.equal(body.codigo, 'ACCESO_TEMPORAL_VENCIDO');
      assert.match(body.message, /acceso temporal venció el 30\/09\/2026/);
    });

    test('credenciales malas: 401 con el mensaje de SISDEP (no "Error en el servicio")', async () => {
      const { status, body } = await login('malo');
      assert.equal(status, 401);
      assert.equal(body.codigo, 'CREDENCIALES_INVALIDAS');
      assert.equal(body.message, 'Credenciales inválidas.');
    });

    test('usuario no activado: 401 USUARIO_INACTIVO', async () => {
      const { status, body } = await login('sin_activar');
      assert.equal(status, 401);
      assert.equal(body.codigo, 'USUARIO_INACTIVO');
    });

    test('inactivo según el ego: 403', async () => {
      const { status, body } = await login('inactivo_en_ego');
      assert.equal(status, 403);
      assert.equal(body.codigo, 'USUARIO_INACTIVO');
    });

    test('sin usuario o clave: 400 sin llamar a SISDEP', async () => {
      const antes = sisdep.requests.length;
      const { status, body } = await httpRequest(appPort, 'POST', '/login', {}, { username: 'x' });
      assert.equal(status, 400);
      assert.equal(body.codigo, 'DATOS_INCOMPLETOS');
      assert.equal(sisdep.requests.length, antes);
    });
  });

  describe('PATCH /usuario/password', () => {
    test('clave segura: 200', async () => {
      const { status, body } = await httpRequest(appPort, 'PATCH', '/usuario/password', { 'x-access': 'tok' }, { password: 'Una-Clave_Muy*Segura-2026' });
      assert.equal(status, 200);
      assert.equal(body.success, true);
      const ultima = sisdep.requests.slice(-1)[0];
      assert.equal(ultima.headers['x-access'], 'tok');
      assert.equal(ultima.body.password, 'Una-Clave_Muy*Segura-2026');
    });

    test('clave débil: 409 con las sugerencias de SISDEP', async () => {
      const { status, body } = await httpRequest(appPort, 'PATCH', '/usuario/password', { 'x-access': 'tok' }, { password: 'debil' });
      assert.equal(status, 409);
      assert.equal(body.codigo, 'CLAVE_NO_SEGURA');
      assert.equal(body.message, 'Agregue otra palabra o dos.');
    });

    test('sin token: 401', async () => {
      const { status } = await httpRequest(appPort, 'PATCH', '/usuario/password', {}, { password: 'x' });
      assert.equal(status, 401);
    });

    test('token vencido: 401 con sesionVencida', async () => {
      const { status, body } = await httpRequest(appPort, 'PATCH', '/usuario/password', { 'x-access': 'vencido' }, { password: 'Otra-Clave_Segura-2026' });
      assert.equal(status, 401);
      assert.equal(body.sesionVencida, true);
    });
  });

  describe('GET /recuperar/:documento', () => {
    test('responde lo mismo exista o no el documento', async () => {
      const { status, body } = await httpRequest(appPort, 'GET', '/recuperar/10203040');
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(sisdep.requests.slice(-1)[0].path, '/reset/10203040');
    });

    test('documento con caracteres inválidos: 400 sin llamar a SISDEP', async () => {
      const antes = sisdep.requests.length;
      const { status } = await httpRequest(appPort, 'GET', '/recuperar/' + encodeURIComponent('../login'));
      assert.equal(status, 400);
      assert.equal(sisdep.requests.length, antes);
    });
  });

  describe('Sesión vencida en cualquier endpoint', () => {
    test('un 401 de SISDEP llega con el mensaje real y sesionVencida', async () => {
      const { status, body } = await httpRequest(appPort, 'GET', '/dominios/tipoReporteSivep', { 'x-access': 'tok' });
      assert.equal(status, 401);
      assert.equal(body.sesionVencida, true);
      assert.equal(body.message, 'Su sesión venció. Ingrese de nuevo.');
    });
  });
});
