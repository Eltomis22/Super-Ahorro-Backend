const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL y SUPABASE_ANON_KEY son requeridas en el archivo .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuración de Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Usamos gemini-1.5-flash-latest para asegurar la versión más reciente compatible con el SDK
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- ENDPOINTS ---

// Ruta raíz para verificar que el servidor funciona
app.get('/', (req, res) => {
    res.json({ message: 'Backend de SuperAhorro funcionando 🚀' });
});

/**
 * GET: Obtiene la lista de supermercados desde Supabase.
 * Endpoint: /api/v1/supermercados
 */
app.get('/api/v1/supermercados', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('supermercados')
            .select('nombre')
            .order('nombre', { ascending: true });

        if (error) throw error;

        // Devolvemos solo la lista de strings como espera la app
        const listaNombres = data.map(s => s.nombre);
        res.json(listaNombres);
    } catch (error) {
        console.error('Error al obtener supermercados:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST: Sincroniza una compra local con el servidor.
 * Recibe el objeto Compra (incluyendo sus productos si vienen en el body).
 * Endpoint: /api/v1/compras
 */
app.post('/api/v1/compras', async (req, res) => {
    try {
        const compra = req.body;
        console.log('Recibida compra para sincronizar:', compra);

        // 1. Verificar si el supermercado ya existe en la lista de sugerencias (Master Data)
        const { data: existente, error: errorCheck } = await supabase
            .from('supermercados')
            .select('nombre')
            .ilike('nombre', compra.supermercado)
            .maybeSingle();

        if (errorCheck) console.warn('Aviso: No se pudo verificar el supermercado existente:', errorCheck.message);

        // Si no existe, lo agregamos automáticamente para futuras sugerencias
        if (!existente && compra.supermercado) {
            console.log(`Nuevo supermercado detectado: ${compra.supermercado}. Agregando a sugerencias...`);
            await supabase
                .from('supermercados')
                .insert([{ nombre: compra.supermercado }]);
        }

        // 2. Insertar la compra en Supabase
        const { data: nuevaCompra, error: errorCompra } = await supabase
            .from('compras')
            .insert([{
                id_local: compra.id,
                fecha: compra.fecha,
                hora: compra.hora,
                supermercado: compra.supermercado,
                total: compra.total,
                categoria: compra.categoria,
                ticket_imagen_uri: compra.ticketImagenUri
            }])
            .select()
            .single();

        if (errorCompra) throw errorCompra;

        // 2. Si la compra tiene productos, los insertamos
        if (compra.productos && compra.productos.length > 0) {
            const productosParaInsertar = compra.productos.map(p => ({
                compra_id: nuevaCompra.id,
                codigo: p.codigo,
                nombre: p.nombre,
                descripcion: p.descripcion,
                cantidad: p.cantidad,
                precio: p.precio
            }));

            const { error: errorProductos } = await supabase
                .from('productos')
                .insert(productosParaInsertar);

            if (errorProductos) throw errorProductos;
        }

        res.json({
            success: true,
            message: 'Compra sincronizada correctamente en la nube'
        });

    } catch (error) {
        console.error('Error al sincronizar compra:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST: Chat con IA (Gemini).
 * Recibe un mensaje del usuario y devuelve la respuesta de la IA.
 * Endpoint: /api/v1/chat
 */
app.post('/api/v1/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

        const { data: compras } = await supabase
            .from('compras')
            .select('*')
            .order('fecha', { ascending: false })
            .limit(10);

        let contextData = "El usuario no tiene compras registradas.";
        if (compras && compras.length > 0) {
            contextData = compras.map(c => `- ${c.fecha}: ${c.supermercado} ($${c.total})`).join('\n');
        }

        const prompt = `
            Eres un asistente experto en ahorro y finanzas personales para la app 'SuperAhorro'.
            Aquí están los datos de las últimas compras sincronizadas del usuario:
            ${contextData}

            Responde de forma breve, amigable y útil a la siguiente consulta: ${message}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ response: text });

    } catch (error) {
        console.error('Error detallado en Chat IA:', error);
        res.status(500).json({
            error: 'Error al procesar la consulta con la IA',
            details: error.message
        });
    }
});

/**
 * POST: Verificar Gasto Seguro (Algoritmo del Banquero).
 * Endpoint: /api/v1/budget/check
 */
app.post('/api/v1/budget/check', async (req, res) => {
    try {
        const { categoria, monto_solicitado, presupuesto_total } = req.body;

        const { data: presupuestos } = await supabase.from('presupuestos').select('*');
        const { data: gastos } = await supabase
            .from('compras')
            .select('categoria, total')
            .gte('fecha', new Date().toISOString().substring(0, 7) + '-01');

        const allocation = {};
        presupuestos.forEach(p => allocation[p.categoria] = 0);
        gastos.forEach(g => {
            if (allocation[g.categoria] !== undefined) {
                allocation[g.categoria] += parseFloat(g.total);
            }
        });

        const categorias = presupuestos.map(p => p.categoria);
        const max = presupuestos.map(p => parseFloat(p.monto_maximo));
        const currentAllocation = categorias.map(c => allocation[c]);
        const totalResources = presupuesto_total || presupuestos.reduce((acc, p) => acc + parseFloat(p.monto_maximo), 0);
        const totalSpent = currentAllocation.reduce((acc, val) => acc + val, 0);
        let available = totalResources - totalSpent;

        const idx = categorias.indexOf(categoria);
        if (idx === -1) return res.status(400).json({ error: 'Categoría no válida' });

        if (monto_solicitado > available) {
            return res.json({
                safe: false,
                message: `Inseguro: El gasto de $${monto_solicitado} supera tu saldo disponible actual de $${available.toFixed(2)}.`
            });
        }

        available -= monto_solicitado;
        const simAllocation = [...currentAllocation];
        simAllocation[idx] += monto_solicitado;

        const need = max.map((m, i) => m - simAllocation[i]);
        const finish = new Array(categorias.length).fill(false);
        let work = available;

        let possible = true;
        while (possible) {
            possible = false;
            for (let i = 0; i < categorias.length; i++) {
                if (!finish[i] && need[i] <= work) {
                    work += simAllocation[i];
                    finish[i] = true;
                    possible = true;
                }
            }
        }

        const isSafe = finish.every(f => f === true);
        res.json({
            safe: isSafe,
            message: isSafe
                ? 'Estado Seguro: Tienes margen suficiente para cubrir tus otros presupuestos máximos.'
                : 'Estado Inseguro: Realizar este gasto podría impedirte cumplir con el presupuesto máximo de otras categorías esenciales.'
        });

    } catch (error) {
        console.error('Error en Algoritmo del Banquero:', error.message);
        res.status(500).json({ error: 'Error al ejecutar el simulador de presupuesto' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
