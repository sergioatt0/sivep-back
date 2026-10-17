'use strict';

// Pruebas de contrato del puesto de venta (datos_venta) contra un mock que se
// comporta como el SISDEP REAL: valida que el cuerpo del PATCH traiga el id de
// la ruta, que las columnas NOT NULL no viajen en null y que idVentero sea
// UNIQUE. Los tests previos mockeaban "acepto todo" y daban falsa confianza.
//
// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
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

const PUESTO_ID = 55;
const VENTERO_CON_PUESTO = 300;
const VENTERO_SIN_PUESTO = 301;

const PUESTO_FIXTURE = {
  id: PUESTO_ID,
  idVentero: VENTERO_CON_PUESTO,
  idClaseVenta: 1,
  desActividadEconomica: 'Comercio al por menor',
  idDireccion: 100123,
  nombreEstablecimiento: 'Tienda Doña Ana',
  observaciones: null
};

/** Entero estricto: igual que SISDEP, no acepta null, decimales ni texto. */
function entero(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) ? valor : null;
  if (typeof valor === 'string' && /^[+-]?\d+$/.test(valor.trim())) return Number(valor);
  return null;
}

/**
 * Mock de SISDEP con estado. A diferencia del mock "acepto todo", este:
 * - exige el id de la ruta en el cuerpo del PATCH (409 "El id del item no concuerda.");
 * - devuelve 409 si el PATCH manda idClaseVenta: null (simula NOT NULL);
 * - devuelve 409 si el POST repite idVentero (simula UNIQUE);
 * - responde 202 en los PATCH válidos.
 */
function startSisdepMock() {
  return new Promise((resolve) => {
    let modo = 'ok'; // 'ok' | 'forbidden'
    let puestos;
    let siguienteId;
    const requests = [];

    const reset = () => {
      puestos = { [PUESTO_ID]: { ...PUESTO_FIXTURE } };
      siguienteId = PUESTO_ID + 1;
      modo = 'ok';
    };
    reset();

    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (raw) {
          try { body = JSON.parse(raw); } catch { body = raw; }
        }
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;
        const q = Object.fromEntries(url.searchParams);
        requests.push({ method: req.method, path: p, query: q, headers: req.headers, body });

        res.setHeader('Content-Type', 'application/json');
        const responder = (status, json) => { res.statusCode = status; return res.end(JSON.stringify(json)); };
        const entidades = (nombre, filas) => ({ entities: { [nombre]: Object.fromEntries(filas.map((f) => [f.id, f])) } });

        if (!req.headers['x-access']) return responder(401, { message: 'Token inválido' });

        // ---- Catálogo de clase de venta ----
        if (req.method === 'GET' && p === '/api/dominios/claseVenta') {
          return responder(200, { entities: { claseVenta: {
            1: { id: 1, descripcion: 'Ambulante' },
            2: { id: 2, descripcion: 'Semiestacionaria' },
            3: { id: 3, descripcion: 'Estacionaria' }
          } } });
        }

        // ---- Lista por idVentero ----
        if (req.method === 'GET' && p === '/api/ventero/datosVenta') {
          const filas = Object.values(puestos)
            .filter((x) => !q.idVentero || String(x.idVentero) === String(q.idVentero));
          return responder(200, entidades('datosVenta', filas));
        }

        const porId = p.match(/^\/api\/ventero\/datosVenta\/(\d+)$/);

        // ---- Detalle por id ----
        if (req.method === 'GET' && porId) {
          const actual = puestos[Number(porId[1])];
          if (!actual) return responder(404, { errors: [{ title: 'No encontrado', detail: 'Puesto no encontrado' }] });
          return responder(200, actual);
        }

        // ---- Crear: idVentero es UNIQUE en la base ----
        if (req.method === 'POST' && p === '/api/ventero/datosVenta') {
          if (modo === 'forbidden') return responder(403, { message: 'No autorizado' });
          const idVentero = body?.idVentero;
          if (idVentero !== undefined
              && Object.values(puestos).some((x) => String(x.idVentero) === String(idVentero))) {
            return responder(409, { errors: [{ detail: 'El idVentero ya está registrado.' }] });
          }
          const nuevo = { ...(body || {}), id: siguienteId++ };
          puestos[nuevo.id] = nuevo;
          return responder(201, nuevo);
        }

        // ---- Actualizar: SISDEP exige el id de la ruta dentro del cuerpo ----
        if (req.method === 'PATCH' && porId) {
          const id = Number(porId[1]);
          if (!body || entero(body.id) !== id) {
            return responder(409, { errors: [{ detail: 'El id del item no concuerda.' }] });
          }
          if (body.idClaseVenta === null) {
            return responder(409, { errors: [{ detail: 'null value in column "idclaseventa" violates not-null constraint' }] });
          }
          if (modo === 'forbidden') return responder(403, { message: 'No autorizado' });
          const actual = puestos[id];
          if (!actual) return responder(404, { errors: [{ title: 'No encontrado', detail: 'Puesto no encontrado' }] });
          const { id: _ignorado, ...cambios } = body;
          Object.assign(actual, cambios);
          return responder(202, actual);
        }

        // ---- Sensibilización: solo lo necesario para la lista blanca ----
        if (req.method === 'GET' && p === '/api/operativa/sensibilizacion') {
          return responder(200, entidades('sensibilizacion', []));
        }
        if (req.method === 'POST' && p === '/api/operativa/sensibilizacion') {
          const nueva = { ...(body || {}), id: 900 };
          return responder(201, entidades('sensibilizacion', [nueva]));
        }

        return responder(404, { message: 'Ruta mock no reconocida: ' + req.method + ' ' + req.url });
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        requests,
        setModo: (m) => { modo = m; },
        reset: () => { reset(); requests.length = 0; },
        clearRequests: () => { requests.length = 0; },
        getPuesto: (id) => puestos[id],
        buscarPorVentero: (idVentero) => Object.values(puestos)
          .find((x) => String(x.idVentero) === String(idVentero)) ?? null
      });
    });
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
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('Puesto de venta: contrato real de SISDEP', () => {
  let sisdep;
  let appServer;
  let appPort;

  // Escrituras de datos_venta que llegaron al mock (deja fuera los GET de apoyo).
  const escriturasPuesto = () => sisdep.requests.filter((r) =>
    (r.method === 'POST' || r.method === 'PATCH') && r.path.startsWith('/api/ventero/datosVenta'));
  const peticiones = (metodo, ruta) => sisdep.requests.filter((r) => r.method === metodo && r.path === ruta);

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    appPort = appServer.address().port;
  });

  beforeEach(() => sisdep.reset());

  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  // ------------------------------------------------------------------
  // Sanidad del mock: si el mock no rechazara lo que rechaza SISDEP, los
  // casos de abajo pasarian por la razón equivocada.
  // ------------------------------------------------------------------
  describe('el mock imita a SISDEP real (sanidad)', () => {
    test('PATCH sin id en el cuerpo: 409 "El id del item no concuerda."', async () => {
      const { status, body } = await httpRequest(sisdep.port, 'PATCH', `/api/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idClaseVenta: 2 });
      assert.equal(status, 409);
      assert.equal(body.errors[0].detail, 'El id del item no concuerda.');
    });

    test('PATCH con id distinto al de la ruta: 409', async () => {
      const { status } = await httpRequest(sisdep.port, 'PATCH', `/api/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { id: 999, idClaseVenta: 2 });
      assert.equal(status, 409);
    });

    test('PATCH con idClaseVenta null: 409 (simula NOT NULL)', async () => {
      const { status } = await httpRequest(sisdep.port, 'PATCH', `/api/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { id: PUESTO_ID, idClaseVenta: null });
      assert.equal(status, 409);
    });

    test('POST con idVentero repetido: 409 (simula UNIQUE)', async () => {
      const { status } = await httpRequest(sisdep.port, 'POST', '/api/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_CON_PUESTO, idClaseVenta: 1, desActividadEconomica: 'Comercio' });
      assert.equal(status, 409);
    });

    test('PATCH válido: 202 con el objeto actualizado', async () => {
      const { status, body } = await httpRequest(sisdep.port, 'PATCH', `/api/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { id: PUESTO_ID, idClaseVenta: 3 });
      assert.equal(status, 202);
      assert.equal(body.idClaseVenta, 3);
    });
  });

  // ------------------------------------------------------------------
  // Caso 1, 2, 5 (PATCH) y 7 (403)
  // ------------------------------------------------------------------
  describe('PATCH /ventero/datosVenta/:id', () => {
    test('1. cambia idClaseVenta sin mandar id (el proxy inyecta el de la ruta)', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idClaseVenta: 2 });

      assert.notEqual(status, 409, 'no debe chocar con el control de id de SISDEP');
      assert.ok(status === 200 || status === 202, `esperaba 200/202 y recibí ${status}`);

      const patch = sisdep.requests.filter((r) => r.method === 'PATCH').at(-1);
      assert.ok(patch, 'no llegó el PATCH a SISDEP');
      assert.equal(patch.path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(patch.body.id, PUESTO_ID, 'SISDEP exige el id de la ruta en el cuerpo');
      assert.equal(patch.body.idClaseVenta, 2, 'la clase de venta nueva viaja en el cuerpo');
      assert.equal(patch.body.idVentero, VENTERO_CON_PUESTO, 'se fusiona el registro actual');
      assert.equal(sisdep.getPuesto(PUESTO_ID).idClaseVenta, 2, 'SISDEP aplicó el cambio');
    });

    test('2. idClaseVenta: null no se reenvía y la operación no rompe', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idClaseVenta: null, idDireccion: 999 });

      assert.notEqual(status, 409, 'SISDEP respondió 409: el null viajó al upstream');
      assert.ok(status === 200 || status === 202, `esperaba 200/202 y recibí ${status}`);

      const patch = sisdep.requests.filter((r) => r.method === 'PATCH').at(-1);
      assert.equal(Object.prototype.hasOwnProperty.call(patch.body, 'idClaseVenta'), false,
        'la columna NOT NULL no debe viajar como null');
      assert.equal(patch.body.idDireccion, 999, 'el resto de cambios sí se reenvía');
      assert.equal(sisdep.getPuesto(PUESTO_ID).idClaseVenta, 1, 'conserva el valor actual');
    });

    test('5b. idClaseVenta fuera del catálogo: 422 DATOS_INVALIDOS sin escribir en SISDEP', async () => {
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idClaseVenta: 4 });

      assert.equal(status, 422);
      assert.equal(body.success, false);
      assert.equal(body.codigo, 'DATOS_INVALIDOS');
      assert.match(body.message, /idClaseVenta/);
      assert.equal(escriturasPuesto().length, 0, 'no debe intentar escribir el puesto');
      assert.equal(sisdep.getPuesto(PUESTO_ID).idClaseVenta, 1, 'el puesto no cambió');
    });

    test('7b. 403 del upstream: 403 con mensaje de permiso sobre el puesto de venta', async () => {
      sisdep.setModo('forbidden');
      const { status, body } = await httpRequest(appPort, 'PATCH', `/ventero/datosVenta/${PUESTO_ID}`,
        { 'x-access': 'tok' }, { idDireccion: 100200 });

      assert.equal(status, 403);
      assert.equal(body.success, false);
      assert.match(body.message, /puesto de venta/i);
      assert.match(body.message, /permiso/i);
    });
  });

  // ------------------------------------------------------------------
  // Casos 3, 4, 5 (POST), 6 y 7 (403 al crear)
  // ------------------------------------------------------------------
  describe('POST /ventero/datosVenta (upsert)', () => {
    test('3. ventero con puesto: actualiza por PATCH y no manda POST (sin 409)', async () => {
      sisdep.clearRequests();
      const { status } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_CON_PUESTO, idDireccion: 4567 });

      assert.notEqual(status, 409, 'no debe chocar con el UNIQUE de idVentero');
      assert.ok(status === 200 || status === 202, `esperaba 200/202 y recibí ${status}`);

      assert.equal(peticiones('POST', '/api/ventero/datosVenta').length, 0,
        'el POST no debe llegar a SISDEP (rebotaría por UNIQUE)');

      const patch = sisdep.requests.filter((r) => r.method === 'PATCH').at(-1);
      assert.ok(patch, 'no llegó el PATCH a SISDEP');
      assert.equal(patch.path, `/api/ventero/datosVenta/${PUESTO_ID}`);
      assert.equal(patch.body.id, PUESTO_ID);
      assert.equal(sisdep.getPuesto(PUESTO_ID).idDireccion, 4567, 'SISDEP aplicó la actualización');
    });

    test('4. ventero sin puesto: crea con 201', async () => {
      sisdep.clearRequests();
      const payload = {
        idVentero: VENTERO_SIN_PUESTO,
        idClaseVenta: 2,
        desActividadEconomica: 'Semiestacionaria',
        idDireccion: 7001
      };
      const { status } = await httpRequest(appPort, 'POST', '/ventero/datosVenta', { 'x-access': 'tok' }, payload);

      assert.equal(status, 201);
      const post = sisdep.requests.filter((r) => r.method === 'POST' && r.path === '/api/ventero/datosVenta').at(-1);
      assert.ok(post, 'no llegó el POST a SISDEP');
      assert.equal(post.body.id, undefined, 'el id lo asigna SISDEP, no el proxy');
      assert.equal(post.body.idVentero, VENTERO_SIN_PUESTO);
      assert.equal(post.body.idClaseVenta, 2);

      const creado = sisdep.buscarPorVentero(VENTERO_SIN_PUESTO);
      assert.ok(creado, 'SISDEP no registró el puesto nuevo');
      assert.equal(creado.idDireccion, 7001);
    });

    test('5a. idClaseVenta fuera del catálogo: 422 DATOS_INVALIDOS sin escribir en SISDEP', async () => {
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_SIN_PUESTO, idClaseVenta: 4, desActividadEconomica: 'Comercio' });

      assert.equal(status, 422);
      assert.equal(body.codigo, 'DATOS_INVALIDOS');
      assert.match(body.message, /idClaseVenta/);
      assert.equal(escriturasPuesto().length, 0, 'no debe intentar escribir el puesto');
      assert.equal(sisdep.buscarPorVentero(VENTERO_SIN_PUESTO), null, 'no se creó nada');
    });

    test('6. sin desActividadEconomica: 422 y no llama a SISDEP para escribir', async () => {
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_SIN_PUESTO, idClaseVenta: 1 });

      assert.equal(status, 422);
      assert.equal(body.success, false);
      assert.equal(body.codigo, 'DATOS_INVALIDOS');
      assert.match(body.message, /desActividadEconomica/);
      assert.equal(escriturasPuesto().length, 0, 'no debe intentar escribir el puesto');
    });

    test('7a. 403 del upstream al crear: 403 con mensaje de permiso sobre el puesto de venta', async () => {
      sisdep.setModo('forbidden');
      const { status, body } = await httpRequest(appPort, 'POST', '/ventero/datosVenta',
        { 'x-access': 'tok' }, { idVentero: VENTERO_SIN_PUESTO, idClaseVenta: 1, desActividadEconomica: 'Comercio' });

      assert.equal(status, 403);
      assert.equal(body.success, false);
      assert.match(body.message, /puesto de venta/i);
      assert.match(body.message, /permiso/i);
    });
  });

  // ------------------------------------------------------------------
  // Caso 8: lista blanca de sensibilizaciones
  // ------------------------------------------------------------------
  describe('Sensibilizaciones: lista blanca de campos', () => {
    const payloadBase = {
      numeroSerie: 'CONTRATO-1',
      idTipo: 1,
      fecha: '2026-10-07T10:00:00',
      idSectorInterno: 3,
      latitud: 6.2,
      longitud: -75.5
    };

    test('8. una clave desconocida no se reenvía y la respuesta no cambia (no 422)', async () => {
      sisdep.clearRequests();
      const { status, body } = await httpRequest(appPort, 'POST', '/operativa/sensibilizacion',
        { 'x-access': CON_PERMISO }, { ...payloadBase, campoInventado: 1 });

      assert.notEqual(status, 422, 'la clave desconocida no debe invalidar el payload');
      assert.equal(status, 201);
      assert.equal(body.success, true);

      const post = peticiones('POST', '/api/operativa/sensibilizacion').at(-1);
      assert.ok(post, 'no llegó el POST a SISDEP');
      assert.equal(Object.prototype.hasOwnProperty.call(post.body, 'campoInventado'), false,
        'el proxy no debe reenviar la clave desconocida');
      assert.equal(post.body.numeroSerie, 'CONTRATO-1', 'los campos permitidos sí viajan');
    });

    test('8b. registra en consola el nombre de la clave descartada (sin valores)', async () => {
      const avisos = [];
      const warnOriginal = console.warn;
      console.warn = (...args) => { avisos.push(args.join(' ')); };
      try {
        await httpRequest(appPort, 'POST', '/operativa/sensibilizacion',
          { 'x-access': CON_PERMISO }, { ...payloadBase, campoInventado: 1 });
      } finally {
        console.warn = warnOriginal;
      }

      const aviso = avisos.find((a) => a.includes('POST /operativa/sensibilizacion'));
      assert.ok(aviso, `no se registró el aviso de claves descartadas. Avisos: ${JSON.stringify(avisos)}`);
      assert.match(aviso, /campoInventado/, 'el aviso debe nombrar la clave descartada');
      assert.doesNotMatch(aviso, /campoInventado['"]?\s*[:=]\s*\d/, 'el aviso no debe incluir valores');
    });
  });
});
