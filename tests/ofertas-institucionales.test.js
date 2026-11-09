'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TOKEN = 'tok-ofertas';
const DETALLE_409 = 'No se pudo guardar el registro: ya existe o viola una regla de negocio';
const DETALLE_401 = 'Token inválido o vencido';

const PREFIJO_OFERTA = '/api/social/oferta';
const PREFIJO_NECESIDAD = '/api/social/necesidad';
const PREFIJO_PARTICIPANTE = '/api/social/participanteOferta';
const PREFIJO_EVIDENCIA = '/api/social/evidenciasOferta';
const PREFIJO_EXCEL = '/api/social/reportes/reporteOfertasInstitucionalesIndex/excel';

const OFERTA = {
  id: 501,
  fechaEjecucion: '2026-10-06T15:30:00',
  idVentero: 2450,
  idBeneficiario: 2451,
  nombreVentero: 'MARIA RESTREPO',
  recibioOferta: true,
  aceptaRemision: false
};

const NECESIDAD = {
  id: 71,
  idTipoNecesidad: 3,
  descripcion: 'Requiere apoyo educativo',
  idPersona: 2450
};

const PARTICIPANTE = {
  id: 91,
  idOferta: 501,
  idTipoConocimiento: 2,
  esEfectivo: true,
  participaVentero: false,
  idVentero: 2450
};

const EVIDENCIA = {
  id: 61,
  idOferta: 501,
  idTipoEvidencia: 4,
  enlace: 'https://www.medellin.gov.co/sisdep/back/api/archivos/evidencias-oferta/501/1729000000000.pdf'
};

const PRELLENADO = {
  ventero: { id: 2450, nombre: 'MARIA RESTREPO' },
  persona: { id: 2450, nombres: 'MARIA', apellidos: 'RESTREPO' },
  direccionResidencia: null,
  esAutorizado: true,
  integrantes: [],
  estudio: { estudio: null, aspectosSeguridadSocial: null, aspectosPoblacionales: null }
};

// Payload del formato v5 (FO-GGOL-015). No lleva idTipo/idConvenio porque el
// formulario v5 no los captura. SIVEP no debe perder ni agregar ningún campo.
const OFERTA_V5 = {
  fechaEjecucion: '2026-10-06T15:30:00',
  idVentero: 2450,
  idBeneficiario: 2451,
  idNecesidad: 71,
  firmaSolicitante: 9001,
  firmaDiligencia: 9002,
  nombreVentero: 'MARIA RESTREPO',
  tipoDocumentoVentero: 'CC',
  otroTipoDocumentoVentero: null,
  documentoVentero: '10101010',
  idNacionalidadVentero: 1,
  celularVentero: '3001234567',
  direccionResidenciaVentero: 'CALLE 1 # 2-3',
  comunaResidenciaVentero: 10,
  direccionPuestoVenta: 'CARRERA 45 # 67-89',
  barrioVenta: 302,
  comunaVenta: 14,
  esVendedorSolicitante: true,
  nombreSolicitante: 'MARIA RESTREPO',
  documentoSolicitante: '10101010',
  beneficiarioNombre: 'JUAN RESTREPO',
  beneficiarioEdad: 34,
  tipoDocumentoBeneficiario: 'CC',
  otroTipoDocumentoBeneficiario: null,
  documentoBeneficiario: '20202020',
  idNacionalidadBeneficiario: 1,
  celularBeneficiario: '3007654321',
  direccionResidenciaBeneficiario: 'CALLE 9 # 8-7',
  municipioBeneficiario: 1,
  comunaBeneficiario: 14,
  idParentescoBeneficiario: 3,
  sexoBeneficiario: 'MASCULINO',
  ocupacionBeneficiario: 12,
  afiliacionSaludBeneficiario: 'SURA',
  estadoCivilBeneficiario: 'SOLTERO',
  escolaridadBeneficiario: 5,
  grupoEtnicoBeneficiario: 'NINGUNO',
  proteccionConstitucionalBeneficiario: ['VÍCTIMA', 'DISCAPACIDAD'],
  necesidadesSeleccionadas: ['educacion_becas', 'salud_citas'],
  recibioOferta: true,
  aceptaRemision: false,
  justificacionNoRemision: 'No aplica en la vereda',
  nombreFuncionario: 'ANA GOMEZ',
  documentoFuncionario: '30303030',
  cargoFuncionario: 'Enlace social',
  autorizaTratamientoDatos: true,
  ciudadAutorizacion: 'Medellín',
  fechaAutorizacion: '2026-10-06T15:35:00',
  tipoDocumentoFirmante: 'CC',
  documentoFirmante: '10101010'
};

// Bytes binarios: incluye 0x00 y 0xff para probar que el proxy no rompe el archivo.
const EVIDENCIA_PDF = Buffer.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xc3, 0xa9, 0x00, 0xff, 0xfe, 0x0d
]);

// Cabecera de un xlsx real (PK zip) seguida de bytes no imprimibles.
const EXCEL_XLSX = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21, 0x00,
  0x00, 0x00, 0xff, 0x00, 0xfe
]);

const NOMBRE_EXCEL = 'reporte-ofertas-institucionales.xlsx';

const pagina = (item, nombre) => ({
  entities: [item],
  name: nombre,
  totalCount: 1,
  totalPageCount: 1
});

const envoltorio = (nombre, item) => ({ entities: { [nombre]: { [item.id]: item } } });

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
    campos.push({
      nombre: /name="([^"]*)"/.exec(cabeceras)?.[1],
      nombreArchivo: /filename="([^"]*)"/.exec(cabeceras)?.[1],
      contenido: cuerpo.slice(separador + 4)
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
    let mode = 'ok'; // 'ok' | 'token-invalido' | 'conflicto' | 'descarga-404' | 'cortada'
    let respuestaDelete = 'con-cuerpo'; // 'con-cuerpo' (202 + {id}) | 'nulo' (200 + null) | 'sin-cuerpo' (204)
    const requests = [];

    const server = http.createServer((req, res) => {
      const trozos = [];
      req.on('data', (t) => trozos.push(t));
      req.on('end', () => {
        const rawBody = Buffer.concat(trozos);
        const contentType = String(req.headers['content-type'] || '');
        const registro = {
          method: req.method,
          path: req.url,
          ruta: req.url.split('?')[0],
          query: req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '',
          headers: req.headers,
          rawBody,
          body: null,
          multipart: null
        };
        if (rawBody.length) {
          if (contentType.startsWith('multipart/form-data')) {
            registro.multipart = parseMultipart(rawBody, contentType);
          } else {
            try { registro.body = JSON.parse(rawBody.toString('utf8')); } catch { registro.body = rawBody.toString('utf8'); }
          }
        }
        requests.push(registro);

        const json = (status, data) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };
        const responderBorrado = (id) => {
          if (respuestaDelete === 'sin-cuerpo') {
            res.statusCode = 204;
            return res.end();
          }
          if (respuestaDelete === 'nulo') return json(200, null);
          return json(202, { id });
        };

        if (mode === 'token-invalido' || !req.headers['x-access']) {
          return json(401, { errors: [{ title: 'No autorizado', detail: DETALLE_401 }] });
        }

        const ruta = registro.ruta;
        const info = registro.multipart?.info ?? null;
        const recibeArchivo = Boolean(registro.multipart?.archivo);

        // --- catálogos del formulario ---
        const catalogo = ruta.match(/^\/api\/dominios\/([A-Za-z]+)$/);
        if (catalogo && req.method === 'GET') {
          return json(200, envoltorio(catalogo[1], { id: 1, descripcion: 'OPCION 1' }));
        }

        // --- descarga anidada de evidencias ---
        const descarga = ruta.match(/^\/api\/archivos\/evidencias-oferta\/(\d+)\/([^/?]+)$/);
        if (descarga && req.method === 'GET') {
          if (mode === 'descarga-404') {
            return json(404, { errors: [{ title: 'No encontrado', detail: 'La evidencia no existe' }] });
          }
          if (mode === 'cortada') {
            res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '100' });
            res.write(EVIDENCIA_PDF);
            setTimeout(() => req.socket.destroy(), 30);
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Length', String(EVIDENCIA_PDF.length));
          res.setHeader('Cache-Control', 'private, max-age=60');
          return res.end(EVIDENCIA_PDF);
        }

        // --- reporte Excel ---
        if (ruta === PREFIJO_EXCEL && req.method === 'POST') {
          if (mode === 'cortada') {
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Length': '100'
            });
            res.write(EXCEL_XLSX);
            setTimeout(() => req.socket.destroy(), 30);
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Length', String(EXCEL_XLSX.length));
          res.setHeader('Content-Disposition', `attachment; filename="${NOMBRE_EXCEL}"`);
          return res.end(EXCEL_XLSX);
        }

        // --- oferta ---
        if (ruta === `${PREFIJO_OFERTA}/paginated` && req.method === 'GET') {
          return json(200, pagina(OFERTA, 'oferta'));
        }
        const prellenado = ruta.match(/^\/api\/social\/oferta\/prellenado\/([^/]+)$/);
        if (prellenado && req.method === 'GET') {
          return json(200, { ...PRELLENADO, idVentero: prellenado[1] });
        }
        if (ruta === PREFIJO_OFERTA && req.method === 'GET') {
          return json(200, envoltorio('oferta', OFERTA));
        }
        if (ruta === PREFIJO_OFERTA && req.method === 'POST') {
          if (mode === 'conflicto') {
            return json(409, { errors: [{ title: 'Conflicto', detail: DETALLE_409 }] });
          }
          return json(201, envoltorio('oferta', { ...OFERTA, ...(registro.body || {}) }));
        }
        const ofertaId = ruta.match(/^\/api\/social\/oferta\/(\d+)$/);
        if (ofertaId) {
          const id = Number(ofertaId[1]);
          if (req.method === 'GET') return json(200, envoltorio('oferta', { ...OFERTA, id }));
          if (req.method === 'PATCH') return json(202, envoltorio('oferta', { ...OFERTA, id, ...(registro.body || {}) }));
          if (req.method === 'DELETE') return responderBorrado(id);
        }

        // --- necesidad ---
        if (ruta === `${PREFIJO_NECESIDAD}/paginated` && req.method === 'GET') {
          return json(200, pagina(NECESIDAD, 'necesidad'));
        }
        if (ruta === PREFIJO_NECESIDAD && req.method === 'GET') {
          return json(200, envoltorio('necesidad', NECESIDAD));
        }
        if (ruta === PREFIJO_NECESIDAD && req.method === 'POST') {
          return json(201, envoltorio('necesidad', { ...NECESIDAD, ...(registro.body || {}) }));
        }
        const necesidadId = ruta.match(/^\/api\/social\/necesidad\/(\d+)$/);
        if (necesidadId) {
          const id = Number(necesidadId[1]);
          if (req.method === 'GET') return json(200, envoltorio('necesidad', { ...NECESIDAD, id }));
          if (req.method === 'PATCH') return json(202, envoltorio('necesidad', { ...NECESIDAD, id, ...(registro.body || {}) }));
          if (req.method === 'DELETE') return responderBorrado(id);
        }

        // --- participante de la oferta ---
        if (ruta === `${PREFIJO_PARTICIPANTE}/paginated` && req.method === 'GET') {
          return json(200, pagina(PARTICIPANTE, 'participanteOferta'));
        }
        if (ruta === PREFIJO_PARTICIPANTE && req.method === 'GET') {
          return json(200, envoltorio('participanteOferta', PARTICIPANTE));
        }
        if (ruta === PREFIJO_PARTICIPANTE && req.method === 'POST') {
          return json(201, envoltorio('participanteOferta', { ...PARTICIPANTE, ...(registro.body || {}) }));
        }
        const participanteId = ruta.match(/^\/api\/social\/participanteOferta\/(\d+)$/);
        if (participanteId) {
          const id = Number(participanteId[1]);
          if (req.method === 'GET') return json(200, envoltorio('participanteOferta', { ...PARTICIPANTE, id }));
          if (req.method === 'PATCH') return json(202, envoltorio('participanteOferta', { ...PARTICIPANTE, id, ...(registro.body || {}) }));
          if (req.method === 'DELETE') return responderBorrado(id);
        }

        // --- evidencias de la oferta ---
        if (ruta === `${PREFIJO_EVIDENCIA}/paginated` && req.method === 'GET') {
          return json(200, pagina(EVIDENCIA, 'evidenciasOferta'));
        }
        if (ruta === PREFIJO_EVIDENCIA && req.method === 'GET') {
          return json(200, envoltorio('evidenciasOferta', EVIDENCIA));
        }
        if (ruta === PREFIJO_EVIDENCIA && req.method === 'POST') {
          return json(201, envoltorio('evidenciasOferta', {
            id: 62,
            idOferta: info?.idOferta ?? null,
            idTipoEvidencia: info?.idTipoEvidencia ?? null,
            archivoRecibido: recibeArchivo
          }));
        }
        const evidenciaId = ruta.match(/^\/api\/social\/evidenciasOferta\/(\d+)$/);
        if (evidenciaId && req.method === 'GET') {
          return json(200, envoltorio('evidenciasOferta', { ...EVIDENCIA, id: Number(evidenciaId[1]) }));
        }

        return json(404, { message: 'Ruta mock no reconocida: ' + req.method + ' ' + ruta });
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

function formularioEvidencia(info, bytes = EVIDENCIA_PDF, nombre = 'evidencia.pdf', tipo = 'application/pdf') {
  const form = new FormData();
  form.set('info', JSON.stringify(info));
  form.set('archivo', new Blob([bytes], { type: tipo }), nombre);
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

async function pedirBinario(url, opciones = {}) {
  const respuesta = await fetch(url, opciones);
  const bytes = Buffer.from(await respuesta.arrayBuffer());
  return { status: respuesta.status, headers: respuesta.headers, bytes };
}

// El upstream cortó a mitad: la petición debe abortarse, nunca quedarse colgada.
async function pedirSinColgarse(promesa) {
  const corte = new Promise((_, rechazar) => {
    setTimeout(() => rechazar(new Error('COLGADA')), 5000).unref();
  });
  try {
    await Promise.race([promesa, corte]);
  } catch (error) {
    assert.notEqual(error.message, 'COLGADA', 'la respuesta quedó colgada en vez de abortarse');
    return;
  }
  assert.fail('la petición debía abortarse');
}

describe('Ofertas institucionales (proxy a SISDEP)', () => {
  let sisdep;
  let appServer;
  let base;

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    base = `http://127.0.0.1:${appServer.address().port}`;
  });

  after(async () => {
    appServer.closeAllConnections?.();
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  // ------------------------------------------------------------
  // Autenticación y reenvío de oferta / prellenado
  // ------------------------------------------------------------
  describe('Oferta: autenticación y reenvío', () => {
    test('GET /social/oferta reenvía x-access y query, y devuelve el envoltorio tal cual', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta?idVentero=2450&contains=MARIA`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, envoltorio('oferta', OFERTA), 'la respuesta debe ser passthrough');

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, PREFIJO_OFERTA);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.query, /idVentero=2450/);
      assert.match(ultimo.query, /contains=MARIA/);
    });

    test('GET /social/oferta/prellenado/:idVentero reenvía el id y no se confunde con /:id', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta/prellenado/2450`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, { ...PRELLENADO, idVentero: '2450' });

      assert.equal(sisdep.requests.length, 1);
      const ultimo = sisdep.requests[0];
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `${PREFIJO_OFERTA}/prellenado/2450`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.notEqual(ultimo.ruta, `${PREFIJO_OFERTA}/2450`, 'no debe llegar como /oferta/:id');
    });

    test('GET /social/oferta/prellenado/abc responde 400 sin llamar a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta/prellenado/abc`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.match(body.message, /idVentero inválido/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('GET /social/oferta/prellenado/12.5 responde 400 sin llamar a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status } = await pedir(`${base}/social/oferta/prellenado/12.5`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 400);
      assert.equal(sisdep.requests.length, 0);
    });

    test('GET /social/oferta/:id con id no numérico responde 400 sin llamar a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta/abc`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 400);
      assert.match(body.message, /ID inválido/);
      assert.equal(sisdep.requests.length, 0);
    });
  });

  // ------------------------------------------------------------
  // Orden de rutas, paginación y filtros
  // ------------------------------------------------------------
  describe('Oferta: orden de rutas, paginación y query', () => {
    test('GET /social/oferta/paginated llega a /paginated y no a /:id', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(
        `${base}/social/oferta/paginated?page=0&size=20&sort=fechaEjecucion,desc&contains=2026`,
        { headers: { 'x-access': TOKEN } }
      );
      assert.equal(status, 200);
      assert.deepEqual(body, pagina(OFERTA, 'oferta'));

      assert.equal(sisdep.requests.length, 1);
      const ultimo = sisdep.requests[0];
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `${PREFIJO_OFERTA}/paginated`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.query, /page=0/);
      assert.match(ultimo.query, /size=20/);
      assert.match(ultimo.query, /sort=fechaEjecucion(%2C|,)desc/);
      assert.match(ultimo.query, /contains=2026/);
      assert.doesNotMatch(ultimo.ruta, /\/\d+$/);
    });

    test('los filtros repetidos y de rango llegan intactos al upstream', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status } = await pedir(
        `${base}/social/oferta/paginated?idNecesidad=7&idNecesidad=9&fechaEjecucion__gte=2026-01-01`,
        { headers: { 'x-access': TOKEN } }
      );
      assert.equal(status, 200);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.ruta, `${PREFIJO_OFERTA}/paginated`);
      assert.match(ultimo.query, /idNecesidad(\[\]|%5B%5D)?=7/);
      assert.match(ultimo.query, /idNecesidad(\[\]|%5B%5D)?=9/);
      assert.match(ultimo.query, /fechaEjecucion__gte=2026-01-01/);
    });

    test('GET /social/oferta/:id propaga el detalle y usa el id de la ruta', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta/501`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, envoltorio('oferta', OFERTA));

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.ruta, `${PREFIJO_OFERTA}/501`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
    });
  });

  // ------------------------------------------------------------
  // Payload v5 sin transformaciones
  // ------------------------------------------------------------
  describe('Oferta: payload v5 intacto', () => {
    test('POST reenvía los 50 campos del formato v5 sin perder ninguno', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta`, {
        method: 'POST',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(OFERTA_V5)
      });
      assert.equal(status, 201);
      assert.equal(body.entities.oferta['501'].fechaEjecucion, OFERTA_V5.fechaEjecucion);
      assert.equal(body.entities.oferta['501'].nombreVentero, OFERTA_V5.nombreVentero);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'POST');
      assert.equal(ultimo.ruta, PREFIJO_OFERTA);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.headers['content-type'], /application\/json/);
      assert.deepEqual(ultimo.body, OFERTA_V5, 'el body debe llegar idéntico a SISDEP');
      assert.equal(Object.keys(ultimo.body).length, Object.keys(OFERTA_V5).length);
    });

    test('PATCH reenvía solo los campos enviados, sin inyectar nada', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const cambios = { recibioOferta: true, aceptaRemision: true, observaciones: null };
      const { status, body } = await pedir(`${base}/social/oferta/501`, {
        method: 'PATCH',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(cambios)
      });
      assert.equal(status, 202);
      assert.equal(body.entities.oferta['501'].aceptaRemision, true);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'PATCH');
      assert.equal(ultimo.ruta, `${PREFIJO_OFERTA}/501`);
      assert.deepEqual(ultimo.body, cambios);
    });

    test('DELETE propaga el body de SISDEP y responde { success: true } cuando viene null', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const conCuerpo = await pedir(`${base}/social/oferta/501`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      assert.equal(conCuerpo.status, 202);
      assert.deepEqual(conCuerpo.body, { id: 501 });

      sisdep.setDeleteResponse('nulo');
      const nulo = await pedir(`${base}/social/oferta/501`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      sisdep.setDeleteResponse('con-cuerpo');
      assert.equal(nulo.status, 200);
      assert.deepEqual(nulo.body, { success: true });
    });
  });

  // ------------------------------------------------------------
  // Necesidad y participante
  // ------------------------------------------------------------
  describe('Necesidad: CRUD passthrough', () => {
    test('las listas sin /paginated devuelven el envoltorio y reenvían el filtro', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const necesidad = await pedir(`${base}/social/necesidad?idPersona=2450`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(necesidad.status, 200);
      assert.deepEqual(necesidad.body, envoltorio('necesidad', NECESIDAD));

      const evidencias = await pedir(`${base}/social/evidenciasOferta?idOferta=501`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(evidencias.status, 200);
      assert.deepEqual(evidencias.body, envoltorio('evidenciasOferta', EVIDENCIA));

      const [una, otra] = sisdep.requests;
      assert.equal(una.ruta, PREFIJO_NECESIDAD);
      assert.match(una.query, /idPersona=2450/);
      assert.equal(otra.ruta, PREFIJO_EVIDENCIA);
      assert.match(otra.query, /idOferta=501/);
    });

    test('GET /paginated usa la ruta propia y reenvía la query', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/necesidad/paginated?page=1&size=10&idPersona=2450`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.deepEqual(body, pagina(NECESIDAD, 'necesidad'));

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.ruta, `${PREFIJO_NECESIDAD}/paginated`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.query, /idPersona=2450/);
      assert.doesNotMatch(ultimo.ruta, /\/\d+$/);
    });

    test('POST crea la necesidad antes de la oferta y propaga el 201', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const nueva = { idTipoNecesidad: 3, descripcion: 'OTRO: requiere lentes', idPersona: 2450 };
      const { status, body } = await pedir(`${base}/social/necesidad`, {
        method: 'POST',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(nueva)
      });
      assert.equal(status, 201);
      assert.equal(body.entities.necesidad['71'].descripcion, 'OTRO: requiere lentes');

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'POST');
      assert.equal(ultimo.ruta, PREFIJO_NECESIDAD);
      assert.deepEqual(ultimo.body, nueva);
      assert.equal(ultimo.body.idUsuarioElabora, undefined, 'SIVEP no debe inyectar el usuario');
    });

    test('GET /:id, PATCH y DELETE operan sobre el id numérico', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const detalle = await pedir(`${base}/social/necesidad/71`, { headers: { 'x-access': TOKEN } });
      assert.equal(detalle.status, 200);
      assert.equal(detalle.body.entities.necesidad['71'].id, 71);

      const edicion = await pedir(`${base}/social/necesidad/71`, {
        method: 'PATCH',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ descripcion: 'Corregida' })
      });
      assert.equal(edicion.status, 202);
      assert.equal(edicion.body.entities.necesidad['71'].descripcion, 'Corregida');

      const borrado = await pedir(`${base}/social/necesidad/71`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      assert.equal(borrado.status, 202);
      assert.deepEqual(borrado.body, { id: 71 });

      const rutas = sisdep.requests.map((r) => `${r.method} ${r.ruta}`);
      assert.deepEqual(rutas, [
        `GET ${PREFIJO_NECESIDAD}/71`,
        `PATCH ${PREFIJO_NECESIDAD}/71`,
        `DELETE ${PREFIJO_NECESIDAD}/71`
      ]);
    });
  });

  describe('Participante de la oferta: CRUD passthrough', () => {
    test('GET /paginated y lista reenvían la query del seguimiento', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const paginado = await pedir(`${base}/social/participanteOferta/paginated?idOferta=501&page=0&size=5`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(paginado.status, 200);
      assert.deepEqual(paginado.body, pagina(PARTICIPANTE, 'participanteOferta'));

      const lista = await pedir(`${base}/social/participanteOferta?idVentero=2450`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(lista.status, 200);
      assert.deepEqual(lista.body, envoltorio('participanteOferta', PARTICIPANTE));

      const [primero, segundo] = sisdep.requests;
      assert.equal(primero.ruta, `${PREFIJO_PARTICIPANTE}/paginated`);
      assert.match(primero.query, /idOferta=501/);
      assert.doesNotMatch(primero.ruta, /\/\d+$/);
      assert.equal(segundo.ruta, PREFIJO_PARTICIPANTE);
      assert.match(segundo.query, /idVentero=2450/);
    });

    test('POST, PATCH y DELETE reenvían el body del seguimiento y propagan el status', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const nuevo = { idOferta: 501, esEfectivo: false, observacionesSeguimiento: 'Pendiente de verificación' };
      const creado = await pedir(`${base}/social/participanteOferta`, {
        method: 'POST',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(nuevo)
      });
      assert.equal(creado.status, 201);
      assert.equal(creado.body.entities.participanteOferta['91'].esEfectivo, false);

      const editado = await pedir(`${base}/social/participanteOferta/91`, {
        method: 'PATCH',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ esEfectivo: true, beneficioOtorgado: 'Curso aprobado' })
      });
      assert.equal(editado.status, 202);

      const borrado = await pedir(`${base}/social/participanteOferta/91`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      assert.equal(borrado.status, 202);

      const [post, patch, del] = sisdep.requests;
      assert.deepEqual(post.body, nuevo);
      assert.deepEqual(patch.body, { esEfectivo: true, beneficioOtorgado: 'Curso aprobado' });
      assert.equal(del.method, 'DELETE');
      assert.equal(del.ruta, `${PREFIJO_PARTICIPANTE}/91`);
    });
  });

  // ------------------------------------------------------------
  // Evidencias: multipart y descarga autenticada
  // ------------------------------------------------------------
  describe('Evidencias: listado y alta multipart', () => {
    test('GET /paginated y GET /:id devuelven el envoltorio de SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const paginado = await pedir(`${base}/social/evidenciasOferta/paginated?idOferta=501`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(paginado.status, 200);
      assert.deepEqual(paginado.body, pagina(EVIDENCIA, 'evidenciasOferta'));

      const detalle = await pedir(`${base}/social/evidenciasOferta/61`, { headers: { 'x-access': TOKEN } });
      assert.equal(detalle.status, 200);
      assert.equal(detalle.body.entities.evidenciasOferta['61'].enlace, EVIDENCIA.enlace);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.ruta, `${PREFIJO_EVIDENCIA}/61`);
    });

    test('POST reenvía el multipart como stream (info + archivo), sin volverlo JSON', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const info = { idOferta: 501, idTipoEvidencia: 4 };
      const { status, body } = await pedir(`${base}/social/evidenciasOferta`, {
        method: 'POST',
        headers: { 'x-access': TOKEN },
        body: formularioEvidencia(info, EVIDENCIA_PDF, 'evidencia.pdf', 'application/pdf')
      });
      assert.equal(status, 201);
      assert.equal(body.entities.evidenciasOferta['62'].idOferta, 501);
      assert.equal(body.entities.evidenciasOferta['62'].archivoRecibido, true);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'POST');
      assert.equal(ultimo.ruta, PREFIJO_EVIDENCIA);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.headers['content-type'], /^multipart\/form-data; boundary=/);
      assert.equal(ultimo.body, null, 'el proxy no debe re-serializar el multipart a JSON');

      assert.ok(ultimo.multipart, 'SISDEP debe recibir un multipart parseable');
      assert.deepEqual(ultimo.multipart.info, info);
      assert.equal(ultimo.multipart.archivo.nombre, 'evidencia.pdf');
      assert.deepEqual(ultimo.multipart.archivo.bytes, EVIDENCIA_PDF);
    });

    test('POST con Content-Type application/json responde 400 y no llama a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/evidenciasOferta`, {
        method: 'POST',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ idOferta: 501, idTipoEvidencia: 4 })
      });
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.match(body.message, /multipart\/form-data/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('PATCH y DELETE no están expuestos y no llegan a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const patch = await pedir(`${base}/social/evidenciasOferta/61`, {
        method: 'PATCH',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ idTipoEvidencia: 5 })
      });
      assert.equal(patch.status, 404);

      const borrado = await pedir(`${base}/social/evidenciasOferta/61`, {
        method: 'DELETE',
        headers: { 'x-access': TOKEN }
      });
      assert.equal(borrado.status, 404);
      assert.equal(sisdep.requests.length, 0);
    });
  });

  describe('Evidencias: descarga autenticada de la ruta anidada', () => {
    test('GET /archivos/evidencias-oferta/:idOferta/:filename sirve el binario con sus headers', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, headers, bytes } = await pedirBinario(
        `${base}/archivos/evidencias-oferta/501/${encodeURIComponent('evidencia 1.pdf')}`,
        { headers: { 'x-access': TOKEN } }
      );
      assert.equal(status, 200);
      assert.equal(headers.get('content-type'), 'application/pdf');
      assert.equal(headers.get('content-length'), String(EVIDENCIA_PDF.length));
      assert.equal(headers.get('cache-control'), 'private, max-age=60');
      assert.deepEqual(bytes, EVIDENCIA_PDF);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'GET');
      assert.equal(ultimo.ruta, `/api/archivos/evidencias-oferta/501/${encodeURIComponent('evidencia 1.pdf')}`);
      assert.equal(ultimo.headers['x-access'], TOKEN);
    });

    test('GET de la evidencia sin x-access responde 401 y no llama a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status } = await pedirBinario(`${base}/archivos/evidencias-oferta/501/evidencia.pdf`);
      assert.equal(status, 401);
      assert.equal(sisdep.requests.length, 0);
    });

    test('GET con idOferta no numérico responde 400 y no llama a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/archivos/evidencias-oferta/abc/evidencia.pdf`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 400);
      assert.match(body.message, /idOferta inválido/);
      assert.equal(sisdep.requests.length, 0);
    });

    test('GET de una evidencia inexistente propaga el 404 de SISDEP como JSON', async () => {
      sisdep.setMode('descarga-404');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/archivos/evidencias-oferta/501/inexistente.pdf`, {
        headers: { 'x-access': TOKEN }
      });
      sisdep.setMode('ok');
      assert.equal(status, 404);
      assert.equal(body.success, false);
      assert.match(body.message, /La evidencia no existe/);
    });

    test('si SISDEP corta la descarga a mitad, la respuesta se aborta y no queda colgada', async () => {
      sisdep.setMode('cortada');
      sisdep.clear();
      try {
        await pedirSinColgarse(pedirBinario(`${base}/archivos/evidencias-oferta/501/evidencia.pdf`, {
          headers: { 'x-access': TOKEN }
        }));
      } finally {
        sisdep.setMode('ok');
      }
    });
  });

  // ------------------------------------------------------------
  // Catálogos del formulario
  // ------------------------------------------------------------
  describe('Catálogos del formulario', () => {
    test('los 13 catálogos de la oferta apuntan a /api/dominios/*', async () => {
      const catalogos = [
        'tipoOferta', 'tipoNecesidad', 'tipoConocimiento', 'tipoEvidencia',
        'nacionalidad', 'parentesco', 'ocupacion', 'escolaridad', 'estadoCivil',
        'sexo', 'tipoDocumento', 'programaOEntidad', 'remisionOferta'
      ];
      sisdep.setMode('ok');
      sisdep.clear();

      for (const nombre of catalogos) {
        const { status, body } = await pedir(`${base}/dominios/${nombre}`, { headers: { 'x-access': TOKEN } });
        assert.equal(status, 200, `${nombre} debe responder 200`);
        assert.deepEqual(body, envoltorio(nombre, { id: 1, descripcion: 'OPCION 1' }));
      }

      assert.deepEqual(
        sisdep.requests.map((r) => r.ruta),
        catalogos.map((n) => `/api/dominios/${n}`)
      );
      assert.ok(sisdep.requests.every((r) => r.headers['x-access'] === TOKEN));
    });

    test('un catálogo con query reenvía el filtro', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const { status } = await pedir(`${base}/dominios/tipoEvidencia?contains=ACTA`, {
        headers: { 'x-access': TOKEN }
      });
      assert.equal(status, 200);
      assert.match(sisdep.requests.at(-1).query, /contains=ACTA/);
    });
  });

  // ------------------------------------------------------------
  // Errores
  // ------------------------------------------------------------
  describe('Errores del upstream', () => {
    test('401 de SISDEP se propaga con sesionVencida', async () => {
      sisdep.setMode('token-invalido');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta/paginated`, {
        headers: { 'x-access': TOKEN }
      });
      sisdep.setMode('ok');
      assert.equal(status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, DETALLE_401);
      assert.equal(body.sesionVencida, true);
    });

    test('409 de SISDEP se propaga con el detail y sin sesionVencida', async () => {
      sisdep.setMode('conflicto');
      sisdep.clear();
      const { status, body } = await pedir(`${base}/social/oferta`, {
        method: 'POST',
        headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ idVentero: 2450, idBeneficiario: 2451 })
      });
      sisdep.setMode('ok');
      assert.equal(status, 409);
      assert.equal(body.success, false);
      assert.equal(body.message, DETALLE_409);
      assert.equal(body.sesionVencida, undefined);
    });

    test('sin x-access ninguna ruta de oferta llama a SISDEP', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const rutas = [
        ['GET', '/social/oferta'],
        ['GET', '/social/oferta/paginated'],
        ['GET', '/social/oferta/prellenado/2450'],
        ['GET', '/social/oferta/501'],
        ['POST', '/social/oferta'],
        ['PATCH', '/social/oferta/501'],
        ['DELETE', '/social/oferta/501'],
        ['GET', '/social/necesidad'],
        ['GET', '/social/participanteOferta/paginated'],
        ['GET', '/social/evidenciasOferta'],
        ['POST', '/social/evidenciasOferta'],
        ['GET', '/dominios/tipoOferta'],
        ['POST', '/social/reportes/reporteOfertasInstitucionalesIndex/excel']
      ];
      for (const [method, ruta] of rutas) {
        const opciones = { method };
        if (method === 'POST' || method === 'PATCH') {
          opciones.headers = { 'content-type': 'application/json' };
          opciones.body = '{}';
        }
        const { status, body } = await pedir(`${base}${ruta}`, opciones);
        assert.equal(status, 401, `${method} ${ruta} debe responder 401`);
        assert.equal(body.message, 'Token no proporcionado');
      }
      assert.equal(sisdep.requests.length, 0);
    });
  });

  // ------------------------------------------------------------
  // Reporte Excel
  // ------------------------------------------------------------
  describe('Reporte Excel de ofertas', () => {
    test('POST reenvía los ids y devuelve el xlsx con sus headers', async () => {
      sisdep.setMode('ok');
      sisdep.clear();
      const cuerpo = { ids: ['501', '502'], attribute: 'id' };
      const { status, headers, bytes } = await pedirBinario(
        `${base}/social/reportes/reporteOfertasInstitucionalesIndex/excel`,
        {
          method: 'POST',
          headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
          body: JSON.stringify(cuerpo)
        }
      );
      assert.equal(status, 200);
      assert.equal(
        headers.get('content-type'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      assert.equal(headers.get('content-disposition'), `attachment; filename="${NOMBRE_EXCEL}"`);
      assert.equal(headers.get('content-length'), String(EXCEL_XLSX.length));
      assert.deepEqual(bytes, EXCEL_XLSX);

      const ultimo = sisdep.requests.at(-1);
      assert.equal(ultimo.method, 'POST');
      assert.equal(ultimo.ruta, PREFIJO_EXCEL);
      assert.equal(ultimo.headers['x-access'], TOKEN);
      assert.match(ultimo.headers['content-type'], /application\/json/);
      assert.deepEqual(ultimo.body, cuerpo);
    });

    test('el error de SISDEP llega como JSON, no como binario', async () => {
      sisdep.setMode('token-invalido');
      sisdep.clear();
      const { status, body } = await pedir(
        `${base}/social/reportes/reporteOfertasInstitucionalesIndex/excel`,
        {
          method: 'POST',
          headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
          body: JSON.stringify({ ids: ['501'], attribute: 'id' })
        }
      );
      sisdep.setMode('ok');
      assert.equal(status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, DETALLE_401);
      assert.equal(body.sesionVencida, true);
    });

    test('si SISDEP corta el Excel a mitad, la respuesta se aborta y no queda colgada', async () => {
      sisdep.setMode('cortada');
      sisdep.clear();
      try {
        await pedirSinColgarse(pedirBinario(`${base}/social/reportes/reporteOfertasInstitucionalesIndex/excel`, {
          method: 'POST',
          headers: { 'x-access': TOKEN, 'content-type': 'application/json' },
          body: JSON.stringify({ ids: ['501'], attribute: 'id' })
        }));
      } finally {
        sisdep.setMode('ok');
      }
    });
  });

  // ------------------------------------------------------------
  // Índice de endpoints
  // ------------------------------------------------------------
  test('GET / anuncia las rutas de oferta institucional', async () => {
    const { status, body } = await pedir(`${base}/`);
    assert.equal(status, 200);
    const rutas = body.endpoints.map((e) => e.path).join('\n');
    assert.match(rutas, /\/social\/oferta/);
    assert.match(rutas, /\/social\/necesidad/);
    assert.match(rutas, /\/social\/participanteOferta/);
    assert.match(rutas, /\/social\/evidenciasOferta/);
    assert.match(rutas, /\/archivos\/evidencias-oferta/);
    assert.match(rutas, /reporteOfertasInstitucionalesIndex\/excel/);
    assert.match(rutas, /dominios\/\{tipoOferta/);
  });
});
