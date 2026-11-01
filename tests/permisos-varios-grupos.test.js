'use strict';

process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Token con el formato de SISDEP: claims userId, groupId (principal) y groupIds (todos).
function token(userId, groupId, groupIds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ userId, groupId, ...(groupIds ? { groupIds } : {}) })}.firma`;
}
// Permisos sumados que devuelve SISDEP (GET /api/seguridad/usuario/ego/permisos), por userId.
const EGO = {
  60: { esAdministrador: false, permisos: { operativa_sensibilizacion: { idModuloSistema: 34, leer: true, escribir: true } } },
  61: { esAdministrador: false, permisos: { personas: { idModuloSistema: 30, leer: true, escribir: true },
                                           operativa_sensibilizacion: { idModuloSistema: 34, leer: true, escribir: false } } },
  62: { esAdministrador: true, permisos: {} }
};
// true simula un SISDEP anterior a los varios grupos (sin el endpoint: 404).
const estado = { sinEgo: false };

function startSisdepMock() {
  return new Promise((resolve) => {
    let sensis;
    let formales;
    let siguienteId;
    const reset = () => {
      sensis = {
        100: { id: 100, numeroSerie: 'A-100', idTipo: 1, fecha: '2026-10-01T09:00:00', idUsuario: 7, idPersona: null,
          esNn: true, idSectorInterno: 3, latitud: 6.25, longitud: -75.56, localizacion: { type: 'Point', coordinates: [-75.56, 6.25] },
          completo: false, esPqrsd: false, retiraElementosEspacioPublico: true, observaciones: 'inicial', territorio: 'viejo' }
      };
      formales = { 9: { id: 9, idSensibilizacion: 100, nombreEstablecimiento: 'Tienda', cumpleActividadEconomica: true,
        autoAvisosPublicitarios: false, cantiAvisosPublicitarios: false, autoMesasSillas: false, cantiMesasSillas: false,
        autoJuegosMecanicos: false, cantiJuegosMecanicos: false, autoBazares: false, cantiBazares: false, realizaActividadProhibida: false } };
      siguienteId = 200;
    };
    reset();
    const requests = [];

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        const url = new URL(req.url, 'http://x');
        requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
        res.setHeader('Content-Type', 'application/json');
        const ok = (status, json) => { res.statusCode = status; res.end(JSON.stringify(json)); };
        const ent = (nombre, filas) => ({ entities: { [nombre]: Object.fromEntries(filas.map((f) => [f.id, f])) } });
        const p = url.pathname;
        const q = Object.fromEntries(url.searchParams);

        if (req.headers['x-access'] === 'vencido') return ok(401, { errors: [{ title: 'Sin acceso', detail: 'Token vencido' }] });

        if (p === '/api/seguridad/usuario/ego/permisos') {
          if (estado.sinEgo) return ok(404, { message: 'Ruta no encontrada' });
          const claims = JSON.parse(Buffer.from(req.headers['x-access'].split('.')[1], 'base64url').toString('utf8'));
          return ok(200, EGO[claims.userId] || { esAdministrador: false, permisos: {} });
        }
        if (p === '/api/seguridad/permisoModuloGrupo') {
          const escribir = q.idGrupo === '5';
          return ok(200, ent('permisoModuloGrupo', [{ id: 1, idGrupo: Number(q.idGrupo), idModuloSistema: Number(q.idModuloSistema), leer: true, escribir }]));
        }
        if (p === '/api/operativa/sensibilizacion' && req.method === 'GET') {
          const filas = Object.values(sensis).filter((s) => !q.numeroSerie || s.numeroSerie === q.numeroSerie);
          return ok(200, ent('sensibilizacion', filas));
        }
        if (p === '/api/operativa/sensibilizacion' && req.method === 'POST') {
          const nueva = { ...body, id: siguienteId++, esNn: body.idPersona == null };
          sensis[nueva.id] = nueva;
          return ok(201, ent('sensibilizacion', [nueva]));
        }
        let m = p.match(/^\/api\/operativa\/sensibilizacion\/(\d+)(\/venta)?$/);
        if (m) {
          const s = sensis[m[1]];
          if (!s) return ok(404, { errors: [{ title: 'No encontrado', detail: 'Item no encontrado.' }] });
          if (m[2]) return ok(200, { ...s, datosVenta: { id: 55, direccion: null }, titular: null });
          if (req.method === 'GET') return ok(200, ent('sensibilizacion', [s]));
          if (req.method === 'PATCH') { Object.assign(s, body); return ok(200, ent('sensibilizacion', [s])); }
        }
        m = p.match(/^\/api\/operativa\/(sensibilizacionFormales|sensibilizacionInformales)(?:\/(\d+))?$/);
        if (m) {
          const tabla = m[1] === 'sensibilizacionFormales' ? formales : {};
          if (req.method === 'GET') return ok(200, ent(m[1], Object.values(tabla).filter((f) => String(f.idSensibilizacion) === q.idSensibilizacion)));
          if (req.method === 'POST') { const f = { ...body, id: siguienteId++ }; return ok(201, ent(m[1], [f])); }
          if (req.method === 'PATCH') { Object.assign(tabla[m[2]], body); return ok(200, ent(m[1], [tabla[m[2]]])); }
        }
        if (p === '/api/historial/sensibilizacion/100') return ok(200, [{ campo: 'observaciones' }]);
        if (p === '/api/dominios/tipoSensibilizacion') return ok(200, ent('tipoSensibilizacion', [{ id: 1, descripcion: 'General' }]));
        if (p === '/api/ventero/datosVenta') return ok(200, ent('datosVenta', [{ id: 55, idVentero: Number(q.idVentero) }]));
        ok(404, { message: 'Ruta mock no reconocida: ' + req.method + ' ' + req.url });
      });
    });

    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests, reset }));
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

describe('Permisos de escritura con varios grupos de SISDEP', () => {
  let sisdep;
  let appServer;
  let port;
  const llamadas = (metodo, ruta) => sisdep.requests.filter((r) => r.method === metodo && r.path === ruta);
  const editar = (tk) => httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': tk }, { observaciones: 'x' });

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    port = appServer.address().port;
  });
  beforeEach(() => { sisdep.reset(); sisdep.requests.length = 0; estado.sinEgo = false; });
  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  test('el permiso viene de otro grupo (no del principal): puede editar', async () => {
    // Principal 7 sin permiso; SISDEP suma un segundo grupo que sí escribe en sensibilización.
    const { status } = await editar(token(60, 7, [7, 47]));
    assert.equal(status, 200);
    assert.equal(llamadas('GET', '/api/seguridad/usuario/ego/permisos').length, 1);
    assert.equal(llamadas('GET', '/api/seguridad/permisoModuloGrupo').length, 0);
    assert.equal(llamadas('PATCH', '/api/operativa/sensibilizacion/100').length, 1);
  });

  test('escribir en otro módulo no sirve: 403', async () => {
    const { status, body } = await editar(token(61, 7, [7, 30]));
    assert.equal(status, 403);
    assert.equal(body.codigo, 'SIN_PERMISO');
    assert.equal(llamadas('PATCH', '/api/operativa/sensibilizacion/100').length, 0);
  });

  test('administrador según SISDEP: puede editar', async () => {
    const { status } = await editar(token(62, 9, [9]));
    assert.equal(status, 200);
  });

  test('grupo 0 entre los grupos del token: no consulta permisos', async () => {
    const { status } = await editar(token(63, 9, [9, 0]));
    assert.equal(status, 200);
    assert.equal(llamadas('GET', '/api/seguridad/usuario/ego/permisos').length, 0);
  });

  test('SISDEP sin el endpoint nuevo: usa el grupo principal como antes', async () => {
    estado.sinEgo = true;
    assert.equal((await editar(token(64, 5))).status, 200);
    assert.equal(llamadas('GET', '/api/seguridad/permisoModuloGrupo').length, 1);
    assert.equal((await editar(token(65, 7))).status, 403);
  });

  test('token vencido: 401 con sesionVencida', async () => {
    const { status, body } = await editar('vencido');
    assert.equal(status, 401);
    assert.equal(body.sesionVencida, true);
  });
});
