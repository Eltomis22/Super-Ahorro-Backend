const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = 3000;

app.use(express.json());

// CONFIGURACIÓN SUPABASE
// IMPORTANTE: Reemplaza estos valores con los de tu proyecto en Supabase Dashboard -> Settings -> API
const SUPABASE_URL = 'TU_SUPABASE_URL_AQUI';
const SUPABASE_KEY = 'TU_SUPABASE_ANON_KEY_AQUI';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Ruta raíz
app.get('/', (req, res) => {
    res.json({ mensaje: "API de SuperAhorro conectada a Supabase" });
});

// GET /supermercados (Trae los datos reales de Supabase)
app.get('/supermercados', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('supermercados')
            .select('nombre');

        if (error) throw error;

        // Convertimos el formato de Supabase a un array simple para la App
        const listaNombres = data.map(item => item.nombre);
        res.json(listaNombres);
    } catch (e) {
        console.error("Error en Supabase:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
