import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import bodyParser from 'body-parser';

const app = express();
const port = process.env.PORT;

// Configurar la conexión a PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT)
});

// Configurar el motor de vistas EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware para manejar datos JSON y formularios
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ruta principal para renderizar la vista principal
app.get('/', (req: Request, res: Response) => {
  res.render('index'); // Renderiza el archivo index.ejs en la carpeta views
});

// Ruta POST para manejar envíos de formularios
app.post('/submit', (req: Request, res: Response) => {
  const { name } = req.body;
  res.send(`Hello, ${name}, we were waiting for you!`);
});

// Ruta GET para devolver una respuesta API simple
app.get('/api/data', (req: Request, res: Response) => {
  const data = {
    message: 'Hello from the API!',
    status: 'success',
    value: 'testing value'
  };
  res.json(data);
});

// Ruta POST para la API
app.post('/api/submit', (req: Request, res: Response) => {
  const { info } = req.body;
  res.json({ message: `Received ${info}`, status: 'success' });
});

// Ruta GET para probar la conexión con la base de datos
app.get('/db-test', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error connecting to the database');
  }
});

// Ruta GET para obtener información básica de la base de datos
app.get('/usuarios-testing', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM public.usuarios');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error connecting to the database');
  }
});

// Función para obtener datos de Venteros

app.get('/modulo-ventero-resolucion', async (req, res) => {
  try {
    const query = `
            SELECT 
                p.nombre1 || ' ' || p.apellido1 AS nombre_completo,
                p.documento,
                p.id_tipo_documento,
                p.correo_electronico,
                v.asociacion_participa,
                r.numero AS numero_resolucion,
                m.serial_propio
            FROM 
                sisdep_archivo.persona p
            LEFT JOIN 
                sisdep_archivo.ventero v ON p.id = v.id
            LEFT JOIN 
                sisdep_regulaciones.resolucion r ON p.id = r.id
            LEFT JOIN 
                sisdep_general.modulo m ON p.id = m.id;
        `;

    const { rows } = await pool.query(query);

    // Devuelve la respuesta con los datos
    res.json(rows);
  } catch (error) {
    console.error('Error ejecutando la consulta', error);
    res.status(500).send('Error en el servidor');
  }
});

// Cerrar la conexión con la base de datos al salir
process.on('exit', () => {
  pool.end();
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
