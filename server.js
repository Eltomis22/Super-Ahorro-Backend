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

// Logger de Peticiones (Para ver actividad en Render)
app.use((req, res, next) => {
    const ahora = new Date().toLocaleString();
    console.log(`[${ahora}] ${req.method} ${req.url}`);
    next();
});

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
    console.error("ERROR: GEMINI_API_KEY no encontrada.");
} else {
    console.log("GEMINI_API_KEY detectada.");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Función resiliente para intentar varios modelos (Fallback).
 * Soluciona errores 404 de modelos retirados o inaccesibles.
 */
async function askGemini(prompt) {
    const modelosParaProbar = [
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
            if (e.message.includes("403")) break;
        }
    }
    throw new Error(`Google sigue rechazando la conexión (404/403). Detalles: ${ultimoError?.message}`);
}

// --- ENDPOINTS ---

app.get('/', (req, res) => {
    res.json({ message: 'Backend de SuperAhorro funcionando 🚀' });
});

// GET /supermercados
app.get('/api/v1/supermercados', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('supermercados')
            .select('nombre')
            .order('nombre', { ascending: true });

        if (error) throw error;
        res.json(data.map(s => s.nombre));
    } catch (error) {
        console.error('Error al obtener supermercados:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /presupuestos
app.get('/api/v1/presupuestos', async (req, res) => {
    try {
        const { email } = req.query;
        const { data, error } = await supabase
            .from('presupuestos')
            .select('categoria, monto_maximo')
            .eq('usuario_email', email);

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /presupuestos
app.post('/api/v1/presupuestos', async (req, res) => {
    try {
        const { email, presupuestos } = req.body;
        const rows = presupuestos.map(p => ({
            usuario_email: email,
            categoria: p.categoria,
            monto_maximo: p.monto_maximo
        }));

        const { error } = await supabase
            .from('presupuestos')
            .upsert(rows, { onConflict: 'usuario_email,categoria' });

        if (error) throw error;
        res.json({ success: true, message: 'Presupuestos actualizados' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /usuarios/registrar
app.post('/api/v1/usuarios/registrar', async (req, res) => {
    try {
        const { nombre, email, clave } = req.body;
        const { error } = await supabase
            .from('usuarios_cloud')
            .insert([{ nombre, email, clave }]);

        if (error) throw error;
        res.json({ success: true, message: 'Usuario registrado en la nube' });
    } catch (error) {
        console.error('Error al registrar usuario:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /usuarios/login
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

// POST /compras
app.post('/api/v1/compras', async (req, res) => {
    try {
        const compra = req.body;

        const { data: existente } = await supabase
            .from('supermercados')
            .select('nombre')
            .ilike('nombre', compra.supermercado)
            .maybeSingle();

        if (!existente && compra.supermercado) {
            await supabase.from('supermercados').insert([{ nombre: compra.supermercado }]);
        }

        const { data: nuevaCompra, error: errorCompra } = await supabase
            .from('compras')
            .upsert([{
                id_local: compra.id_local || compra.id,
                usuario_email: compra.usuarioEmail || compra.usuario_email,
                fecha: compra.fecha,
                hora: compra.hora,
                supermercado: compra.supermercado,
                total: compra.total,
                categoria: compra.categoria,
                ticket_imagen_uri: compra.ticketImagenUri || compra.ticket_imagen_uri
            }], { onConflict: 'usuario_email,id_local' })
            .select()
            .single();

        if (errorCompra) throw errorCompra;

        // 3. Sincronizar productos: Borramos los viejos de esta compra y metemos los nuevos
        if (compra.productos && compra.productos.length >= 0) {
            await supabase.from('productos').delete().eq('compra_id', nuevaCompra.id);

            if (compra.productos.length > 0) {
                const productosParaInsertar = compra.productos.map(p => ({
                    compra_id: nuevaCompra.id,
                    codigo: p.codigo,
                    nombre: p.nombre,
                    descripcion: p.descripcion,
                    cantidad: p.cantidad,
                    precio: p.precio
                }));
                const { error: errorProductos } = await supabase.from('productos').insert(productosParaInsertar);
                if (errorProductos) throw errorProductos;
            }
        }

        res.json({ success: true, message: 'Compra sincronizada' });
    } catch (error) {
        console.error('Error al sincronizar compra:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET: Obtiene todas las compras de un usuario con sus productos (para restauración).
 * Endpoint: /api/v1/compras?email=...
 */
app.get('/api/v1/compras', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'Email requerido' });

        // 1. Traemos las compras del usuario
        const { data: compras, error: errorCompras } = await supabase
            .from('compras')
            .select('*')
            .eq('usuario_email', email)
            .order('fecha', { ascending: false });

        if (errorCompras) throw errorCompras;

        if (compras.length === 0) return res.json([]);

        // 2. Traemos todos los productos vinculados a esas compras
        const idsCompras = compras.map(c => c.id);
        const { data: productos, error: errorProductos } = await supabase
            .from('productos')
            .select('*')
            .in('compra_id', idsCompras);

        if (errorProductos) throw errorProductos;

        // 3. Unimos los productos dentro de cada compra
        const comprasCompletas = compras.map(c => ({
            ...c,
            productos: productos.filter(p => p.compra_id === c.id)
        }));

        res.json(comprasCompletas);
    } catch (error) {
        console.error('Error al obtener compras completas:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /compras/:id_local
app.delete('/api/v1/compras/:id_local', async (req, res) => {
    try {
        const { id_local } = req.params;
        const { error } = await supabase.from('compras').delete().eq('id_local', id_local);
        if (error) throw error;
        res.json({ success: true, message: 'Compra eliminada' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /chat
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
            Responde de forma breve y amigable: ${message}
        `;

        const text = await askGemini(prompt);
        res.json({ response: text });
    } catch (error) {
        res.status(500).json({ error: 'Error en IA', details: error.message });
    }
});

// POST /budget/check
app.post('/api/v1/budget/check', async (req, res) => {
    try {
        const { categoria, monto_solicitado, presupuesto_total, usuario_email } = req.body;

        const { data: presupuestos } = await supabase
            .from('presupuestos')
            .select('*')
            .eq('usuario_email', usuario_email);

        const categoriasBase = ['Comida', 'Servicios', 'Ocio', 'Otros'];
        const presupuestosFinales = presupuestos.length > 0
            ? presupuestos
            : categoriasBase.map(c => ({ categoria: c, monto_maximo: 10000 }));

        const { data: gastos } = await supabase
            .from('compras')
            .select('categoria, total')
            .eq('usuario_email', usuario_email)
            .gte('fecha', new Date().toISOString().substring(0, 7) + '-01');

        const allocation = {};
        presupuestosFinales.forEach(p => allocation[p.categoria] = 0);
        gastos.forEach(g => {
            if (allocation[g.categoria] !== undefined) {
                allocation[g.categoria] += parseFloat(g.total);
            }
        });

        const categorias = presupuestosFinales.map(p => p.categoria);
        const max = presupuestosFinales.map(p => parseFloat(p.monto_maximo));
        const currentAllocation = categorias.map(c => allocation[c]);
        const totalResources = presupuesto_total || max.reduce((acc, val) => acc + val, 0);
        const totalSpent = currentAllocation.reduce((acc, val) => acc + val, 0);
        let available = totalResources - totalSpent;

        const idx = categorias.indexOf(categoria);
        if (idx === -1) return res.status(400).json({ error: 'Categoría no válida' });

        if (monto_solicitado > available) {
            return res.json({ safe: false, message: `Inseguro: Supera tu saldo de $${available.toFixed(2)}.` });
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
            message: isSafe ? 'Estado Seguro' : 'Estado Inseguro'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor encendido en puerto ${PORT}`);
});
