import dotenv from 'dotenv';
import http from 'http';
import express, {NextFunction, Request, Response} from 'express';
import axios from 'axios';
import { AxiosRequestConfig } from 'axios';
import { fileURLToPath } from 'url';
import cors from 'cors';
import path from 'path';
const app = express();

/*
// Get the current file name and directory name
const __filename = fileURLToPath(import.meta.url);
import path from 'path';

// Get the directory name of the current module
const __dirname = path.dirname(__filename);
*/

//const __dirname = path.resolve();

interface PersonaResponse {
  nombres: string;
  apellidos: string;
  tipoDocumento: string;
  documento: string;
  biometricData?: {
    image?: string;
  };
  actividadEconomicaActual: string;
  claseVenta: string;
  solicitudDeAutorizacion?: {
    fechaFinal?: string;
    radicadoMercurio?: string;
  }[];
}

// This ensures that we do not overwrite NODE_ENV if it is already defined
if (!process.env.NODE_ENV) {
  console.warn("NODE_ENV no está definido. Se usará 'development' como valor predeterminado.");
  process.env.NODE_ENV = 'development';
}

// Configure dotenv according to the environment
if (process.env.NODE_ENV === 'development') {
  // quiet: dotenv 17 imprime un banner promocional en cada arranque; sin esto
  // queda en los logs del contenedor.
  dotenv.config({ path: path.resolve(__dirname, '../.env.development.local'), quiet: true });
  console.log("Entorno de desarrollo configurado.");
} else if (process.env.NODE_ENV === 'production') {
  // .env is not loaded in production, since AWS takes care of the environment variables
  console.log("Entorno de producción configurado.");
} else {
  console.warn("Entorno desconocido. No se cargaron configuraciones específicas.");
}

// Detect the environment (production or development)
const isProduction = process.env.NODE_ENV === 'production';
const port = isProduction ? Number(process.env.PORT) || 8080 : 5001;

const sisdepBaseUrl = (process.env.SISDEP_BASE_URL || 'https://www.medellin.gov.co/sisdep/back').replace(/\/+$/, '');

function buildImageAllowedOrigins(sisdepBase: string): string[] {
  const defaults = 'https://www.medellin.gov.co,https://medellin.gov.co';
  const origins = new Set(
    (process.env.IMAGE_ALLOWED_ORIGINS || defaults)
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );

  try {
    origins.add(new URL(sisdepBase).origin);
  } catch {
    // SISDEP_BASE_URL inválida: solo se usan los orígenes del env.
  }

  return [...origins];
}

const imageAllowedOrigins = buildImageAllowedOrigins(sisdepBaseUrl);

// Middleware for handling JSON data and forms
// Express 5 cambio el parser de query de 'extended' a 'simple'. Este backend
// reenvia req.query tal cual a SISDEP en casi todos los endpoints, asi que se deja
// el comportamiento de Express 4 para que ningun filtro cambie de forma en el camino.
app.set('query parser', 'extended');

app.use(express.json({ limit: "10mb" })); // 📌 Permite JSON grande (Base64)
app.use(express.urlencoded({ extended: true, limit: "10mb" })); // 📌 Permite datos codificados en URLs

// This line is similar to the above code
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

// CORS configuration options
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {

    // Allow requests from allowed or no origins (eg. Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Origen no permitido por CORS"), false);  // Reject the request by Cors
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],  // Allowed HTTP methods
  allowedHeaders: ["Content-Type", 'x-access', 'Accept'],
  credentials: true,// Allowed HTTP headers
};

app.use(cors(corsOptions));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'API SIVEP funcionando correctamente',
    status: 'success',
    endpoints: [
      {
        method: "GET",
        path: "/",
        description: "Información sobre los endpoints disponibles en la API."
      },
      {
        method: "GET",
        path: "/proxy-image?url=",
        description: "Proxy para imágenes que valida dominios permitidos y requiere autenticación."
      },
      {
        method: "POST",
        path: "/login",
        description: "Autenticación de usuarios contra el sistema SISDEP, requiere username y password."
      },
      {
        method: "GET",
        path: "/ventero-completo/:id",
        description: "Obtiene información combinada de ventero y persona para un ID específico, requiere token de autenticación."
      },
      {
        method: "GET",
        path: "/ventero/:id/expediente",
        description: "Obtiene el expediente completo del ventero (ventero, persona, dirección, datos de venta) desde SISDEP, requiere token de autenticación."
      },
      {
        method: "GET",
        path: "/ventero-por-documento/:documento",
        description: "Busca un ventero por número de documento usando SISDEP, requiere token de autenticación."
      },
      {
        method: "GET|POST|PATCH|DELETE",
        path: "/dominios/tipoReporteSivep[/:id]",
        description: "CRUD del catálogo de prioridades de Reporte SIVEP (1=Grave, 2=Media, 3=Baja, 4=En prioridad). Proxy a SISDEP."
      },
      {
        method: "GET|POST|PATCH|DELETE",
        path: "/social/reporteSivep[/:id]",
        description: "CRUD de reportes SIVEP sobre venteros. Incluye GET /paginated con query params estándar. Proxy a SISDEP."
      },
      {
        method: "POST",
        path: "/archivos",
        description: "Sube foto/firma a SISDEP (multipart con partes 'info' y 'file'). Devuelve { archivos: [{ id, fullPath, ... }] }."
      },
      {
        method: "GET",
        path: "/archivos/:folder/:filename",
        description: "Descarga binaria de un archivo guardado en SISDEP, requiere token. Stream passthrough."
      },
      {
        method: "GET",
        path: "/dominios/{municipio|comuna|barrio|nomenclaturaVial|orientacion}",
        description: "Catálogos maestros usados para construir direcciones. Proxy a SISDEP."
      },
      {
        method: "POST",
        path: "/general/direccion/validar",
        description: "Valida si una dirección ya existe en SISDEP antes de crearla. Devuelve `existe`, `id` y `similares`."
      },
      {
        method: "GET|POST|PATCH",
        path: "/general/direccion[/:id]",
        description: "CRUD de direcciones estructuradas (intersección de vías + barrio/comuna/municipio + geolocalización)."
      },
      {
        method: "GET",
        path: "/general/direccionCompleta/{paginated|count|excel}",
        description: "Listado enriquecido de direcciones con nombres de barrio/comuna/municipio resueltos."
      },
      {
        method: "GET",
        path: "/regulaciones/autorizacion",
        description: "Busca autorizaciones (con datos del ventero) por radicado mercurio. Filtros por query params: ?radicadoMercurio= (exacto), ?contains= (parcial), ?documento=, ?fechaInicial__gte=. Proxy a la vista SolicitudAutorizacionReporte de SISDEP."
      }
    ]
  });
});

const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const proxyImageHandler = asyncHandler(async (req: Request, res: Response) => {
  const authToken = req.headers['x-access'];
  const imageUrl = req.query.url as string;

  // 1. Strong validations
  if (!authToken) {
    return res.status(401).json({
      success: false,
      message: 'Token de autenticación requerido'
    });
  }

  if (!imageUrl) {
    return res.status(400).json({
      success: false,
      message: 'Parámetro URL requerido'
    });
  }

  // 2. Allow only specific domains
  if (!imageAllowedOrigins.some(domain => imageUrl.startsWith(domain))) {
    return res.status(403).json({
      success: false,
      message: 'Dominio no permitido'
    });
  }

  try {
    // 3. Axios configuration and timeout
    const axiosConfig: AxiosRequestConfig = {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'x-access': Array.isArray(authToken) ? authToken[0] : authToken,
        'Accept': 'image/*'
      },
      validateStatus: () => true // Para manejar todos los estados manualmente
    };

    // 4. Get the image using Axios
    const response = await axios.get(imageUrl, axiosConfig);

    // 5. Validate response status and content type
    if (response.status !== 200) {
      return res.status(response.status).json({
        success: false,
        message: `Error ${response.status} al obtener la imagen`
      });
    }

    const contentType = response.headers['content-type'] as string | undefined;
    if (!contentType?.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'El recurso no es una imagen válida'
      });
    }

    // 6. Configure response headers
    res.set({
      'Content-Type': contentType,
      'Content-Length': response.headers['content-length'],
      'Cache-Control': 'public, max-age=3600'
    });

    // 7. Send the image data
    res.send(response.data);

  } catch (error: any) {
    console.error('Error en proxy-image:', error);

    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        success: false,
        message: 'Timeout al conectar con el servidor de imágenes'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/proxy-image', proxyImageHandler);
app.get('/api/proxy-image', proxyImageHandler);

interface LoginCredentials {
  username: string;
  password: string;
}

interface ExternalLoginResponse {
  status: string;
  idGrupo: number;
  token: string;
  idUser: number;
}

interface UserDetailsResponse {
  entities: {
    usuario: {
      [key: number]: {
        id: number;
        nombre: string;
        apellido: string;
        email: string;
        esActivo: boolean;
        idGrupo: number;
      };
    };
  };
}

// Calling https://www.medellin.gov.co/sisdep Api from sivep backend, login endpoint
app.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as LoginCredentials;

  // Basic validation
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Usuario y contraseña son requeridos'
    });
  }

  let timeout: NodeJS.Timeout | null = null;
  const controller = new AbortController();

  try {
    timeout = setTimeout(() => controller.abort(), 15000);

    // 1. First login request
    const loginUrl = `${sisdepBaseUrl}/login`;
    const loginResponse = await axios.post<ExternalLoginResponse>(loginUrl, {
      username,
      password
    }, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // console.log('loginResponse ',loginResponse.data.token)

    // Clear timeout if it exists
    if (timeout) {
      clearTimeout(timeout);
    }

    // Validate first login response
    if (!loginResponse.data.token || loginResponse.data.status !== "logged!, welcome board") {
      return res.status(401).json({
        success: false,
        message: 'Autenticación fallida'
      });
    }

    // 2. Validate user details if the first response is successful and active
    timeout = setTimeout(() => controller.abort(), 10000);
    const userDetailsUrl = `${sisdepBaseUrl}/api/seguridad/usuario/ego`;

    const userDetailsResponse = await axios.get<UserDetailsResponse>(userDetailsUrl, {
      signal: controller.signal,
      headers: {
        'x-access': `${loginResponse.data.token}`,
        'Content-Type': 'application/json'
      }
    });

    if (timeout) clearTimeout(timeout);

    // Validate the second response
    const userData = userDetailsResponse.data.entities.usuario[loginResponse.data.idUser];
    if (!userData || !userData.esActivo) {
      return res.status(403).json({
        success: false,
        message: 'El usuario no está activo en el sistema'
      });
    }

    // Successful login, return the token and the whole user data
    res.json({
      success: true,
      token: loginResponse.data.token,
      user: {
        id: loginResponse.data.idUser,
        grupo: loginResponse.data.idGrupo,
        nombre: userData.nombre,
        apellido: userData.apellido,
        email: userData.email,
        activo: userData.esActivo
      }
    });

  } catch (error: any) {
    if (timeout) clearTimeout(timeout);

    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      return res.status(504).json({
        success: false,
        message: 'El servicio no respondió a tiempo'
      });
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || 'Error en el servicio';

      return res.status(status).json({
        success: false,
        message: status === 403 ? 'Acceso no autorizado' : message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
}));

app.get('/ventero-completo/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const authToken = req.headers['x-access'];

  if (!authToken) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }

  try {
    // Create proper axios config object
    const axiosConfig = {
      headers: {
        'x-access': Array.isArray(authToken) ? authToken[0] : authToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };

    const [venteroResponse, personaResponse] = await Promise.all([
      axios.get(`${sisdepBaseUrl}/api/ventero/ventero/${id}`, axiosConfig),
      axios.get(`${sisdepBaseUrl}/api/ventero/persona/${id}`, axiosConfig)
    ]);

    res.json({
      success: true,
      ventero: venteroResponse.data,
      persona: personaResponse.data
    });

  } catch (error: any) {
    console.error('Error en proxy:', error);

    if (error.response) {
      // Api error
      res.status(error.response.status).json({
        success: false,
        message: error.response.data?.message || 'Error en el servidor remoto'
      });
    } else if (error.request) {
      // No response from the server
      res.status(504).json({
        success: false,
        message: 'El servidor remoto no respondió'
      });
    } else {
      // Configuration issue or other error
      res.status(500).json({
        success: false,
        message: 'Error interno del proxy'
      });
    }
  }
}));

app.get('/ventero/:id/expediente', asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const authToken = req.headers['x-access'];

  if (!authToken) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido: debe ser numérico' });
  }

  try {
    const axiosConfig = {
      headers: {
        'x-access': Array.isArray(authToken) ? authToken[0] : authToken,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };

    const expedienteResponse = await axios.get(
      `${sisdepBaseUrl}/api/ventero/ventero/${id}/expediente`,
      axiosConfig
    );

    res.status(200).json(expedienteResponse.data);

  } catch (error: any) {
    console.error('Error en /ventero/:id/expediente:', error.message);

    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        message: error.response.data?.message || 'Error en el servidor remoto'
      });
    } else if (error.request) {
      res.status(504).json({
        success: false,
        message: 'El servidor remoto no respondió'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Error interno del proxy'
      });
    }
  }
}));

app.get('/ventero-por-documento/:documento', asyncHandler(async (req: Request, res: Response) => {
  const documento = String(req.params.documento ?? '');
  const authToken = req.headers['x-access'];

  if (!authToken) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }

  if (!/^\d+$/.test(documento)) {
    return res.status(400).json({ success: false, message: 'Documento inválido: debe ser numérico' });
  }

  try {
    const axiosConfig = {
      headers: {
        'x-access': Array.isArray(authToken) ? authToken[0] : authToken,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };

    const personaResponse = await axios.get(
      `${sisdepBaseUrl}/api/ventero/persona?documento=${encodeURIComponent(documento)}`,
      axiosConfig
    );

    res.status(200).json(personaResponse.data);

  } catch (error: any) {
    console.error('Error en /ventero-por-documento/:documento:', error.message);

    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        message: error.response.data?.message || 'Error en el servidor remoto'
      });
    } else if (error.request) {
      res.status(504).json({
        success: false,
        message: 'El servidor remoto no respondió'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Error interno del proxy'
      });
    }
  }
}));

// ============================================================
// Reporte SIVEP — proxy a SISDEP
// Dominio: /api/dominios/tipoReporteSivep
// Reporte: /api/social/reporteSivep
// ============================================================

function buildAxiosConfig(authToken: string | string[], query?: any): AxiosRequestConfig {
  return {
    headers: {
      'x-access': Array.isArray(authToken) ? authToken[0] : authToken,
      'Content-Type': 'application/json'
    },
    params: query,
    timeout: 15000
  };
}

function handleProxyError(error: any, res: Response, route: string) {
  console.error(`Error en ${route}:`, error.message);
  if (error.response) {
    res.status(error.response.status).json({
      success: false,
      message: error.response.data?.message || 'Error en el servidor remoto'
    });
  } else if (error.request) {
    res.status(504).json({
      success: false,
      message: 'El servidor remoto no respondió'
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'Error interno del proxy'
    });
  }
}

function requireToken(req: Request, res: Response): string | string[] | null {
  const authToken = req.headers['x-access'];
  if (!authToken) {
    res.status(401).json({ success: false, message: 'Token no proporcionado' });
    return null;
  }
  return authToken;
}

function requireNumericId(req: Request, res: Response): string | null {
  const id = String(req.params.id ?? '');
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ success: false, message: 'ID inválido: debe ser numérico' });
    return null;
  }
  return id;
}

// --- Dominio: tipoReporteSivep ---

app.get('/dominios/tipoReporteSivep', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/dominios/tipoReporteSivep`,
      buildAxiosConfig(authToken, req.query)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/dominios/tipoReporteSivep');
  }
}));

app.get('/dominios/tipoReporteSivep/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/dominios/tipoReporteSivep/${id}`,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/dominios/tipoReporteSivep/:id');
  }
}));

app.post('/dominios/tipoReporteSivep', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.post(
      `${sisdepBaseUrl}/api/dominios/tipoReporteSivep`,
      req.body,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'POST /api/dominios/tipoReporteSivep');
  }
}));

app.patch('/dominios/tipoReporteSivep/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.patch(
      `${sisdepBaseUrl}/api/dominios/tipoReporteSivep/${id}`,
      req.body,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'PATCH /api/dominios/tipoReporteSivep/:id');
  }
}));

app.delete('/dominios/tipoReporteSivep/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.delete(
      `${sisdepBaseUrl}/api/dominios/tipoReporteSivep/${id}`,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data ?? { success: true });
  } catch (error: any) {
    handleProxyError(error, res, 'DELETE /api/dominios/tipoReporteSivep/:id');
  }
}));

// --- Reporte SIVEP ---
// IMPORTANTE: /paginated debe registrarse antes que /:id para que Express
// no capture "paginated" como id dinámico.

app.get('/social/reporteSivep/paginated', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/social/reporteSivep/paginated`,
      buildAxiosConfig(authToken, req.query)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/social/reporteSivep/paginated');
  }
}));

app.get('/social/reporteSivep', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/social/reporteSivep`,
      buildAxiosConfig(authToken, req.query)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/social/reporteSivep');
  }
}));

app.get('/social/reporteSivep/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/social/reporteSivep/${id}`,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/social/reporteSivep/:id');
  }
}));

app.post('/social/reporteSivep', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.post(
      `${sisdepBaseUrl}/api/social/reporteSivep`,
      req.body,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'POST /api/social/reporteSivep');
  }
}));

app.patch('/social/reporteSivep/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.patch(
      `${sisdepBaseUrl}/api/social/reporteSivep/${id}`,
      req.body,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'PATCH /api/social/reporteSivep/:id');
  }
}));

app.delete('/social/reporteSivep/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.delete(
      `${sisdepBaseUrl}/api/social/reporteSivep/${id}`,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data ?? { success: true });
  } catch (error: any) {
    handleProxyError(error, res, 'DELETE /api/social/reporteSivep/:id');
  }
}));

// ============================================================
// Regulaciones — Autorizaciones (vista de reporte) — proxy a SISDEP
// Permite buscar autorizaciones por radicado mercurio del ventero.
// La vista ya trae los datos del ventero (nombres, apellidos, documento)
// junto al radicadoMercurio, motivo, fechas y dirección.
// Filtros vía query params (los resuelve el GenericController en SISDEP):
//   ?radicadoMercurio=2024-123   → coincidencia exacta
//   ?contains=2024               → búsqueda parcial (ILIKE en campos texto)
//   ?documento=10203040          → autorizaciones de un ventero
//   ?fechaInicial__gte=2026-01-01T00:00:00 → operadores de rango
// ============================================================

app.get('/regulaciones/autorizacion', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/regulaciones/reportes/SolicitudAutorizacionReporte`,
      buildAxiosConfig(authToken, req.query)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/regulaciones/reportes/SolicitudAutorizacionReporte');
  }
}));

// ============================================================
// Archivos — proxy del endpoint genérico SISDEP
// POST /api/archivos        : sube multipart, devuelve { archivos: [{ id, fullPath, ... }] }
// GET  /api/archivos/:folder/:filename : sirve el binario guardado
// ============================================================

// POST: passthrough del stream multipart. NO usar express.json — el body
// llega como stream binario porque su Content-Type es multipart/form-data.
app.post('/archivos', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;

  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.startsWith('multipart/form-data')) {
    return res.status(400).json({
      success: false,
      message: 'Content-Type debe ser multipart/form-data'
    });
  }

  try {
    const upstream = await axios.post(
      `${sisdepBaseUrl}/api/archivos`,
      req,
      {
        headers: {
          'x-access': Array.isArray(authToken) ? authToken[0] : authToken,
          'content-type': contentType,
          ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {})
        },
        maxBodyLength: 50 * 1024 * 1024,
        maxContentLength: 50 * 1024 * 1024,
        timeout: 60000
      }
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'POST /api/archivos');
  }
}));

// GET: descarga binaria del archivo guardado. Stream passthrough.
app.get('/archivos/:folder/:filename', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;

  const folder = String(req.params.folder ?? '');
  const filename = String(req.params.filename ?? '');
  // Defensa básica contra path traversal — Express ya decodifica %2F.
  if (/[\\/]/.test(folder) || /[\\/]/.test(filename) || folder.includes('..') || filename.includes('..')) {
    return res.status(400).json({ success: false, message: 'Ruta inválida' });
  }

  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/archivos/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        headers: {
          'x-access': Array.isArray(authToken) ? authToken[0] : authToken
        },
        responseType: 'stream',
        timeout: 30000,
        validateStatus: () => true
      }
    );

    // Si el upstream devolvió error como JSON, propagar status + body legible.
    if (upstream.status >= 400) {
      let body = '';
      for await (const chunk of upstream.data) body += chunk.toString();
      let parsed: any = { message: body || 'Error en el servidor remoto' };
      try { parsed = JSON.parse(body); } catch { /* mantener texto */ }
      return res.status(upstream.status).json({
        success: false,
        message: parsed.message || 'Error en el servidor remoto'
      });
    }

    if (upstream.headers['content-type']) res.set('Content-Type', upstream.headers['content-type'] as string);
    if (upstream.headers['content-length']) res.set('Content-Length', upstream.headers['content-length'] as string);
    if (upstream.headers['cache-control']) res.set('Cache-Control', upstream.headers['cache-control'] as string);
    res.status(upstream.status);
    upstream.data.pipe(res);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/archivos/:folder/:filename');
  }
}));

// ============================================================
// Direcciones — proxy a SISDEP
// Catálogos: municipio, comuna, barrio, nomenclaturaVial, orientacion
// Core: /api/general/direccion (+ /validar)
// Vista enriquecida: /api/general/direccionCompleta
// ============================================================

function proxyGetCatalogo(path: string) {
  return asyncHandler(async (req: Request, res: Response) => {
    const authToken = requireToken(req, res);
    if (!authToken) return;
    try {
      const upstream = await axios.get(
        `${sisdepBaseUrl}${path}`,
        buildAxiosConfig(authToken, req.query)
      );
      res.status(upstream.status).json(upstream.data);
    } catch (error: any) {
      handleProxyError(error, res, `GET ${path}`);
    }
  });
}

app.get('/dominios/municipio', proxyGetCatalogo('/api/dominios/municipio'));
app.get('/dominios/comuna', proxyGetCatalogo('/api/dominios/comuna'));
app.get('/dominios/barrio', proxyGetCatalogo('/api/dominios/barrio'));
app.get('/dominios/nomenclaturaVial', proxyGetCatalogo('/api/dominios/nomenclaturaVial'));
app.get('/dominios/orientacion', proxyGetCatalogo('/api/dominios/orientacion'));

// --- Direccion core ---

app.post('/general/direccion/validar', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.post(
      `${sisdepBaseUrl}/api/general/direccion/validar`,
      req.body,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'POST /api/general/direccion/validar');
  }
}));

app.post('/general/direccion', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.post(
      `${sisdepBaseUrl}/api/general/direccion`,
      req.body,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'POST /api/general/direccion');
  }
}));

app.get('/general/direccion', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/general/direccion`,
      buildAxiosConfig(authToken, req.query)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/general/direccion');
  }
}));

app.get('/general/direccion/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/general/direccion/${id}`,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/general/direccion/:id');
  }
}));

app.patch('/general/direccion/:id', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  const id = requireNumericId(req, res);
  if (!id) return;
  try {
    const upstream = await axios.patch(
      `${sisdepBaseUrl}/api/general/direccion/${id}`,
      req.body,
      buildAxiosConfig(authToken)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'PATCH /api/general/direccion/:id');
  }
}));

// --- direccionCompleta (vista) ---

app.get('/general/direccionCompleta/paginated', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/general/direccionCompleta/paginated`,
      buildAxiosConfig(authToken, req.query)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/general/direccionCompleta/paginated');
  }
}));

app.get('/general/direccionCompleta/count', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/general/direccionCompleta/count`,
      buildAxiosConfig(authToken, req.query)
    );
    res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/general/direccionCompleta/count');
  }
}));

app.get('/general/direccionCompleta/excel', asyncHandler(async (req: Request, res: Response) => {
  const authToken = requireToken(req, res);
  if (!authToken) return;
  try {
    const upstream = await axios.get(
      `${sisdepBaseUrl}/api/general/direccionCompleta/excel`,
      {
        headers: {
          'x-access': Array.isArray(authToken) ? authToken[0] : authToken
        },
        params: req.query,
        responseType: 'stream',
        timeout: 60000,
        validateStatus: () => true
      }
    );

    if (upstream.status >= 400) {
      let body = '';
      for await (const chunk of upstream.data) body += chunk.toString();
      let parsed: any = { message: body || 'Error en el servidor remoto' };
      try { parsed = JSON.parse(body); } catch { /* texto plano */ }
      return res.status(upstream.status).json({
        success: false,
        message: parsed.message || 'Error en el servidor remoto'
      });
    }

    if (upstream.headers['content-type']) res.set('Content-Type', upstream.headers['content-type'] as string);
    if (upstream.headers['content-length']) res.set('Content-Length', upstream.headers['content-length'] as string);
    if (upstream.headers['content-disposition']) res.set('Content-Disposition', upstream.headers['content-disposition'] as string);
    res.status(upstream.status);
    upstream.data.pipe(res);
  } catch (error: any) {
    handleProxyError(error, res, 'GET /api/general/direccionCompleta/excel');
  }
}));

export { app };

// HTTP plano. En producción, el TLS lo termina un reverse proxy (nginx/ALB/etc.).
if (process.env.NODE_ENV !== 'test') {
  http.createServer(app).listen(port, '0.0.0.0', () => {
    console.log(`Servidor HTTP corriendo en el puerto ${port} (${isProduction ? 'producción' : 'desarrollo'})`);
  });
}
