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
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const pg_1 = require("pg");
const body_parser_1 = __importDefault(require("body-parser"));
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Configurar la conexión a PostgreSQL
const pool = new pg_1.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT)
});
// Configurar el motor de vistas EJS
app.set('view engine', 'ejs');
// Middleware para manejar datos JSON y formularios
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.use(body_parser_1.default.json());
// Ruta principal para renderizar la vista principal
app.get('/', (req, res) => {
    res.render('index'); // Renderiza el archivo index.ejs en la carpeta views
});
// Ruta POST para manejar envíos de formularios
app.post('/submit', (req, res) => {
    const { name } = req.body;
    res.send(`Hello, ${name}, we were waiting for you!`);
});
// Ruta GET para devolver una respuesta API simple
app.get('/api/data', (req, res) => {
    const data = {
        message: 'Hello from the API!',
        status: 'success'
    };
    res.json(data);
});
// Ruta POST para la API
app.post('/api/submit', (req, res) => {
    const { info } = req.body;
    res.json({ message: `Received ${info}`, status: 'success' });
});
// Ruta GET para probar la conexión con la base de datos
app.get('/db-test', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield pool.query('SELECT NOW()');
        res.json(result.rows);
    }
    catch (err) {
        console.error(err);
        res.status(500).send('Error connecting to the database');
    }
}));
// Ruta GET para obtener información básica de la base de datos
app.get('/db-test-basic-info', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield pool.query('SELECT * FROM public.basic_info');
        res.json(result.rows);
    }
    catch (err) {
        console.error(err);
        res.status(500).send('Error connecting to the database');
    }
}));
// Cerrar la conexión con la base de datos al salir
process.on('exit', () => {
    pool.end();
});
// Iniciar el servidor
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
