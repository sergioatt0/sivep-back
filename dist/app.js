"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
// This ensures that we do not overwrite NODE_ENV if it is already defined
if (!process.env.NODE_ENV) {
    console.warn("NODE_ENV no está definido. Se usará 'development' como valor predeterminado.");
    process.env.NODE_ENV = 'development';
}
// Configure dotenv according to the environment
if (process.env.NODE_ENV === 'development') {
    dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env.development.local') });
    console.log("Entorno de desarrollo configurado.");
}
else if (process.env.NODE_ENV === 'production') {
    // .env is not loaded in production, since AWS takes care of the environment variables
    console.log("Entorno de producción configurado.");
}
else {
    console.warn("Entorno desconocido. No se cargaron configuraciones específicas.");
}
// Detect the environment (production or development)
const isProduction = process.env.NODE_ENV === 'production';
const port = isProduction ? Number(process.env.PORT) || 8080 : 5001;
const sisdepBaseUrl = (process.env.SISDEP_BASE_URL || 'https://www.medellin.gov.co/sisdep/back').replace(/\/+$/, '');
// Middleware for handling JSON data and forms
app.use(express_1.default.json({ limit: "10mb" })); // 📌 Permite JSON grande (Base64)
app.use(express_1.default.urlencoded({ extended: true, limit: "10mb" })); // 📌 Permite datos codificados en URLs
// This line is similar to the above code
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
// CORS configuration options
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests from allowed or no origins (eg. Postman)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error("Origen no permitido por CORS"), false); // Reject the request by Cors
        }
    },
    methods: ["GET", "POST", "OPTIONS"], // Allowed HTTP methods
    allowedHeaders: ["Content-Type", 'x-access', 'Accept'],
    credentials: true, // Allowed HTTP headers
};
app.use((0, cors_1.default)(corsOptions));
// Routes
app.get('/', (req, res) => {
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
            }
        ]
    });
});
const asyncHandler = (fn) => {
    return (req, res, next) => {
        return Promise.resolve(fn(req, res, next)).catch(next);
    };
};
app.get('/api/proxy-image', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const authToken = req.headers['x-access'];
    const imageUrl = req.query.url;
    console.log('authToken:', authToken);
    console.log('imageUrl :', imageUrl);
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
        const axiosConfig = {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'x-access': Array.isArray(authToken) ? authToken[0] : authToken,
                'Accept': 'image/*'
            },
            validateStatus: () => true // Para manejar todos los estados manualmente
        };
        // 4. Get the image using Axios
        const response = yield axios_1.default.get(imageUrl, axiosConfig);
        console.log('response axios :', response);
        // 5. Validate response status and content type
        if (response.status !== 200) {
            return res.status(response.status).json({
                success: false,
                message: `Error ${response.status} al obtener la imagen`
            });
        }
        const contentType = response.headers['content-type'];
        if (!(contentType === null || contentType === void 0 ? void 0 : contentType.startsWith('image/'))) {
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
    }
    catch (error) {
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
})));
// Calling https://www.medellin.gov.co/sisdep Api from sivep backend, login endpoint
app.post('/login', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { username, password } = req.body;
    // Basic validation
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Usuario y contraseña son requeridos'
        });
    }
    let timeout = null;
    const controller = new AbortController();
    try {
        timeout = setTimeout(() => controller.abort(), 15000);
        // 1. First login request
        const loginUrl = `${sisdepBaseUrl}/login`;
        const loginResponse = yield axios_1.default.post(loginUrl, {
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
        const userDetailsResponse = yield axios_1.default.get(userDetailsUrl, {
            signal: controller.signal,
            headers: {
                'x-access': `${loginResponse.data.token}`,
                'Content-Type': 'application/json'
            }
        });
        if (timeout)
            clearTimeout(timeout);
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
    }
    catch (error) {
        if (timeout)
            clearTimeout(timeout);
        if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
            return res.status(504).json({
                success: false,
                message: 'El servicio no respondió a tiempo'
            });
        }
        if (axios_1.default.isAxiosError(error)) {
            const status = ((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) || 500;
            const message = ((_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.message) || 'Error en el servicio';
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
})));
app.get('/ventero-completo/:id', asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
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
        const [venteroResponse, personaResponse] = yield Promise.all([
            axios_1.default.get(`${sisdepBaseUrl}/api/ventero/ventero/${id}`, axiosConfig),
            axios_1.default.get(`${sisdepBaseUrl}/api/ventero/persona/${id}`, axiosConfig)
        ]);
        res.json({
            success: true,
            ventero: venteroResponse.data,
            persona: personaResponse.data
        });
    }
    catch (error) {
        console.error('Error en proxy:', error);
        if (error.response) {
            // Api error
            res.status(error.response.status).json({
                success: false,
                message: ((_a = error.response.data) === null || _a === void 0 ? void 0 : _a.message) || 'Error en el servidor remoto'
            });
        }
        else if (error.request) {
            // No response from the server
            res.status(504).json({
                success: false,
                message: 'El servidor remoto no respondió'
            });
        }
        else {
            // Configuration issue or other error
            res.status(500).json({
                success: false,
                message: 'Error interno del proxy'
            });
        }
    }
})));
// Logic to handle SSL certificate configuration depending on the environment
if (process.env.NODE_ENV === 'development') {
    // Only in development we use HTTPS
    const sslKeyPath = process.env.SSL_KEY_PATH;
    const sslCertPath = process.env.SSL_CERT_PATH;
    if (!sslKeyPath || !sslCertPath) {
        throw new Error('SSL_KEY_PATH y SSL_CERT_PATH deben estar definidos en desarrollo');
    }
    const httpsOptions = {
        key: fs_1.default.readFileSync(sslKeyPath),
        cert: fs_1.default.readFileSync(sslCertPath),
    };
    // Using HTTPS in development
    https_1.default.createServer(httpsOptions, app).listen(port, () => {
        console.log(`Servidor HTTPS corriendo en el puerto ${port} (de desarrollo)`);
    });
}
else {
    // In production, we will use HTTP (HTTPS management is done by the reverse proxy)
    http_1.default.createServer(app).listen(port, '0.0.0.0', () => {
        console.log(`Servidor HTTP corriendo en el puerto ${port} (de producción)`);
    });
}
