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
  dotenv.config({ path: path.resolve(__dirname, '../.env.development.local') });
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

// Middleware for handling JSON data and forms
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
  methods: ["GET", "POST", "OPTIONS"],  // Allowed HTTP methods
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
        path: "/api/proxy-image?url=",
        description: "Proxy para imágenes que valida dominios permitidos (medellin.gov.co) y requiere autenticación."
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
      }
    ]
  });
});

const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
};

app.get('/api/proxy-image', asyncHandler(async (req: Request, res: Response) => {
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
  const allowedDomains = [
    'https://www.medellin.gov.co',
    'https://medellin.gov.co'
  ];

  if (!allowedDomains.some(domain => imageUrl.startsWith(domain))) {
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
}));

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

export { app };

// HTTP plano. En producción, el TLS lo termina un reverse proxy (nginx/ALB/etc.).
if (process.env.NODE_ENV !== 'test') {
  http.createServer(app).listen(port, '0.0.0.0', () => {
    console.log(`Servidor HTTP corriendo en el puerto ${port} (${isProduction ? 'producción' : 'desarrollo'})`);
  });
}
