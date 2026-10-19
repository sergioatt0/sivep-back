'use strict';

// Sensibilizaciones NN con su puesto de venta (dirección, clase de venta, actividad).
// Antes la NN no podía tener puesto (datos_venta exigía ventero) y esos datos se
// perdían. Ahora el POST/PATCH de la sensibilización acepta `datosVenta` anidado.

process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function token(userId, groupId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ userId, groupId })}.firma`;
}
const CON_PERMISO = token(40, 5);

function startSisdepMock() {
  return new Promise((resolve) => {
    const estado = {};
    const reset = () => {
      estado.sensis = {
        300: { id: 300, numeroSerie: 'NN-300', idTipo: 1, fecha: '2026-10-19T09:00:00', idUsuario: 7, idPersona: null,
          esNn: true, idSectorInterno: 3, latitud: 6.25, longitud: -75.56, idDatosVenta: 77, completo: false }
      };
      // 77 = puesto de la NN 300 (sin ventero); 88 = puesto del ventero 900.
      estado.puestos = {
        77: { id: 77, idVentero: null, idClaseVenta: 2, desActividadEconomica: 'Frutas', idDireccion: 501 },
        88: { id: 88, idVentero: 900, idClaseVenta: 1, desActividadEconomica: 'Dulces', idDireccion: 600 }
      };
      estado.siguienteId = 1000;
      estado.fallarSensibilizacion = false;
    };
    reset();
    const requests = [];

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        const url = new URL(req.url, 'http://x');
        requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
        res.setHeader('Content-Type', 'application/json');
        const ok = (status, json) => { res.statusCode = status; res.end(JSON.stringify(json)); };
        const ent = (nombre, filas) => ({ entities: { [nombre]: Object.fromEntries(filas.map((f) => [f.id, f])) } });
        const p = url.pathname;
        const q = Object.fromEntries(url.searchParams);

        if (p === '/api/seguridad/permisoModuloGrupo') {
          return ok(200, ent('permisoModuloGrupo', [{ id: 1, idGrupo: Number(q.idGrupo), idModuloSistema: Number(q.idModuloSistema), leer: true, escribir: q.idGrupo === '5' }]));
        }
        if (p === '/api/dominios/claseVenta') return ok(200, ent('claseVenta', [{ id: 1 }, { id: 2 }, { id: 3 }]));

        // Puesto de venta
        if (p === '/api/ventero/datosVenta' && req.method === 'GET') {
          const filas = Object.values(estado.puestos).filter((d) => (!q.idVentero || String(d.idVentero) === q.idVentero)
            && (!q.idDireccion || String(d.idDireccion) === q.idDireccion));
          return ok(200, ent('datosVenta', filas));
        }
        if (p === '/api/ventero/datosVenta' && req.method === 'POST') {
          const nuevo = { idVentero: null, ...body, id: estado.siguienteId++ };
          estado.puestos[nuevo.id] = nuevo;
          return ok(201, nuevo);
        }
        let m = p.match(/^\/api\/ventero\/datosVenta\/(\d+)$/);
        if (m) {
          const d = estado.puestos[m[1]];
          if (!d) return ok(404, { errors: [{ detail: 'Item no encontrado.' }] });
          if (req.method === 'GET') return ok(200, d);
          if (req.method === 'PATCH') { Object.assign(d, body); return ok(200, d); }
          if (req.method === 'DELETE') { delete estado.puestos[m[1]]; return ok(200, 'eliminado'); }
        }

        // Sensibilización
        if (p === '/api/operativa/sensibilizacion' && req.method === 'GET') {
          const filas = Object.values(estado.sensis).filter((s) => !q.numeroSerie || s.numeroSerie === q.numeroSerie);
          return ok(200, ent('sensibilizacion', filas));
        }
        if (p === '/api/operativa/sensibilizacion' && req.method === 'POST') {
          if (estado.fallarSensibilizacion) return ok(409, { errors: [{ title: 'Error creando', detail: 'falla simulada' }] });
          const nueva = { ...body, id: estado.siguienteId++, esNn: body.idPersona == null };
          estado.sensis[nueva.id] = nueva;
          return ok(201, ent('sensibilizacion', [nueva]));
        }
        m = p.match(/^\/api\/operativa\/sensibilizacion\/(\d+)$/);
        if (m) {
          const s = estado.sensis[m[1]];
          if (!s) return ok(404, { errors: [{ detail: 'Item no encontrado.' }] });
          if (req.method === 'GET') return ok(200, ent('sensibilizacion', [s]));
          if (req.method === 'PATCH') { Object.assign(s, body); return ok(200, ent('sensibilizacion', [s])); }
        }
        ok(404, { message: 'Ruta mock no reconocida: ' + req.method + ' ' + req.url });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests, reset, estado }));
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

describe('Sensibilización NN con puesto de venta', () => {
  let sisdep;
  let appServer;
  let port;
  const llamadas = (metodo, ruta) => sisdep.requests.filter((r) => r.method === metodo && r.path === ruta);
  const H = { 'x-access': CON_PERMISO };
  const nn = { numeroSerie: 'NN-1', idTipo: 1, fecha: '2026-10-19T10:00:00', idSectorInterno: 3, latitud: 6.2, longitud: -75.5 };
  const puesto = { idClaseVenta: 2, desActividadEconomica: 'Venta de frutas', idDireccion: 700, observaciones: 'esquina' };

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

  test('crear NN con datosVenta: crea el puesto SIN ventero y lo enlaza (idDatosVenta)', async () => {
    const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', H, { ...nn, datosVenta: puesto });
    assert.equal(status, 201);
    const [postPuesto] = llamadas('POST', '/api/ventero/datosVenta');
    assert.ok(postPuesto, 'debe crear el puesto');
    assert.equal(postPuesto.body.idVentero, undefined, 'el puesto de una NN no lleva ventero');
    assert.equal(postPuesto.body.idClaseVenta, 2);
    assert.equal(postPuesto.body.idDireccion, 700);
    assert.equal(postPuesto.body.idSectorInterno, 3, 'toma el territorio de la sensibilización, como SISDEP');
    const [postSensi] = llamadas('POST', '/api/operativa/sensibilizacion');
    assert.equal(postSensi.body.idDatosVenta, body.datosVenta.id, 'la sensibilización queda enlazada al puesto');
    assert.equal(body.datosVenta.desActividadEconomica, 'Venta de frutas');
    assert.equal(body.camposDescartados, undefined);
  });

  test('crear NN: datosVenta sin clase de venta → 422 y no se crea nada', async () => {
    const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', H,
      { ...nn, datosVenta: { desActividadEconomica: 'x' } });
    assert.equal(status, 422);
    assert.match(body.message, /idClaseVenta/);
    assert.equal(llamadas('POST', '/api/ventero/datosVenta').length, 0);
    assert.equal(llamadas('POST', '/api/operativa/sensibilizacion').length, 0);
  });

  test('crear NN: si SISDEP rechaza la sensibilización, se deshace el puesto recién creado', async () => {
    sisdep.estado.fallarSensibilizacion = true;
    const { status } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', H, { ...nn, datosVenta: puesto });
    assert.equal(status, 409);
    const [creado] = llamadas('POST', '/api/ventero/datosVenta');
    assert.ok(creado);
    assert.equal(llamadas('DELETE', '/api/ventero/datosVenta/1000').length, 1, 'borra el puesto huérfano');
  });

  test('editar NN: actualiza su puesto existente (sin crear otro) y conserva lo que no cambia', async () => {
    const { status, body } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/300', H,
      { datosVenta: { idClaseVenta: 3, idDireccion: 999 } });
    assert.equal(status, 200);
    assert.equal(llamadas('POST', '/api/ventero/datosVenta').length, 0);
    const [patch] = llamadas('PATCH', '/api/ventero/datosVenta/77');
    assert.equal(patch.body.idClaseVenta, 3);
    assert.equal(patch.body.idDireccion, 999);
    assert.equal(patch.body.desActividadEconomica, 'Frutas', 'conserva la actividad que no se mandó');
    assert.equal(patch.body.idVentero, undefined);
    assert.equal(body.sensibilizacion.idDatosVenta, 77);
  });

  test('editar NN sin puesto: lo crea y lo enlaza', async () => {
    sisdep.estado.sensis[300].idDatosVenta = null;
    const { status, body } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/300', H, { datosVenta: puesto });
    assert.equal(status, 200);
    assert.equal(llamadas('POST', '/api/ventero/datosVenta').length, 1);
    assert.equal(body.sensibilizacion.idDatosVenta, body.datosVenta.id);
  });

  test('con vendedor: usa (upsert) el puesto del ventero y no manda idDatosVenta', async () => {
    const { status } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', H,
      { ...nn, numeroSerie: 'V-1', idPersona: 900, datosVenta: { idDireccion: 610 } });
    assert.equal(status, 201);
    const [patch] = llamadas('PATCH', '/api/ventero/datosVenta/88');
    assert.equal(patch.body.idVentero, 900);
    assert.equal(patch.body.idDireccion, 610);
    const [postSensi] = llamadas('POST', '/api/operativa/sensibilizacion');
    assert.equal(postSensi.body.idDatosVenta, undefined, 'con vendedor el enlace lo deriva SISDEP');
  });

  test('asignar vendedor sin puesto a una NN con datosVenta: el puesto de la NN pasa al ventero', async () => {
    const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/300', H,
      { idPersona: 950, datosVenta: { observaciones: 'identificado' } });
    assert.equal(status, 200);
    assert.equal(llamadas('POST', '/api/ventero/datosVenta').length, 0, 'no crea otro puesto');
    const [patch] = llamadas('PATCH', '/api/ventero/datosVenta/77');
    assert.equal(patch.body.idVentero, 950);
    assert.equal(patch.body.idDireccion, 501, 'conserva la dirección de la NN');
  });

  test('campos que no son de la sensibilización se informan en camposDescartados', async () => {
    const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', H,
      { ...nn, numeroSerie: 'NN-2', direccionTexto: 'CL 50', datosVenta: puesto });
    assert.equal(status, 201);
    assert.deepEqual(body.camposDescartados, ['direccionTexto']);
  });

  test('dirección que ya es de otro puesto → 422 con el motivo real, sin crear nada', async () => {
    const { status, body } = await httpRequest(port, 'POST', '/operativa/sensibilizacion', H,
      { ...nn, numeroSerie: 'NN-3', datosVenta: { ...puesto, idDireccion: 600 } });
    assert.equal(status, 422);
    assert.match(body.message, /dirección 600 ya pertenece a otro puesto/);
    assert.equal(llamadas('POST', '/api/ventero/datosVenta').length, 0);
    assert.equal(llamadas('POST', '/api/operativa/sensibilizacion').length, 0);
  });

  test('editar el puesto de la NN conservando su propia dirección no es conflicto', async () => {
    const { status } = await httpRequest(port, 'PATCH', '/operativa/sensibilizacion/300', H,
      { datosVenta: { idDireccion: 501, observaciones: 'misma dirección' } });
    assert.equal(status, 200);
  });
});
