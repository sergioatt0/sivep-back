'use strict';

// IMPORTANTE: estas vars deben fijarse antes de require('../dist/app.js')
// porque app.ts las lee a nivel de módulo.
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const EXPEDIENTE_FIXTURE = {
  ventero: {
    id: 1,
    esRegulado: true,
    idEstadoCivil: 2,
    idProteccionConstitucional: [],
    grupoSisben: 13,
    idMunicipioSisben: 1,
    idEscolaridad: 2,
    tituloObtenido: '4 DE PRIMARIA',
    municipioNacimiento: 'AMALFI',
    departamentoNacimiento: 'ANTIOQUIA',
    esCancelado: false,
    enlaceEscanerFormato: 'https://sisdep.innovacion.it.com/sisdep/back/api/archivos/pdf-venteros/1769604557844.pdf',
    idUsuarioRegistra: 0,
    hojaVidaPrestada: false,
    enlace: 'https://sisdep.innovacion.it.com/sisdep/back/fotos-ventero/1770123847461.jpg',
    estrato: 2,
    esFallecido: false,
    consecutivo: 1,
    sabeFirmar: false,
    reubicacion: false,
    referenciaReubicacion: null
  },
  persona: {
    id: 1,
    nombre1: 'ABELARDO',
    apellido1: 'MUÑOZ',
    idTipoDocumento: 1,
    documento: '7249378',
    idDireccionResidencia: 5
  },
  direccionResidencia: {
    id: 5,
    cruceDesde: 1,
    numeroDesde: 33,
    cruceHasta: 2,
    numeroHasta: 74,
    letraHasta: 'E',
    idMunicipio: 1,
    idBarrio: 77,
    idComuna: 16,
    localizacion: null
  },
  datosVenta: [
    {
      id: 2,
      idClaseVenta: 3,
      idDireccion: 4989,
      idTipologiaVenta: 7,
      idActividadEconomicaActual: 2,
      desActividadEconomica: 'COMESTIBLES VARIOS',
      atiendeTitular: true,
      idVentero: 1,
      idDia: [1, 2, 3, 4, 5, 6],
      horaInicio: 11,
      horaFin: 21,
      idAmoblamiento: 258,
      direccion: { id: 4989, idMunicipio: 1, idBarrio: 262, idComuna: 7 },
      amoblamiento: { id: 258, idTipoModulo: 24, idEstado: 1 },
      terceros: []
    }
  ]
};

// Mock del API SISDEP. Inspecciona la URL y simula respuestas distintas.
function startSisdepMock() {
  return new Promise((resolve) => {
    let mode = 'ok'; // 'ok' | '404' | 'slow' | 'auth-fail'
    const server = http.createServer((req, res) => {
      // /api/ventero/ventero/:id/expediente
      const match = req.url.match(/^\/api\/ventero\/ventero\/(\d+)\/expediente$/);
      if (!match) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'Ruta mock no reconocida' }));
        return;
      }

      const accessHeader = req.headers['x-access'];

      if (mode === 'auth-fail' || !accessHeader) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'Token inválido' }));
        return;
      }

      if (mode === '404') {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'Ventero no encontrado' }));
        return;
      }

      if (mode === 'slow') {
        // Más largo que el timeout del proxy (15s) → fuerza ECONNABORTED
        setTimeout(() => {
          res.statusCode = 200;
          res.end(JSON.stringify(EXPEDIENTE_FIXTURE));
        }, 16000);
        return;
      }

      // mode === 'ok'
      const id = Number(match[1]);
      const body = JSON.parse(JSON.stringify(EXPEDIENTE_FIXTURE));
      body.ventero.id = id;
      body.persona.id = id;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        setMode: (m) => { mode = m; }
      });
    });
  });
}

function jsonRequest(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /ventero/:id/expediente', () => {
  let sisdep;
  let appServer;
  let appPort;

  before(async () => {
    sisdep = await startSisdepMock();
    process.env.SISDEP_BASE_URL = `http://127.0.0.1:${sisdep.port}`;

    // Importamos la app DESPUÉS de fijar SISDEP_BASE_URL.
    const { app } = require('../dist/app.js');
    appServer = app.listen(0, '127.0.0.1');
    await new Promise((r) => appServer.once('listening', r));
    appPort = appServer.address().port;
  });

  after(async () => {
    await new Promise((r) => appServer.close(r));
    await new Promise((r) => sisdep.server.close(r));
  });

  test('200 OK: retorna el expediente como passthrough', async () => {
    sisdep.setMode('ok');
    const { status, body } = await jsonRequest(appPort, '/ventero/1/expediente', {
      'x-access': 'token-valido'
    });
    assert.equal(status, 200);
    // Passthrough: no debe envolverse en { success, data }
    assert.ok(body.ventero, 'falta campo ventero');
    assert.ok(body.persona, 'falta campo persona');
    assert.ok(body.direccionResidencia, 'falta campo direccionResidencia');
    assert.ok(Array.isArray(body.datosVenta), 'datosVenta debe ser array');
    assert.equal(body.ventero.id, 1);
    assert.equal(body.persona.nombre1, 'ABELARDO');
    assert.equal(body.datosVenta[0].amoblamiento.id, 258);
    // No debe tener clave 'success' en el éxito
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'success'), false);
  });

  test('200 OK: pasa el id de la URL al upstream', async () => {
    sisdep.setMode('ok');
    const { status, body } = await jsonRequest(appPort, '/ventero/42/expediente', {
      'x-access': 'token-valido'
    });
    assert.equal(status, 200);
    assert.equal(body.ventero.id, 42);
    assert.equal(body.persona.id, 42);
  });

  test('401 cuando falta el header x-access', async () => {
    sisdep.setMode('ok');
    const { status, body } = await jsonRequest(appPort, '/ventero/1/expediente');
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.match(body.message, /Token/i);
  });

  test('400 cuando el id no es numérico (protege de path injection)', async () => {
    sisdep.setMode('ok');
    const { status, body } = await jsonRequest(appPort, '/ventero/abc/expediente', {
      'x-access': 'token-valido'
    });
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /ID inválido/);
  });

  test('400 también bloquea path traversal en :id', async () => {
    sisdep.setMode('ok');
    const { status, body } = await jsonRequest(appPort, '/ventero/1..%2Fadmin/expediente', {
      'x-access': 'token-valido'
    });
    // Express decodifica %2F y la ruta deja de hacer match del param,
    // pero si llegara a hacer match, el regex de id la rechaza.
    assert.ok(status === 400 || status === 404, `status fue ${status}`);
  });

  test('propaga 404 desde el upstream SISDEP', async () => {
    sisdep.setMode('404');
    const { status, body } = await jsonRequest(appPort, '/ventero/9999/expediente', {
      'x-access': 'token-valido'
    });
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.match(body.message, /Ventero no encontrado/);
  });

  test('propaga 401 desde el upstream cuando token es inválido', async () => {
    sisdep.setMode('auth-fail');
    const { status, body } = await jsonRequest(appPort, '/ventero/1/expediente', {
      'x-access': 'token-falso'
    });
    assert.equal(status, 401);
    assert.equal(body.success, false);
  });
});
