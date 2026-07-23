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
console.log("Verificando GEMINI_API_KEY...");
if (!process.env.GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY no encontrada en las variables de entorno.");
} else {
    console.log("GEMINI_API_KEY detectada (formato AQ. u otro).");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Función resiliente para intentar varios modelos (Fallback).
 * Soluciona errores 404 de modelos retirados o inaccesibles.
 */
async function askGemini(prompt) {
    // Combinaciones de Modelo + Versión para agotar todas las posibilidades de Google
    const configs = [
        { model: "gemini-1.5-flash", version: "v1" },
        { model: "gemini-1.5-flash", version: "v1beta" },
        { model: "gemini-pro", version: "v1" },
        { model: "gemini-1.0-pro", version: "v1" }
    ];

    let ultimoError = null;
    for (const conf of configs) {
        try {
            console.log(`Probando configuración: ${conf.model} en ${conf.version}...`);
            const modelInstance = genAI.getGenerativeModel({ model: conf.model }, { apiVersion: conf.version });
            const result = await modelInstance.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            if (text) {
                console.log(`¡Éxito con ${conf.model} (${conf.version})!`);
                return text;
            }
        } catch (e) {
            console.warn(`Fallo ${conf.model} en ${conf.version}:`, e.message);
            ultimoError = e;
            // Si el error es de permisos (403), no seguimos probando modelos
            if (e.message.includes("403")) break;
        }
    }
    throw new Error(`Google sigue rechazando la conexión (404/403). Detalles: ${ultimoError?.message}`);
}

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
                usuario_email: compra.usuarioEmail, // Vinculamos con el usuario
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
 * GET: Obtiene los presupuestos de un usuario.
 * Endpoint: /api/v1/presupuestos?email=...
 */
app.get(\u0027/api/v1/presupuestos\u0027, async (req, res) \u003d\u003e {\n    try {\n        const { email } \u003d req.query;\n        const { data, error } \u003d await supabase\n            .from(\u0027presupuestos\u0027)\n            .select(\u0027categoria, monto_maximo\u0027)\n            .eq(\u0027usuario_email\u0027, email);\n\n        if (error) throw error;\n        res.json(data);\n    } catch (error) {\n        res.status(500).json({ success: false, message: error.message });\n    }\n});\n\n/**\n * POST: Guarda o actualiza los presupuestos de un usuario.\n * Endpoint: /api/v1/presupuestos\n */\napp.post(\u0027/api/v1/presupuestos\u0027, async (req, res) \u003d\u003e {\n    try {\n        const { email, presupuestos } \u003d req.body; // presupuestos \u003d [{categoria, monto_maximo}, ...]\n        \n        const rows \u003d presupuestos.map(p \u003d\u003e ({\n            usuario_email: email,\n            categoria: p.categoria,\n            monto_maximo: p.monto_maximo\n        }));\n\n        const { error } \u003d await supabase\n            .from(\u0027presupuestos\u0027)\n            .upsert(rows, { onConflict: \u0027usuario_email,categoria\u0027 });\n\n        if (error) throw error;\n        res.json({ success: true, message: \u0027Presupuestos actualizados\u0027 });\n    } catch (error) {\n        res.status(500).json({ success: false, message: error.message });\n    }\n});\n\n/**\n * POST: Registrar usuario en la nube.\n * Endpoint: /api/v1/usuarios/registrar
 */
app.post('/api/v1/usuarios/registrar', async (req, res) => {
    try {
        const { nombre, email, clave } = req.body;
        const { data, error } = await supabase
            .from('usuarios_cloud')
            .insert([{ nombre, email, clave }])
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, message: 'Usuario registrado en la nube' });
    } catch (error) {
        console.error('Error al registrar usuario:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST: Login de usuario en la nube.
 * Endpoint: /api/v1/usuarios/login
 */
app.post('/api/v1/usuarios/login', async (req, res) => {
    try {
        const { email, clave } = req.body;
        const { data, error } = await supabase
            .from('usuarios_cloud')
            .select('*')
            .eq('email', email)
            .eq('clave', clave)
            .single();

        if (error || !data) throw new Error('Credenciales inválidas en la nube');
        res.json({ success: true, user: { nombre: data.nombre, email: data.email } });
    } catch (error) {
        res.status(401).json({ success: false, message: error.message });
    }
});

/**
 * DELETE: Elimina una compra y sus productos asociados.
 * Endpoint: /api/v1/compras/:id_local
 */
app.delete('/api/v1/compras/:id_local', async (req, res) => {
    try {
        const { id_local } = req.params;
        console.log(`Solicitud para eliminar compra local ID: ${id_local}`);

        const { error } = await supabase
            .from('compras')
            .delete()
            .eq('id_local', id_local);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Compra eliminada correctamente de la nube'
        });

    } catch (error) {
        console.error('Error al eliminar compra:', error.message);
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

        const text = await askGemini(prompt);
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
        const { categoria, monto_solicitado, presupuesto_total, usuario_email } = req.body;

        const { data: presupuestos } \u003d await supabase\n            .from(\u0027presupuestos\u0027)\n            .select(\u0027*\u0027)\n            .eq(\u0027usuario_email\u0027, usuario_email);\n\n        // Si el usuario no tiene presupuestos configurados, usamos unos por defecto\n        const categoriasBase \u003d [\u0027Comida\u0027, \u0027Servicios\u0027, \u0027Ocio\u0027, \u0027Otros\u0027];\n        const presupuestosFinales \u003d presupuestos.length \u003e 0 \n            ? presupuestos \n            : categoriasBase.map(c \u003d\u003e ({ categoria: c, monto_maximo: 10000 }));\n\n        const { data: gastos } \u003d await supabase\n            .from(\u0027compras\u0027)\n            .select(\u0027categoria, total\u0027)\n            .eq(\u0027usuario_email\u0027, usuario_email) // Filtramos por usuario\n            .gte(\u0027fecha\u0027, new Date().toISOString().substring(0, 7) + \u0027-01\u0027);\n\n        const allocation \u003d {};\n        presupuestosFinales.forEach(p \u003d\u003e allocation[p.categoria] \u003d 0);\n        gastos.forEach(g \u003d\u003e {\n            if (allocation[g.categoria] !\u003d\u003d undefined) {\n                allocation[g.categoria] +\u003d parseFloat(g.total);\n            }\n        });\n\n        const categorias \u003d presupuestosFinales.map(p \u003d\u003e p.categoria);\n        const max \u003d presupuestosFinales.map(p \u003d\u003e parseFloat(p.monto_maximo));\n        const currentAllocation \u003d categorias.map(c \u003d\u003e allocation[c]);\n        const totalResources \u003d presupuesto_total || max.reduce((acc, val) \u003d\u003e acc + val, 0);\n        const totalSpent = currentAllocation.reduce((acc, val) => acc + val, 0);
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
    console.log(`Servidor de SuperAhorro encendido con éxito.`);
    console.log(`Puerto: ${PORT}`);
    console.log(`Endpoints activos: GET /supermercados, POST /compras, DELETE /compras/:id, POST /chat, POST /budget/check`);
});
