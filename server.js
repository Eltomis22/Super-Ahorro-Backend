const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

// Datos de prueba (Supermercados)
const supermercados = [
    "Carrefour",
    "Coto",
    "Día",
    "Jumbo",
    "La Anónima",
    "Vea",
    "Disco",
    "ChangoMas"
];

// Ruta raíz
app.get('/', (req, res) => {
    res.json({ mensaje: "API de SuperAhorro funcionando" });
});

// NUEVO: Ruta para obtener supermercados
app.get('/supermercados', (req, res) => {
    console.log("Recibida petición GET /supermercados");
    res.json(supermercados);
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
