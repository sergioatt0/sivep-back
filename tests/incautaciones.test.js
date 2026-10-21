'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TOKEN = 'tok-incautaciones';
const DETALLE_ERROR = 'El acta no existe en SISDEP';

const PREFIJO_RECONOCIMIENTO = '/api/operativa/reconocimientoIncautacion';
const PREFIJO_ACTA = '/api/operativa/actaInventario';

const RECONOCIMIENTO = {
  id: 77,
  numeroActa: 'ACT-2024-001',
  fechaIncautacion: '2024-05-01',
  idVentero: 1234,
  observacion: 'Reconocimiento de prueba'
};

const ACTA = {
  id: 88,
  numeroActa: 'ACTA-2024-007',
  idReconocimiento: 77,
  observacion: 'Acta de prueba'
};

// Bytes binarios: incluye 0x00 y 0xff para probar que el proxy no rompe el archivo.
const ARCHIVO_PDF = Buffer.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xc3, 0xa9,
  0x00, 0xff, 0xfe, 0x0d, 0x0a
]);

const pagina = (item) => ({ content: [item], totalElements: 1, totalPages: 1, number: 0, size: 10 });

function parseMultipart(rawBody, contentType) {
  const coincidencia = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  if (!coincidencia) return null;
  const delimitador = Buffer.from(`--${coincidencia[1] || coincidencia[2]}`);
  const campos = [];
  let posicion = rawBody.indexOf(delimitador);
  while (posicion !== -1) {
    const inicio = posicion + delimitador.length;
    if (rawBody.slice(inicio, inicio + 2).toString('utf8') === '--') break;
    const fin = rawBody.indexOf(delimitador, inicio);
    if (fin === -1) break;
    let cuerpo = rawBody.slice(inicio, fin);
    if (cuerpo.slice(0, 2).toString('utf8') === '\r\n') cuerpo = cuerpo.slice(2);
    if (cuerpo.slice(-2).toString('utf8') === '\r\n') cuerpo = cuerpo.slice(0, -2);
    const separador = cuerpo.indexOf('\r\n\r\n');
    const cabeceras = cuerpo.slice(0, separador).toString('utf8');
    const contenido = cuerpo.slice(separador + 4);
    campos.push({
      nombre: /name="([^"]*)"/.exec(cabeceras)?.[1],
      nombreArchivo: /filename="([^"]*)"/.exec(cabeceras)?.[1],
      contenido
    });
    posicion = fin;
  }
  const info = campos.find((c) => c.nombre === 'info');
  const archivo = campos.find((c) => c.nombreArchivo !== undefined);
  return {
    campos,
    info: info ? JSON.parse(info.contenido.toString('utf8')) : null,
    archivo: archivo ? { nombre: archivo.nombreArchivo, bytes: archivo.contenido } : null
  };
}

// Mock de SISDEP: registra método, ruta exacta, headers y body (JSON o multipart).
function startSisdepMock() {
  return new Promise((resolve) => {
    let mode = 'ok'; // 'ok' | 'auth-fail' | 'error-sisdep' | 'destruir'
    let respuestaDelete = 'sin-cuerpo'; // 'sin-cuerpo' (204) | 'nulo' (200 + JSON null)
    const requests = [];

    const server = http.createServer((req, res) => {
      const trozos = [];
      req.on('data', (t) => trozos.push(t));
      req.on('end', () => {
        const rawBody = Buffer.concat(trozos);
        const registro = {
          method: req.method,
          path: req.url,
          ruta: req.url.split('?')[0],
          headers: req.headers,
          rawBody,
          body: null,
          multipart: null
        };
        if (rawBody.length) {
          const contentType = String(req.headers['content-type'] || '');
          if (contentType.startsWith('multipart/form-data')) {
            registro.multipart = parseMultipart(rawBody, contentType);
          } else {
            try { registro.body = JSON.parse(rawBody.toString('utf8')); } catch { registro.body = rawBody.toString('utf8'); }
          }
        }
        requests.push(registro);

        // Simula que SISDEP corta la conexión sin responder.
        if (mode === 'destruir') {
          req.socket.destroy();
          return;
        }

        const responder = (status, data, conCuerpo = true) => {
          res.statusCode = status;
          if (!conCuerpo) return res.end();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };

        if (mode === 'auth-fail' || !req.headers['x-access']) {
          return responder(401, { message: 'Token inválido' });
        }
        if (mode === 'error-sisdep') {
          return responder(500, { errors: [{ title: 'Error', detail: DETALLE_ERROR }] });
        }

        const ruta = registro.ruta;
        const info = registro.multipart?.info ?? null;
        const recibeArchivo = Boolean(registro.multipart?.archivo);

        // --- reconocimiento de incautación ---
        if (ruta === `${PREFIJO_RECONOCIMIENTO}/paginated` && req.method === 'GET') {
          return responder(200, pagina(RECONOCIMIENTO));
        }
        if (ruta === PREFIJO_RECONOCIMIENTO && req.method === 'GET') {
          return responder(200, [RECONOCIMIENTO]);
        }
        if (ruta === PREFIJO_RECONOCIMIENTO && req.method === 'POST') {
          return responder(201, { id: 501, ...(registro.body || {}) });
        }
        const reconocimientoId = ruta.match(/^\/api\/operativa\/reconocimientoIncautacion\/(\d+)$/);
        if (reconocimientoId) {
          const id = Number(reconocimientoId[1]);
          if (req.method === 'GET') return responder(200, { ...RECONOCIMIENTO, id });
          if (req.method === 'PATCH') return responder(200, { ...RECONOCIMIENTO, id, ...(registro.body || {}) });
          if (req.method === 'DELETE') {
            return respuestaDelete === 'nulo' ? responder(200, null) : responder(204, null, false);
          }
        }

        // --- acta de inventario ---
        if (ruta === `${PREFIJO_ACTA}/paginated` && req.method === 'GET') {
          return responder(200, pagina(ACTA));
        }
        if (ruta === `${PREFIJO_ACTA}/stream` && req.method === 'GET') {
          return responder(200, { total: 1, registros: [ACTA] });
        }
        if (ruta === PREFIJO_ACTA && req.method === 'GET') {
          return responder(200, [ACTA]);
        }
        if (ruta === PREFIJO_ACTA && req.method === 'POST') {
          return responder(201, { id: 601, ...(info || {}), archivoRecibido: recibeArchivo });
        }
        const actaId = ruta.match(/^\/api\/operativa\/actaInventario\/(\d+)$/);
        if (actaId) {
          const id = Number(actaId[1]);
          if (req.method === 'GET') return responder(200, { ...ACTA, id });
          if (req.method === 'PATCH') return responder(200, { ...ACTA, id, ...(info || {}), archivoRecibido: recibeArchivo });
          if (req.method === 'DELETE') {
            return respuestaDelete === 'nulo' ? responder(200, null) : responder(204, null, false);
          }
        }

        return responder(404, { message: 'Ruta mock no reconocida: ' + req.method + ' ' + ruta });
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        requests,
        clear: () => { requests.length = 0; },
        setMode: (m) => { mode = m; },
        setDeleteResponse: (r) => { respuestaDelete = r; }
      });
    });
  });
}

function formularioActa(info, bytes = ARCHIVO_PDF, nombre = 'acta.pdf', tipo = 'application/pdf') {
  const form = new FormData();
  form.set('info', JSON.stringify(info));
  form.set('file', new Blob([bytes], { type: tipo }), nombre);
  return form;
}

async function pedir(url, opciones = {}) {
  const respuesta = await fetch(url, opciones);
  const texto = await respuesta.text();
  let body = null;
  if (texto) {
    try { body = JSON.parse(texto); } catch { body = texto; }
  }
  return { status: respuesta.status, headers: respuesta.headers, texto, body };
}

describe('Incautaciones: reconocimiento y acta de inventario', () => {
  let sisdep;
  let appServer;
  let appPort;
  let base;

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    appPort = appServer.address().port;
    base = `http://127.0.0.1:${appPort}`;
  });

  after(async () => {
    appServer.closeAllConnections?.();
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  // ------------------------------------------------------------
  // Reconocimiento de incautación
  // ------------------------------------------------------------
  describe('Reconocimiento de incautación', () => {
    test('GET /paginated reenvía x-access y query params, y propaga status y body', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(
        `${base}/operativa/reconocimientoIncautacion/paginated?page=0&size=5&sort=id,desc`,
        { headers: { 'x-access': TOKEN } }
      );
      assert.equal(status, 200);
      assert.deepEqual(body, pagina(RECONOCIMIENTO));

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `${PREFIJO_RECONOCIMIENTO}/paginated`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.path, /[?&]page=0/);
      assert.match(ultimo.path, /[?&]size=5/);
      assert.match(ultimo.path, /[?&]sort=id(%2C|,)desc/);
    });

    test('GET /paginated llega a /paginated y no se confunde con /:id', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status } = await pedir(`${base}/operativa/reconocimientoIncautacion/paginated`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.equal(sisdep.requests.length, 1);
      const ultimo = sisdep.requests[0];
      assert.equal(ultimo.ruta, `${PREFIJO_RECONOCIMIENTO}/paginated`);
      assert.doesNotMatch(ultimo.ruta, /\/\d+$/);
    });

    test('GET de la colección devuelve la lista y reenvía el filtro', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion?idVentero=1234`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, [RECONOCIMIENTO]);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, PREFIJO_RECONOCIMIENTO);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.path, /idVentero=1234/);
    });

    test('GET /:id propaga el item y usa el id numérico en la ruta', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion/77`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, { ...RECONOCIMIENTO, id: 77 });

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `${PREFIJO_RECONOCIMIENTO}/77`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
    });

    test('POST reenvía el body JSON y propaga el 201', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const nuevo = {
        numeroActa: 'ACT-2024-002',
        fechaIncautacion: '2024-05-03',
        idVentero: 4321,
        observacion: 'Reconocimiento nuevo'
      };
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion`, {
        method: 'POST',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(nuevo)
      });
      assert.equal(status, 201);
      assert.equal(body.id, 501);
      assert.equal(body.numeroActa, 'ACT-2024-002');

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'POST');
      assert.equal(ultimo.ruta, PREFIJO_RECONOCIMIENTO);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.headers['content-type'], /application\/json/);
      assert.deepEqual(ultimo.body, nuevo);
    });

    test('PATCH /:id reenvía el body JSON y propaga el 200', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const cambios = { observacion: 'Observación corregida', idVentero: 5555 };
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion/77`, {
        method: 'PATCH',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(cambios)
      });
      assert.equal(status, 200);
      assert.equal(body.id, 77);
      assert.equal(body.observacion, 'Observación corregida');

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'PATCH');
      assert.equal(ultimo.ruta, `${PREFIJO_RECONOCIMIENTO}/77`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.deepEqual(ultimo.body, cambios);
    });

    test('DELETE /:id responde { success: true } cuando SISDEP no envía datos', async () => {
      sisdep.setMode('ok');
      sisdep.setDeleteResponse('nulo');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion/77`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      sisdep.setDeleteResponse('sin-cuerpo');
      assert.equal(status, 200);
      assert.deepEqual(body, { success: true });

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'DELETE');
      assert.equal(ultimo.ruta, `${PREFIJO_RECONOCIMIENTO}/77`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
    });

    test('DELETE /:id propaga el 204 sin cuerpo de SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.setDeleteResponse('sin-cuerpo');
      const { status, texto } = await pedir(`${base}/operativa/reconocimientoIncautacion/77`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 204);
      assert.equal(texto, '');
    });
  });

  // ------------------------------------------------------------
  // Acta de inventario
  // ------------------------------------------------------------
  describe('Acta de inventario', () => {
    test('GET /paginated reenvía x-access y query params, y propaga status y body', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(
        `${base}/operativa/actaInventario/paginated?page=1&size=20&sort=fecha,asc`,
        { headers: { 'x-access': TOKEN } }
      );
      assert.equal(status, 200);
      assert.deepEqual(body, pagina(ACTA));

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `${PREFIJO_ACTA}/paginated`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.path, /[?&]page=1/);
      assert.match(ultimo.path, /[?&]size=20/);
      assert.match(ultimo.path, /[?&]sort=fecha(%2C|,)asc/);
    });

    test('GET /paginated llega a /paginated y no se confunde con /:id', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status } = await pedir(`${base}/operativa/actaInventario/paginated`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.equal(sisdep.requests.length, 1);
      assert.equal(sisdep.requests[0].ruta, `${PREFIJO_ACTA}/paginated`);
      assert.doesNotMatch(sisdep.requests[0].ruta, /\/\d+$/);
    });

    test('GET /stream llega a /stream y no se confunde con /:id', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/actaInventario/stream?idReconocimiento=77`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, { total: 1, registros: [ACTA] });

      assert.equal(sisdep.requests.length, 1);
      const ultimo = sisdep.requests[0];
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `${PREFIJO_ACTA}/stream`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.path, /idReconocimiento=77/);
      assert.doesNotMatch(ultimo.ruta, /\/\d+$/);
    });

    test('GET de la colección devuelve la lista y reenvía el filtro', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/actaInventario?idReconocimiento=77`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, [ACTA]);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, PREFIJO_ACTA);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.path, /idReconocimiento=77/);
    });

    test('GET /:id propaga el item y usa el id numérico en la ruta', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/actaInventario/88`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, { ...ACTA, id: 88 });

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `${PREFIJO_ACTA}/88`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
    });

    test('POST reenvía el multipart (info + archivo) y propaga el 201', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const info = { idReconocimiento: 77, observacion: 'Acta con PDF', fecha: '2024-05-02' };
      const { status, body } = await pedir(`${base}/operativa/actaInventario`, {
        method: 'POST',
        headers: { 'x-access': TOKEN },
        body: formularioActa(info, ARCHIVO_PDF, 'acta.pdf', 'application/pdf')
      });
      assert.equal(status, 201);
      assert.equal(body.id, 601);
      assert.equal(body.observacion, 'Acta con PDF');
      assert.equal(body.archivoRecibido, true);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'POST');
      assert.equal(ultimo.ruta, PREFIJO_ACTA);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.headers['content-type'], /^multipart\/form-data; boundary=/);

      assert.ok(ultimo.multipart, 'SISDEP debe recibir un cuerpo multipart parseable');
      assert.deepEqual(ultimo.multipart.info, info);
      assert.equal(ultimo.multipart.archivo.nombre, 'acta.pdf');
      assert.deepEqual(ultimo.multipart.archivo.bytes, ARCHIVO_PDF);
    });

    test('PATCH /:id reenvía el multipart (info + archivo) y propaga el 200', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const info = { observacion: 'Acta corregida', fecha: '2024-05-04' };
      const { status, body } = await pedir(`${base}/operativa/actaInventario/88`, {
        method: 'PATCH',
        headers: { 'x-access': TOKEN },
        body: formularioActa(info, ARCHIVO_PDF, 'acta-corregida.pdf', 'application/pdf')
      });
      assert.equal(status, 200);
      assert.equal(body.id, 88);
      assert.equal(body.observacion, 'Acta corregida');
      assert.equal(body.archivoRecibido, true);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'PATCH');
      assert.equal(ultimo.ruta, `${PREFIJO_ACTA}/88`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.headers['content-type'], /^multipart\/form-data; boundary=/);

      assert.ok(ultimo.multipart, 'SISDEP debe recibir un cuerpo multipart parseable');
      assert.deepEqual(ultimo.multipart.info, info);
      assert.equal(ultimo.multipart.archivo.nombre, 'acta-corregida.pdf');
      assert.deepEqual(ultimo.multipart.archivo.bytes, ARCHIVO_PDF);
    });

    test('POST con content-type JSON responde 400 y no llama a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/actaInventario`, {
        method: 'POST',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ observacion: 'sin multipart' })
      });
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.match(body.message, /multipart\/form-data/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('PATCH /:id con content-type JSON responde 400 y no llama a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/actaInventario/88`, {
        method: 'PATCH',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ observacion: 'sin multipart' })
      });
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.match(body.message, /multipart\/form-data/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('DELETE /:id responde { success: true } cuando SISDEP no envía datos', async () => {
      sisdep.setMode('ok');
      sisdep.setDeleteResponse('nulo');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/operativa/actaInventario/88`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      sisdep.setDeleteResponse('sin-cuerpo');
      assert.equal(status, 200);
      assert.deepEqual(body, { success: true });

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'DELETE');
      assert.equal(ultimo.ruta, `${PREFIJO_ACTA}/88`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
    });

    test('DELETE /:id propaga el 204 sin cuerpo de SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.setDeleteResponse('sin-cuerpo');
      const { status, texto } = await pedir(`${base}/operativa/actaInventario/88`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 204);
      assert.equal(texto, '');
    });
  });

  // ------------------------------------------------------------
  // Autenticación, validación y errores del upstream
  // ------------------------------------------------------------
  describe('Autenticación, validación y errores del upstream', () => {
    const RUTAS_PROTEGIDAS = [
      ['GET', '/operativa/reconocimientoIncautacion/paginated'],
      ['GET', '/operativa/reconocimientoIncautacion'],
      ['GET', '/operativa/reconocimientoIncautacion/77'],
      ['POST', '/operativa/reconocimientoIncautacion'],
      ['PATCH', '/operativa/reconocimientoIncautacion/77'],
      ['DELETE', '/operativa/reconocimientoIncautacion/77'],
      ['GET', '/operativa/actaInventario/paginated'],
      ['GET', '/operativa/actaInventario/stream'],
      ['GET', '/operativa/actaInventario'],
      ['GET', '/operativa/actaInventario/88'],
      ['POST', '/operativa/actaInventario'],
      ['PATCH', '/operativa/actaInventario/88'],
      ['DELETE', '/operativa/actaInventario/88']
    ];

    for (const [metodo, ruta] of RUTAS_PROTEGIDAS) {
      test(`${metodo} ${ruta} sin x-access responde 401 Token no proporcionado`, async () => {
        sisdep.setMode('ok');
        sisdep.clear();
        const { status, body } = await pedir(`${base}${ruta}`, { method: metodo });
        assert.equal(status, 401);
        assert.equal(body.success, false);
        assert.equal(body.message, 'Token no proporcionado');
        assert.equal(sisdep.requests.length, 0);
      });
    }

    const RUTAS_ID_INVALIDO = [
      ['GET', '/operativa/reconocimientoIncautacion/abc'],
      ['PATCH', '/operativa/reconocimientoIncautacion/abc'],
      ['DELETE', '/operativa/reconocimientoIncautacion/abc'],
      ['GET', '/operativa/actaInventario/abc'],
      ['PATCH', '/operativa/actaInventario/abc'],
      ['DELETE', '/operativa/actaInventario/abc']
    ];

    for (const [metodo, ruta] of RUTAS_ID_INVALIDO) {
      test(`${metodo} ${ruta} responde 400 ID inválido y no llama a SISDEP`, async () => {
        sisdep.setMode('ok');
        sisdep.clear();
        const opciones = { method: metodo, headers: { 'x-access': TOKEN } };
        if (metodo === 'PATCH') {
          if (ruta.startsWith('/operativa/actaInventario')) {
            opciones.body = formularioActa({ observacion: 'x' });
          } else {
            opciones.headers['content-type'] = 'application/json';
            opciones.body = JSON.stringify({ observacion: 'x' });
          }
        }
        const { status, body } = await pedir(`${base}${ruta}`, opciones);
        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.equal(body.message, 'ID inválido: debe ser numérico');
        assert.equal(sisdep.requests.length, 0);
      });
    }

    test('un 401 de SISDEP se propaga con sesionVencida en reconocimiento', async () => {
      sisdep.setMode('auth-fail');
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion/paginated`, {
        headers: { 'x-access': 'token-vencido' }
      });
      assert.equal(status, 401);
      assert.equal(body.success, false);
      assert.equal(body.sesionVencida, true);
      assert.equal(body.message, 'Token inválido');
      sisdep.setMode('ok');
    });

    test('un 401 de SISDEP se propaga con sesionVencida en el acta multipart', async () => {
      sisdep.setMode('auth-fail');
      const { status, body } = await pedir(`${base}/operativa/actaInventario`, {
        method: 'POST',
        headers: { 'x-access': 'token-vencido' },
        body: formularioActa({ observacion: 'x' })
      });
      assert.equal(status, 401);
      assert.equal(body.success, false);
      assert.equal(body.sesionVencida, true);
      sisdep.setMode('ok');
    });

    test('propaga el mensaje de error de SISDEP en reconocimiento', async () => {
      sisdep.setMode('error-sisdep');
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion/77`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.equal(body.message, DETALLE_ERROR);
      sisdep.setMode('ok');
    });

    test('propaga el mensaje de error de SISDEP en el acta', async () => {
      sisdep.setMode('error-sisdep');
      const { status, body } = await pedir(`${base}/operativa/actaInventario/88`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.equal(body.message, DETALLE_ERROR);
      sisdep.setMode('ok');
    });

    test('504 El servidor remoto no respondió cuando SISDEP corta la conexión (reconocimiento)', async () => {
      sisdep.setMode('destruir');
      const { status, body } = await pedir(`${base}/operativa/reconocimientoIncautacion/77`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 504);
      assert.equal(body.success, false);
      assert.equal(body.message, 'El servidor remoto no respondió');
      sisdep.setMode('ok');
    });

    test('504 El servidor remoto no respondió cuando SISDEP corta la conexión (acta)', async () => {
      sisdep.setMode('destruir');
      const { status, body } = await pedir(`${base}/operativa/actaInventario/88`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 504);
      assert.equal(body.success, false);
      assert.equal(body.message, 'El servidor remoto no respondió');
      sisdep.setMode('ok');
    });
  });
});
