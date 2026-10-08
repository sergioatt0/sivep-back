'use strict';

process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Token con el formato de SISDEP: solo importan los claims userId y groupId.
function token(userId, groupId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ userId, groupId })}.firma`;
}
const CON_PERMISO = token(40, 5);
const SIN_PERMISO = token(41, 7);
const ADMIN = token(1, 0);

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

describe('Sensibilizaciones (proxy a SISDEP)', () => {
  let sisdep;
  let appServer;
  let port;
  const llamadas = (metodo, ruta) => sisdep.requests.filter((r) => r.method === metodo && r.path === ruta);

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    port = appServer.address().port;
  });
  beforeEach(() => { sisdep.reset(); sisdep.requests.length = 0; });
  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  describe('POST /operativa/sensibilizacion', () => {
    const nn = { numeroSerie: 'B-1', idTipo: 1, fecha: '2026-10-07T10:00:00', idSectorInterno: 3, latitud: 6.2, longitud: -75.5, localizacion: 'POINT (-75.5 6.2)' };

    test('NN con territorio: 201; idUsuario sale del token y se descartan esNn/territorio', async () => {
      const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', { 'x-access': CON_PERMISO },
        { ...nn, idUsuario: 999, esNn: false, territorio: 'texto', id: 5 });
      assert.equal(status, 201);
      assert.equal(body.success, true);
      const enviado = llamadas('POST', '/api/operativa/sensibilizacion')[0].body;
      assert.equal(enviado.idUsuario, 40);
      assert.equal(enviado.esNn, undefined);
      assert.equal(enviado.territorio, undefined);
      assert.equal(enviado.id, undefined);
      assert.equal(enviado.completo, false);
    });

    test('NN sin territorio: 422 sin llamar a SISDEP', async () => {
      const { idSectorInterno, ...sinTerritorio } = nn;
      const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', { 'x-access': CON_PERMISO }, sinTerritorio);
      assert.equal(status, 422);
      assert.match(body.message, /territorio/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('con ventero no exige territorio', async () => {
      const { idSectorInterno, ...conVentero } = nn;
      const { status } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', { 'x-access': CON_PERMISO }, { ...conVentero, idPersona: 321 });
      assert.equal(status, 201);
    });

    test('número de serie repetido: 409', async () => {
      const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', { 'x-access': CON_PERMISO }, { ...nn, numeroSerie: 'A-100' });
      assert.equal(status, 409);
      assert.equal(body.codigo, 'NUMERO_SERIE_REPETIDO');
      assert.equal(llamadas('POST', '/api/operativa/sensibilizacion').length, 0);
    });

    test('sin token: 401', async () => {
      const { status } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', {}, nn);
      assert.equal(status, 401);
    });
  });

  describe('PATCH /operativa/sensibilizacion/:id', () => {
    test('sin permiso de escritura: 403 y no edita', async () => {
      const { status, body } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': SIN_PERMISO }, { observaciones: 'x' });
      assert.equal(status, 403);
      assert.equal(body.codigo, 'SIN_PERMISO');
      assert.equal(llamadas('PATCH', '/api/operativa/sensibilizacion/100').length, 0);
    });

    test('con permiso: envía el registro completo con los cambios', async () => {
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO },
        { observaciones: 'completada', completo: true, motivo: 'Cierre de acta', idUsuario: 999, esNn: false });
      assert.equal(status, 200);
      const enviado = llamadas('PATCH', '/api/operativa/sensibilizacion/100')[0].body;
      assert.equal(enviado.observaciones, 'completada');
      assert.equal(enviado.completo, true);
      assert.equal(enviado.retiraElementosEspacioPublico, true, 'conserva lo que no se cambió');
      assert.equal(enviado.idUsuario, 7, 'quien registró no cambia');
      assert.equal(enviado.localizacion, 'POINT (-75.56 6.25)');
      assert.equal(enviado.motivo_cambio, 'Cierre de acta');
      assert.equal(enviado.esNn, undefined);
      assert.equal(enviado.territorio, undefined);
    });

    test('grupo 0 (administrador) no consulta permisos', async () => {
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': ADMIN }, { observaciones: 'adm' });
      assert.equal(status, 200);
      assert.equal(llamadas('GET', '/api/seguridad/permisoModuloGrupo').length, 0);
    });

    test('asignar vendedor a una NN', async () => {
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO }, { idPersona: 321 });
      assert.equal(status, 200);
      assert.equal(llamadas('PATCH', '/api/operativa/sensibilizacion/100')[0].body.idPersona, 321);
    });

    test('quitar el territorio a una NN: 422', async () => {
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO }, { idSectorInterno: null });
      assert.equal(status, 422);
    });

    test('inexistente: 404', async () => {
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/999', { 'x-access': CON_PERMISO }, { observaciones: 'x' });
      assert.equal(status, 404);
    });

    test('token vencido: 401 con sesionVencida', async () => {
      const { status, body } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100', { 'x-access': 'vencido' }, { observaciones: 'x' });
      assert.equal(status, 401);
      assert.equal(body.sesionVencida, true);
    });
  });

  describe('Consultas', () => {
    test('detalle: sensibilización, puesto, titular y fichas en una llamada', async () => {
      const { status, body } = await httpRequest(port, 'GET', '/operativa/sensibilizacion/100', { 'x-access': CON_PERMISO });
      assert.equal(status, 200);
      assert.equal(body.sensibilizacion.id, 100);
      assert.equal(body.datosVenta.id, 55);
      assert.equal(body.titular, null);
      assert.equal(body.formal.id, 9);
      assert.equal(body.informal, null);
    });

    test('listado: solo pasa los filtros permitidos', async () => {
      await httpRequest(port, 'GET', '/operativa/sensibilizacion?idSectorInterno=3&esNn=true&rara=1', { 'x-access': CON_PERMISO });
      const q = llamadas('GET', '/api/operativa/sensibilizacion')[0].query;
      assert.equal(q.idSectorInterno, '3');
      assert.equal(q.esNn, 'true');
      assert.equal(q.rara, undefined);
    });

    test('historial, catálogo y puesto de un ventero', async () => {
      assert.equal((await httpRequest(port, 'GET', '/operativa/sensibilizacion/100/historial', { 'x-access': CON_PERMISO })).status, 200);
      assert.equal((await httpRequest(port, 'GET', '/dominios/tipoSensibilizacion', { 'x-access': CON_PERMISO })).status, 200);
      const puesto = await httpRequest(port, 'GET', '/ventero/321/puesto', { 'x-access': CON_PERMISO });
      assert.equal(puesto.body[0].idVentero, 321);
    });
  });

  describe('Fichas formal / informal', () => {
    test('crear: las preguntas no enviadas van en false', async () => {
      const { status } = await httpRequest(port, 'POST', '/operativa/sensibilizacion/100/informal', { 'x-access': CON_PERMISO }, { cumpleClaseVenta: true });
      assert.equal(status, 201);
      const enviado = llamadas('POST', '/api/operativa/sensibilizacionInformales')[0].body;
      assert.equal(enviado.cumpleClaseVenta, true);
      assert.equal(enviado.actividadProhibida, false);
      assert.equal(enviado.idSensibilizacion, 100);
    });

    test('crear cuando ya existe: 409', async () => {
      const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion/100/formal', { 'x-access': CON_PERMISO }, {});
      assert.equal(status, 409);
      assert.equal(body.codigo, 'FICHA_EXISTENTE');
    });

    test('editar: registro completo y verificación de permiso', async () => {
      const sin = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100/formal', { 'x-access': SIN_PERMISO }, { autoBazares: true });
      assert.equal(sin.status, 403);
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100/formal', { 'x-access': CON_PERMISO }, { autoBazares: true });
      assert.equal(status, 200);
      const enviado = llamadas('PATCH', '/api/operativa/sensibilizacionFormales/9')[0].body;
      assert.equal(enviado.autoBazares, true);
      assert.equal(enviado.nombreEstablecimiento, 'Tienda');
      assert.equal(enviado.cumpleActividadEconomica, true);
    });

    test('editar una ficha que no existe: 404', async () => {
      const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/100/informal', { 'x-access': CON_PERMISO }, { cumpleClaseVenta: true });
      assert.equal(status, 404);
    });
  });
});
