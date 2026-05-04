/**
 * APP POS Rápido - Lógica Frontend (Versión Endurecida)
 * Utiliza localStorage estructurado de manera segura y gestiona reconciliación de stock.
 */

// ==========================================
// ESTADO GLOBAL Y CONFIGURACIÓN
// ==========================================
const STORE_KEY = 'pos_kiosco_data';

const state = {
    config: {
        apiUrl: "https://script.google.com/macros/s/AKfycbyPUQ8Td1lY9-l8xG4EPY3bOyy43_4EGCvxuN13S_l5_3-NBrZSqenqYexaCTZKym76/exec",
        sucursalId: "SUC-01",
        usuarioId: "USR-01"
    },
    productos: [], // Catálogo base sincronizado
    categorias: [],
    mediosPago: [],
    carrito: [],
    ventasPendientes: [],
    movimientosCajaPendientes: [],
    historialLocal: [], // Historial de ventas locales
    historialCajaLocal: [], // Historial de caja local
    isSyncing: false,
    categoriaSeleccionada: 'all',
    busquedaActual: ''
};

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadLocalStore();
    setupEventListeners();
    applyConfigToUI();

    if (state.productos.length === 0) {
        if (state.config.apiUrl) fetchMasterData();
        else showToast("Configura la URL de la API en la pestaña Configuración", "warning");
    } else {
        reconciliarStock(); // Asegura que el stock en RAM refleje las ventas pendientes
        renderCategorias();
        renderProductos();
        renderBotonesPago();
        updateCartUI();
        syncBatch(); // Intentar sincronizar si hay conexión
    }
});

// ==========================================
// PERSISTENCIA LOCAL (LocalStorage Organizado)
// ==========================================
function loadLocalStore() {
    try {
        const data = JSON.parse(localStorage.getItem(STORE_KEY));
        if (data) {
            state.config = data.config || state.config;
            state.productos = data.productos || [];
            state.categorias = data.categorias || [];
            state.mediosPago = data.mediosPago || [];
            state.ventasPendientes = data.ventasPendientes || [];
            state.movimientosCajaPendientes = data.movimientosCajaPendientes || [];
            state.historialLocal = data.historialLocal || [];
            state.historialCajaLocal = data.historialCajaLocal || [];
        }
    } catch (e) {
        console.error("Error leyendo LocalStorage, iniciando limpio.", e);
    }
}

function saveLocalStore() {
    try {
        // Evitar guardar el carrito, la sync flag, etc.
        const dataToSave = {
            config: state.config,
            productos: state.productos,
            categorias: state.categorias,
            mediosPago: state.mediosPago,
            ventasPendientes: state.ventasPendientes,
            movimientosCajaPendientes: state.movimientosCajaPendientes,
            historialLocal: state.historialLocal,
            historialCajaLocal: state.historialCajaLocal
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
        console.error("Error escribiendo en LocalStorage (¿Cuota excedida?)", e);
        showToast("Error crítico guardando datos locales", "error");
    }
}

// ==========================================
// LÓGICA DE NEGOCIO - RECONCILIACIÓN DE STOCK
// ==========================================
/**
 * Calcula el stock real disponible restando las ventas pendientes 
 * al catálogo puro bajado del servidor.
 */
function reconciliarStock() {
    // 1. Restaurar stock a la base pura descargada (esto ocurre automáticamente si acabamos de hacer fetch)
    // Pero si estamos en tiempo de ejecución, la variable state.productos es nuestra base.
    // OJO: Para no perder el stock original bajado, las ventas siempre descuentan EN TIEMPO DE RENDERIZADO o mediante una propiedad virtual.

    // Mejor estrategia: `state.productos` tiene el stock DE LA NUBE.
    // Creamos una propiedad dinámica calculada `stockDisponible` en tiempo real.
}

function getStockDisponible(idProducto) {
    const prod = state.productos.find(p => p.IDProducto === idProducto);
    if (!prod) return 0;

    let descontadoPendientes = 0;
    state.ventasPendientes.forEach(v => {
        v.items.forEach(item => {
            if (item.IDProducto === idProducto) descontadoPendientes += item.Cantidad;
        });
    });

    let descontadoCarrito = 0;
    state.carrito.forEach(item => {
        if (item.IDProducto === idProducto) descontadoCarrito += item.Cantidad;
    });

    return Number(prod.StockActual) - descontadoPendientes - descontadoCarrito;
}

function getStockVirtualSinCarrito(idProducto) {
    const prod = state.productos.find(p => p.IDProducto === idProducto);
    if (!prod) return 0;

    let descontadoPendientes = 0;
    state.ventasPendientes.forEach(v => {
        v.items.forEach(item => {
            if (item.IDProducto === idProducto) descontadoPendientes += item.Cantidad;
        });
    });

    return Number(prod.StockActual) - descontadoPendientes;
}

// ==========================================
// COMUNICACIÓN CON BACKEND
// ==========================================
async function fetchMasterData() {
    if (!state.config.apiUrl) return;

    setSyncStatus('syncing', 'Descargando catálogo...');
    try {
        const response = await fetch(`${state.config.apiUrl}?action=catalogo`);
        if (!response.ok) throw new Error("Error HTTP " + response.status);
        const json = await response.json();

        if (json.success && json.data) {
            state.productos = json.data.productos || [];
            state.categorias = json.data.categorias || [];
            state.mediosPago = json.data.mediosPago || [];
            saveLocalStore();
            renderCategorias();
            renderProductos();
            renderBotonesPago();
            setSyncStatus('online', 'Catálogo actualizado');
            showToast("Catálogo actualizado exitosamente", "success");
        } else {
            throw new Error(json.error);
        }
    } catch (error) {
        console.error("Error fetchMasterData:", error);
        setSyncStatus('error', 'Modo Offline (Catálogo local)');
        showToast("Fallo al descargar catálogo. Usando datos cacheados.", "warning");
    }
}






async function syncBatch() {
    if (state.isSyncing || !state.config.apiUrl) return;

    const tieneVentas = state.ventasPendientes.length > 0;
    const tieneCaja = state.movimientosCajaPendientes.length > 0;

    if (!tieneVentas && !tieneCaja) {
        setSyncStatus('online', 'Sincronizado');
        return;
    }

    state.isSyncing = true;
    setSyncStatus('syncing', 'Sincronizando...');

    const payload = {
        action: 'syncBatch',
        data: {
            ventas: [...state.ventasPendientes],
            caja: [...state.movimientosCajaPendientes]
        }
    };

    try {
        const response = await fetch(state.config.apiUrl, {
            method: 'POST',
            mode: 'cors',
            redirect: 'follow',
            headers: {
                // 🔴 CLAVE: evita preflight que Apps Script rompe
                'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();

        // 🔴 Apps Script a veces devuelve HTML si algo falla
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error("Respuesta no JSON del backend");
        }

        if (json.success) {
            const procesadasVentas = json.data?.ventasProcesadas || [];
            const procesadasCaja = json.data?.cajaProcesada || [];

            // remover pendientes
            state.ventasPendientes = state.ventasPendientes.filter(
                v => !procesadasVentas.includes(v.IDVenta)
            );

            state.movimientosCajaPendientes = state.movimientosCajaPendientes.filter(
                c => !procesadasCaja.includes(c.IDMovimientoCaja)
            );

            // actualizar estados UI
            state.historialLocal.forEach(v => {
                if (procesadasVentas.includes(v.IDVenta)) {
                    v.estadoSync = 'SINCRONIZADA';
                }
            });

            state.historialCajaLocal.forEach(c => {
                if (procesadasCaja.includes(c.IDMovimientoCaja)) {
                    c.estadoSync = 'SINCRONIZADA';
                }
            });

            saveLocalStore();
            setSyncStatus('online', 'Sincronizado');

            if (!document.getElementById('seccion-historial').classList.contains('hidden')) {
                renderHistorial();
            }

            if (!document.getElementById('seccion-caja').classList.contains('hidden')) {
                renderCaja();
            }

        } else {
            throw new Error(json.error || "Error desconocido backend");
        }

    } catch (error) {
        console.error("Error syncBatch:", error);
        setSyncStatus('error', 'Pendientes de envío');
    } finally {
        state.isSyncing = false;
    }
}












// ==========================================
// EVENT LISTENERS GENERALES
// ==========================================
function setupEventListeners() {
    // Navegación
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.seccion').forEach(s => s.classList.add('hidden'));

            const target = e.target.getAttribute('data-target');
            e.target.classList.add('active');
            document.getElementById(target).classList.remove('hidden');

            if (target === 'seccion-venta') {
                document.getElementById('input-buscar-producto').focus();
                renderProductos(); // Re-render para actualizar stock visual
            }
            if (target === 'seccion-historial') renderHistorial();
            if (target === 'seccion-caja') renderCaja();
            if (target === 'seccion-stock') renderTablaStock();
        });
    });

    const inputBuscar = document.getElementById('input-buscar-producto');
    inputBuscar.addEventListener('input', (e) => {
        state.busquedaActual = e.target.value.toLowerCase();
        renderProductos();
    });
    inputBuscar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const visibles = document.querySelectorAll('.producto-card:not(.disabled)');
            if (visibles.length === 1) {
                const idProd = visibles[0].getAttribute('data-id');
                const producto = state.productos.find(p => p.IDProducto === idProd);
                if (producto) addToCart(producto);
                inputBuscar.value = '';
                state.busquedaActual = '';
                renderProductos();
            }
        }
    });

    // Búsqueda Stock
    document.getElementById('input-buscar-stock').addEventListener('input', (e) => {
        renderTablaStock(e.target.value.toLowerCase());
    });

    // Botones de Acción
    document.getElementById('btn-cancelar-venta').addEventListener('click', clearCart);
    document.getElementById('btn-force-sync').addEventListener('click', () => { fetchMasterData(); syncBatch(); });
    document.getElementById('btn-refresh-catalog').addEventListener('click', fetchMasterData);
    document.getElementById('btn-refresh-historial').addEventListener('click', renderHistorial);

    // Caja Manual
    document.getElementById('btn-caja-ingreso').addEventListener('click', () => registrarMovimientoCaja('INGRESO'));
    document.getElementById('btn-caja-egreso').addEventListener('click', () => registrarMovimientoCaja('EGRESO'));

    // Configuración
    document.getElementById('btn-guardar-config').addEventListener('click', () => {
        state.config.sucursalId = document.getElementById('config-sucursal').value.trim();
        state.config.usuarioId = document.getElementById('config-usuario').value.trim();
        state.config.apiUrl = document.getElementById('config-api-url').value.trim();
        saveLocalStore();
        showToast("Configuración guardada", "success");
    });
}

function applyConfigToUI() {
    document.getElementById('config-sucursal').value = state.config.sucursalId;
    document.getElementById('config-usuario').value = state.config.usuarioId;
    document.getElementById('config-api-url').value = state.config.apiUrl;
}

// ==========================================
// RENDERIZADO VENTA RÁPIDA
// ==========================================
function renderCategorias() {
    const container = document.getElementById('categorias-chips');
    if (!container) return;

    container.innerHTML = '';

    // Botón "Todas"
    const btnAll = document.createElement('button');
    btnAll.className = `chip ${state.categoriaSeleccionada === 'all' ? 'active' : ''}`;
    btnAll.textContent = 'Todas';
    btnAll.onclick = () => setCategoria('all');
    container.appendChild(btnAll);

    if (!state.categorias || !Array.isArray(state.categorias)) return;

    state.categorias.forEach(cat => {
        if (!cat) return;

        const activa = String(cat.Activa || '').toUpperCase();
        if (activa === "FALSE") return;

        const id = cat.IDCategoria || cat.ID || '';
        const nombre = cat.NombreCategoria || cat.Categoria || '';

        if (!nombre) return;

        const btn = document.createElement('button');
        btn.className = `chip ${state.categoriaSeleccionada == id ? 'active' : ''}`;
        btn.textContent = nombre;
        btn.onclick = () => setCategoria(id);
        container.appendChild(btn);
    });
}

function setCategoria(id) {
    state.categoriaSeleccionada = id;
    renderCategorias(); // Para actualizar clase active
    renderProductos();
}

function renderProductos() {
    const grid = document.getElementById('productos-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const filtrados = state.productos.filter(p => {
        if (!p) return false;

        // Filtro de Activo
        if (p.Activo === false || String(p.Activo).toUpperCase() === "FALSE") return false;

        // Filtro de Categoría
        const matchCat = state.categoriaSeleccionada === 'all' ||
            p.IDCategoria == state.categoriaSeleccionada ||
            p.ID == state.categoriaSeleccionada;

        // Filtro de Búsqueda
        const nombre = (p.NombreProducto || p.Producto || "").toString().toLowerCase();
        const codigo = (p.CodigoBarra || p.CodigoBarras || "").toString();
        const matchSearch = nombre.includes(state.busquedaActual) || codigo.includes(state.busquedaActual);

        return matchCat && matchSearch;
    });

    filtrados.forEach(p => {
        const id = p.IDProducto || p.ID || '';
        const nombre = (p.NombreProducto || p.Producto || '').toString();
        const precio = Number(p.PrecioVenta || p.Precio || 0) || 0;

        const stockFinal = getStockVirtualSinCarrito(id);

        const div = document.createElement('div');
        div.className = 'producto-card';
        div.setAttribute('data-id', id);

        let stockClass = 'stock-ok';
        if (stockFinal <= 0) {
            stockClass = 'stock-critico';
            div.classList.add('disabled');
        } else if (stockFinal <= Number(p.StockMinimo || 0)) {
            stockClass = 'stock-bajo';
        }

        div.innerHTML = `
            <div class="nombre">${nombre || 'Sin nombre'}</div>
            <div class="precio">$${precio.toFixed(2)}</div>
            <div class="stock-badge ${stockClass}">Stock: ${stockFinal}</div>
        `;

        div.onclick = () => {
            if (stockFinal > 0) addToCart(p);
            else showToast("Sin stock disponible", "error");
        };

        grid.appendChild(div);
    });
}

function renderBotonesPago() {
    const container = document.getElementById('botones-pago');
    if (!container) return;

    container.innerHTML = '';

    if (!state.mediosPago || !Array.isArray(state.mediosPago)) return;

    state.mediosPago.forEach(mp => {
        if (!mp) return;

        const activa = String(mp.Activo || '').toUpperCase();
        if (activa === "FALSE") return;

        const id = mp.IDMedioPago || mp.ID || '';
        const nombre = mp.NombreMedioPago || mp.MedioPago || '';

        if (!nombre) return;

        const btn = document.createElement('button');
        btn.className = 'btn-pago';

        btn.textContent = nombre;

        btn.onclick = () => finalizeSale(id, nombre);

        container.appendChild(btn);
    });
}

// ==========================================
// LÓGICA CARRITO
// ==========================================
function addToCart(producto) {
    const stockDisp = getStockDisponible(producto.IDProducto);
    if (stockDisp <= 0) {
        showToast("No hay stock suficiente", "error");
        return;
    }

    const itemExistente = state.carrito.find(item => item.IDProducto === producto.IDProducto);

    if (itemExistente) {
        itemExistente.Cantidad += 1;
        itemExistente.Subtotal = itemExistente.Cantidad * itemExistente.PrecioUnitario;
    } else {
        state.carrito.push({
            IDProducto: producto.IDProducto,
            NombreProducto: producto.NombreProducto || producto.Producto || '',
            Cantidad: 1,
            PrecioUnitario: Number(producto.PrecioVenta || producto.Precio || 0) || 0,
            Subtotal: Number(producto.PrecioVenta || producto.Precio || 0) || 0,
            Costo: Number(producto.Costo || 0) || 0
        });
    }
    updateCartUI();
    renderProductos(); // Refresca visualmente el stock
}

function updateCartItemQty(idProducto, delta) {
    const item = state.carrito.find(i => i.IDProducto === idProducto);
    if (!item) return;

    if (delta > 0) {
        const stockDisp = getStockDisponible(idProducto);
        if (stockDisp <= 0) {
            showToast("No hay más stock", "warning");
            return;
        }
    }

    item.Cantidad += delta;
    if (item.Cantidad <= 0) {
        removeCartItem(idProducto);
        return;
    }
    item.Subtotal = item.Cantidad * item.PrecioUnitario;
    updateCartUI();
    renderProductos();
}

function removeCartItem(idProducto) {
    state.carrito = state.carrito.filter(i => i.IDProducto !== idProducto);
    updateCartUI();
    renderProductos();
}

function clearCart() {
    state.carrito = [];
    updateCartUI();
    renderProductos();
    document.getElementById('input-buscar-producto').focus();
}

function updateCartUI() {
    const container = document.getElementById('carrito-items');
    container.innerHTML = '';

    let total = 0;

    state.carrito.forEach(item => {
        total += item.Subtotal;

        // Deshabilitar botón + si ya no hay stock para sumar
        const stockDisp = getStockDisponible(item.IDProducto);
        const disabledPlus = stockDisp <= 0 ? 'disabled' : '';

        const div = document.createElement('div');
        div.className = 'cart-item';
        div.innerHTML = `
            <div class="cart-item-info">
                <div class="nombre">${item.NombreProducto || 'Sin nombre'}</div>
                <div class="precio-unit">$${item.PrecioUnitario.toFixed(2)} c/u</div>
            </div>
            <div class="cart-item-actions">
                <button class="btn-qty" onclick="updateCartItemQty('${item.IDProducto}', -1)">-</button>
                <span>${item.Cantidad}</span>
                <button class="btn-qty" onclick="updateCartItemQty('${item.IDProducto}', 1)" ${disabledPlus}>+</button>
                <button class="btn-remove" onclick="removeCartItem('${item.IDProducto}')">✕</button>
            </div>
        `;
        container.appendChild(div);
    });

    document.getElementById('carrito-subtotal').textContent = `$${total.toFixed(2)}`;
    document.getElementById('carrito-total').textContent = `$${total.toFixed(2)}`;
}

// ==========================================
// REGISTRO DE VENTA
// ==========================================
function finalizeSale(medioPagoId, medioPagoNombre) {
    if (state.carrito.length === 0) {
        showToast("El carrito está vacío", "warning");
        return;
    }

    const total = state.carrito.reduce((sum, item) => sum + item.Subtotal, 0);
    const idVenta = 'V-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const fechaHora = new Date().toISOString();

    const salePayload = {
        IDVenta: idVenta,
        FechaHora: fechaHora,
        IDSucursal: state.config.sucursalId,
        IDUsuario: state.config.usuarioId,
        IDCliente: "",
        TotalBruto: total,
        Descuento: 0,
        TotalFinal: total,
        IDMedioPago: medioPagoId,
        NombreMedioPago: medioPagoNombre, // Usado solo en frontend
        Observaciones: "",
        estadoSync: 'PENDIENTE',
        items: [...state.carrito]
    };

    // 1. Guardar en pendientes
    state.ventasPendientes.push(salePayload);

    // 2. Guardar en historial
    state.historialLocal.unshift(salePayload);
    if (state.historialLocal.length > 50) state.historialLocal.pop();

    saveLocalStore();

    // 3. Limpiar y avisar
    clearCart(); // Esto también re-renderiza catálogo y muestra el nuevo stock
    showToast(`Venta Registrada ($${total.toFixed(2)})`, "success");

    // 4. Sincronizar
    syncBatch();
}

// ==========================================
// REGISTRO CAJA MANUAL
// ==========================================
function registrarMovimientoCaja(tipo) {
    const inputMonto = document.getElementById('input-caja-monto');
    const inputMotivo = document.getElementById('input-caja-motivo');

    const monto = parseFloat(inputMonto.value);
    const motivo = inputMotivo.value.trim();

    // 🔥 CALCULAR SALDO ACTUAL
    const saldoActual = state.historialCajaLocal.reduce((acc, mov) => {
        return acc + Number(mov.Monto || 0);
    }, 0);

    // 🔥 BLOQUEO
    if (tipo === 'EGRESO' && saldoActual < monto) {
        showToast("No hay saldo suficiente en caja", "error");
        return;
    }

    if (isNaN(monto) || monto <= 0) {
        showToast("Ingrese un monto válido mayor a 0", "error");
        return;
    }
    if (!motivo) {
        showToast("Debe ingresar un motivo", "error");
        return;
    }

    const idMovimiento = 'CAJ-MAN-' + Date.now();
    const payload = {
        IDMovimientoCaja: idMovimiento,
        FechaHora: new Date().toISOString(),
        TipoMovimiento: tipo,
        Origen: 'MANUAL',
        Referencia: '',
        Monto: tipo === 'EGRESO' ? -Math.abs(monto) : Math.abs(monto),
        IDMedioPago: 'EFECTIVO', // Asumimos efectivo para manuales por defecto
        IDUsuario: state.config.usuarioId,
        IDSucursal: state.config.sucursalId,
        Observaciones: motivo,
        estadoSync: 'PENDIENTE'
    };

    state.movimientosCajaPendientes.push(payload);
    state.historialCajaLocal.unshift(payload);
    if (state.historialCajaLocal.length > 50) state.historialCajaLocal.pop();

    saveLocalStore();

    inputMonto.value = '';
    inputMotivo.value = '';
    showToast(`${tipo} registrado con éxito`, "success");

    renderCaja();
    syncBatch();
}

// ==========================================
// RENDERIZADO OTRAS SECCIONES
// ==========================================
function renderTablaStock(searchTerm = '') {
    const tbody = document.getElementById('tabla-stock-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!state.productos || !Array.isArray(state.productos)) return;

    const filtrados = state.productos.filter(p => {
        if (!p) return false;

        const nombre = (p.NombreProducto || p.Producto || '').toString().toLowerCase();
        const codigo = (p.CodigoBarra || p.CodigoBarras || '').toString().toLowerCase();

        return nombre.includes(searchTerm) || codigo.includes(searchTerm);
    });

    filtrados.forEach(p => {
        const nombre = p.NombreProducto || p.Producto || '';
        const codigo = p.CodigoBarra || p.CodigoBarras || p.IDProducto || '';
        const precio = Number(p.PrecioVenta || p.Precio || 0) || 0;
        const stock = Number(p.StockActual || p.Stock || 0) || 0;

        const cat = state.categorias?.find(c => (c.IDCategoria || c.ID) == p.IDCategoria);
        const catNombre = cat?.NombreCategoria || cat?.Categoria || '';

        tbody.innerHTML += `
            <tr>
                <td>${codigo}</td>
                <td>${nombre}</td>
                <td>${catNombre}</td>
                <td>$${precio.toFixed(2)}</td>
                <td>
                    <strong>${stock}</strong>
                    <button onclick="ingresarStock('${p.IDProducto}', 1)">+1</button>
                </td>
                <td>${stock > 0 ? 'OK' : 'SIN STOCK'}</td>
            </tr>
        `;
    });
}

function renderHistorial() {
    const tbody = document.getElementById('tabla-historial-body');
    tbody.innerHTML = '';

    state.historialLocal.forEach(v => {
        const isPendiente = state.ventasPendientes.some(p => p.IDVenta === v.IDVenta);
        const fecha = new Date(v.FechaHora).toLocaleString();

        const badgeClass = isPendiente ? 'sync-pending' : 'sync-ok';
        const badgeText = isPendiente ? '⏳ PENDIENTE' : '✅ NUBE';

        tbody.innerHTML += `
            <tr>
                <td>${v.IDVenta.substring(0, 10)}...</td>
                <td>${fecha}</td>
                <td>${v.items.reduce((s, i) => s + i.Cantidad, 0)} items</td>
                <td><strong>$${parseFloat(v.TotalFinal).toFixed(2)}</strong></td>
                <td>${v.NombreMedioPago || v.IDMedioPago}</td>
                <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
            </tr>
        `;
    });
}

function renderCaja() {

    const saldo = calcularSaldoCaja();
    document.getElementById('caja-saldo').textContent = '$' + saldo.toFixed(2);

    const tbody = document.getElementById('tabla-caja-body');
    tbody.innerHTML = '';

    const hoy = new Date().toDateString();

    const lista = soloHoy
        ? state.historialCajaLocal.filter(c =>
            new Date(c.FechaHora).toDateString() === hoy
        )
        : state.historialCajaLocal;

    lista.forEach(c => {

        const fecha = new Date(c.FechaHora).toLocaleString();
        const monto = parseFloat(c.Monto || 0);

        const estado = c.estadoSync === 'PENDIENTE'
            ? '⏳ PENDIENTE'
            : '✅ NUBE';

        const montoFormateado = (monto < 0 ? '-' : '') + '$' + Math.abs(monto).toFixed(2);

        tbody.innerHTML += `
            <tr>
                <td>${fecha}</td>
                <td>${c.TipoMovimiento}</td>
                <td>${c.Observaciones || '-'}</td>
                <td onclick="editarMontoCaja('${c.IDMovimientoCaja}')"
                    style="cursor:pointer; color:${monto < 0 ? 'red' : 'green'}">
                    ${montoFormateado}
                </td>
                <td>${estado}</td>
                <td>
                    <button onclick="borrarMovimientoCaja('${c.IDMovimientoCaja}')">❌</button>
                </td>
            </tr>
        `;
    });
}

// ==========================================
// UTILS UI
// ==========================================
function setSyncStatus(status, text) {
    const dot = document.getElementById('sync-status-indicator');
    const label = document.getElementById('sync-status-text');
    dot.className = 'status-dot';

    if (status === 'online') dot.classList.add('green');
    if (status === 'syncing') dot.classList.add('yellow');
    if (status === 'error') dot.classList.add('red');

    label.textContent = text;
}

function showToast(message, type = "success") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}





function ingresarStock(idProducto, cantidad) {
    const prod = state.productos.find(p => p.IDProducto === idProducto);
    if (!prod) return;

    const actual = Number(prod.StockActual || 0);
    prod.StockActual = actual + Number(cantidad);

    // 🔥 REGISTRO DE COMPRA
    const movimiento = {
        IDMovimiento: 'COMP-' + Date.now(),
        FechaHora: new Date().toISOString(),
        IDProducto: idProducto,
        Cantidad: cantidad,
        Tipo: 'INGRESO',
        Usuario: state.config.usuarioId
    };

    if (!state.movimientosStock) state.movimientosStock = [];
    state.movimientosStock.unshift(movimiento);

    saveLocalStore();
    renderProductos();
    renderTablaStock();
}

// NO TOCAR
async function borrarMovimientoCaja(id) {

    if (!confirm("¿Seguro que querés borrar este movimiento?")) return;

    try {
        const res = await fetch(state.config.apiUrl, {
            method: "POST",
            body: JSON.stringify({
                action: "deleteCaja",
                id: id
            })
        });

        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        state.historialCajaLocal = state.historialCajaLocal.filter(c => c.IDMovimientoCaja !== id);

        saveLocalStore();
        renderCaja();

    } catch (err) {
        console.error("Error borrando:", err);
        showToast("Error al borrar", "error");
    }
}


function calcularSaldoCaja() {
    return state.historialCajaLocal.reduce((acc, mov) => {
        return acc + Number(mov.Monto || 0);
    }, 0);
}






async function editarMontoCaja(id) {

    const nuevoMonto = prompt("Nuevo monto:");

    if (!nuevoMonto) return;

    const montoNum = Number(nuevoMonto);
    if (isNaN(montoNum)) {
        showToast("Monto inválido", "error");
        return;
    }

    const mov = state.historialCajaLocal.find(c => c.IDMovimientoCaja === id);
    if (!mov) return;

    mov.Monto = mov.TipoMovimiento === 'EGRESO'
        ? -Math.abs(montoNum)
        : Math.abs(montoNum);

    saveLocalStore();
    renderCaja();
}





let soloHoy = false;

function toggleFiltroHoy() {
    soloHoy = !soloHoy;
    renderCaja();
}




