const API_URL = 'https://united-republic-api.onrender.com';
const WS_URL = 'wss://united-republic-api.onrender.com/ws';

const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '../index.html';
}

// ── WebSocket: notificaciones en tiempo real ────────────────────────────────

const _wsCorreo = (() => {
  try { return JSON.parse(atob(token.split('.')[1])).sub; } catch { return null; }
})();

let _ws = null;
let _wsReconnectTimer = null;

function _conectarWebSocket() {
  if (!_wsCorreo) return;
  clearTimeout(_wsReconnectTimer);

  // WS_URL ya incluye el path "/ws"; no volver a concatenarlo (evita conectar a "/ws/ws").
  _ws = new WebSocket(`${WS_URL}?correo=${encodeURIComponent(_wsCorreo)}`);

  _ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.tipo !== 'nueva_alerta') return;

      _actualizarContador(1);
      _inyectarAlertaEnPanel(data.mensaje, data.titulo, data.id);

      if (document.getElementById('modal-chat').classList.contains('hidden')) {
        _mostrarToast(data.mensaje);
      }
    } catch { /* silencioso */ }
  };

  // Reconexión automática y silenciosa: no relanzar errores a la consola.
  _ws.onerror = () => { _ws.close(); };
  _ws.onclose = () => {
    _wsReconnectTimer = setTimeout(_conectarWebSocket, 3000);
  };
}

// ── Notificaciones: descarte individual y "limpiar todo" ────────────────────
// Las "alertas" las recalcula el backend en cada carga (no tienen _id propio),
// así que su descarte se recuerda en localStorage por clave titulo+mensaje.
// Las "notificaciones" (chat) sí están persistidas en Mongo con _id, así que
// su descarte se sincroniza contra el backend para que no reaparezcan.

function _claveAlerta(titulo, mensaje) {
  return `${titulo}||${mensaje}`;
}

function _obtenerAlertasDescartadas() {
  try {
    return new Set(JSON.parse(localStorage.getItem(`alertas_descartadas_${_wsCorreo}`) || '[]'));
  } catch {
    return new Set();
  }
}

function _guardarAlertasDescartadas(set) {
  localStorage.setItem(`alertas_descartadas_${_wsCorreo}`, JSON.stringify([...set]));
}

async function _marcarNotificacionLeida(id) {
  try {
    await fetch(`${API_URL}/notificaciones/${id}/leer`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token },
    });
  } catch { /* silencioso: la notificacion ya se quitó del panel igualmente */ }
}

async function _marcarTodasNotificacionesLeidas() {
  try {
    await fetch(`${API_URL}/notificaciones/leer-todas`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token },
    });
  } catch { /* silencioso */ }
}

function _actualizarContador(delta) {
  const contador = document.getElementById('contador-alertas');
  const actual = Math.max(0, (parseInt(contador.textContent) || 0) + delta);
  if (actual > 0) {
    contador.textContent = actual;
    contador.classList.remove('hidden');
  } else {
    contador.textContent = '';
    contador.classList.add('hidden');
  }
}

function _mostrarListaVacia() {
  const lista = document.getElementById('lista-alertas');
  lista.innerHTML = '';
  const item = document.createElement('li');
  item.className = 'px-4 py-4 text-sm text-gray-400 text-center';
  item.textContent = 'No tienes notificaciones pendientes';
  lista.appendChild(item);
}

function _crearItemAlerta(mensaje, titulo, color, meta = {}) {
  const item = document.createElement('li');
  item.className = 'relative px-4 py-3 pr-8 hover:bg-white/10 transition-colors border-b border-white/5';
  item.dataset.tipo = meta.tipo || '';
  if (meta.id) item.dataset.id = meta.id;
  item.dataset.titulo = titulo;
  item.dataset.mensaje = mensaje;

  const colorClase = color === 'purple' ? 'text-purple-400' : 'text-red-400';
  const icono      = color === 'purple' ? '💬 ' : '';
  item.innerHTML = `
    <p class="text-xs font-semibold ${colorClase}">${icono}${mensaje}</p>
    <p class="text-sm text-gray-200 mt-0.5">${titulo}</p>
    <button
      type="button"
      class="btn-descartar-alerta absolute top-2 right-2 text-gray-400 hover:text-white text-base leading-none px-1"
      aria-label="Descartar notificación"
    >&times;</button>
  `;

  item.querySelector('.btn-descartar-alerta').addEventListener('click', (event) => {
    event.stopPropagation();
    item.remove();
    _actualizarContador(-1);

    if (meta.tipo === 'notif' && meta.id) {
      _marcarNotificacionLeida(meta.id);
    } else if (meta.tipo === 'alerta') {
      const descartadas = _obtenerAlertasDescartadas();
      descartadas.add(_claveAlerta(titulo, mensaje));
      _guardarAlertasDescartadas(descartadas);
    }

    if (!document.getElementById('lista-alertas').children.length) {
      _mostrarListaVacia();
    }
  });

  return item;
}

function _inyectarAlertaEnPanel(mensaje, titulo, id) {
  const lista = document.getElementById('lista-alertas');
  if (lista.children.length === 1 && lista.children[0].textContent.trim() === 'No tienes notificaciones pendientes') {
    lista.innerHTML = '';
  }
  lista.insertBefore(
    _crearItemAlerta(mensaje, titulo || 'Nuevo mensaje en el chat', 'purple', { tipo: 'notif', id }),
    lista.firstChild
  );
}

function _mostrarToast(texto) {
  const div = document.createElement('div');
  div.className = 'fixed bottom-6 right-6 bg-purple-700 text-white px-5 py-3 rounded-xl shadow-2xl text-sm z-50 flex items-center gap-3';
  div.style.cssText = 'transition: opacity 0.4s ease; opacity: 0;';
  div.innerHTML = `<span class="text-xl">💬</span><span>${texto}</span>`;
  document.body.appendChild(div);
  requestAnimationFrame(() => { div.style.opacity = '1'; });
  setTimeout(() => {
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 400);
  }, 4000);
}

let miGrafico = null;

// ── Modo Claro / Oscuro ────────────────────────────────────────────────────────

const themeToggleBtn = document.getElementById('theme-toggle');

const applyTheme = (isLight) => {
  if (isLight) {
    document.body.classList.add('light-mode');
    themeToggleBtn.textContent = '🌙 Modo Oscuro';
  } else {
    document.body.classList.remove('light-mode');
    themeToggleBtn.textContent = '☀️ Modo Claro';
  }

  if (typeof miGrafico !== 'undefined' && miGrafico) {
    miGrafico.options.plugins.legend.labels.color = isLight ? '#1a1a1a' : '#ffffff';
    miGrafico.update();
  }
};

applyTheme(localStorage.getItem('theme') === 'light');

themeToggleBtn.addEventListener('click', () => {
  const isLight = !document.body.classList.contains('light-mode');
  applyTheme(isLight);
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

let documentosActuales = [];

const obtenerRol = () => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.rol;
  } catch(e) {
    return null;
  }
};

const normalizeUrl = (ruta) => {
  const rutaNormalizada = ruta.split('\\\\').join('/').split('\\').join('/');
  // Codifica cada segmento (espacios, tildes, ñ, etc.) para que coincida con el unquote() del backend.
  const segmentos = rutaNormalizada.split('/').map(encodeURIComponent);
  return `${API_URL}/${segmentos.join('/')}`;
};

const formatearFechaHora = (fechaIso) => {
  if (!fechaIso) return 'N/A';

  // El backend guarda y calcula en UTC, pero Mongo/FastAPI devuelven el ISO string
  // sin 'Z' ni offset ("naive"). Si no trae indicador de zona horaria, se lo agregamos
  // para que new Date() lo interprete como UTC y luego lo convierta a la hora local (es-EC).
  let isoString = String(fechaIso);
  if (!isoString.endsWith('Z') && !isoString.includes('+') && !isoString.includes('-', 10)) {
    isoString += 'Z';
  }

  const fecha = new Date(isoString);
  return fecha.toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

// ── Visibilidad según rol ──────────────────────────────────────────────────────

const rol = obtenerRol();

if (rol === 'superadmin' || rol === 'admin') {
  document.getElementById('btn-nav-usuarios').classList.remove('hidden');
  document.getElementById('btn-nav-estadisticas').classList.remove('hidden');
  document.getElementById('btn-nav-auditoria').classList.remove('hidden');
}

if (rol === 'superadmin') {
  document.getElementById('btn-ajustar-tarifa').classList.remove('hidden');
}

if (rol === 'traductor') {
  document.getElementById('btn-nuevo-documento').classList.add('hidden');
}

// ── Navegación entre vistas ────────────────────────────────────────────────────

const ocultarTodasLasVistas = () => {
  ['vista-documentos', 'vista-usuarios', 'vista-estadisticas',
   'vista-detalle-documento', 'vista-auditoria'].forEach((id) =>
    document.getElementById(id).classList.add('hidden')
  );
};

document.getElementById('btn-nav-docs').addEventListener('click', () => {
  ocultarTodasLasVistas();
  document.getElementById('vista-documentos').classList.remove('hidden');
});

document.getElementById('btn-nav-usuarios').addEventListener('click', () => {
  ocultarTodasLasVistas();
  document.getElementById('vista-usuarios').classList.remove('hidden');
  cargarUsuarios();
});

document.getElementById('btn-nav-estadisticas').addEventListener('click', () => {
  ocultarTodasLasVistas();
  document.getElementById('vista-estadisticas').classList.remove('hidden');
  cargarEstadisticas();
});

document.getElementById('btn-nav-auditoria').addEventListener('click', () => {
  ocultarTodasLasVistas();
  document.getElementById('vista-auditoria').classList.remove('hidden');
  cargarAuditoria();
});

// ── Modal: Ajustar Tarifa ─────────────────────────────────────────────────────

document.getElementById('btn-ajustar-tarifa').addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_URL}/configuracion/costo`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (response.ok) {
      const data = await response.json();
      document.getElementById('input-costo-pagina').value = data.costo_por_pagina;
    }
  } catch { /* silencioso */ }
  document.getElementById('modal-ajustar-tarifa').classList.remove('hidden');
});

document.getElementById('btn-cancelar-tarifa').addEventListener('click', () => {
  document.getElementById('modal-ajustar-tarifa').classList.add('hidden');
});

document.getElementById('form-ajustar-tarifa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nuevoCosto = parseFloat(document.getElementById('input-costo-pagina').value);
  if (isNaN(nuevoCosto) || nuevoCosto < 0) {
    alert('Ingresa un valor válido para el costo.');
    return;
  }
  try {
    const response = await fetch(`${API_URL}/configuracion/costo`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ costo_por_pagina: nuevoCosto }),
    });
    if (response.ok) {
      alert('Tarifa actualizada exitosamente.');
      document.getElementById('modal-ajustar-tarifa').classList.add('hidden');
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo actualizar la tarifa.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
});

// ── Cargar traductores en el select del modal ──────────────────────────────────

async function cargarTraductoresEnSelect() {
  try {
    const response = await fetch(`${API_URL}/usuarios`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!response.ok) return;

    const usuarios = await response.json();
    const select = document.getElementById('select-traductor');
    select.innerHTML = '<option value="">Selecciona un traductor…</option>';
    usuarios
      .filter((u) => u.rol === 'traductor')
      .forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.correo;
        opt.textContent = `${u.nombre} (${u.correo})`;
        select.appendChild(opt);
      });
  } catch {
    // silencioso
  }
}

// ── Subida de traducción (traductor) ──────────────────────────────────────────

let documentoActivoParaTraduccion = null;

window.prepararTraduccion = (id) => {
  documentoActivoParaTraduccion = id;
  document.getElementById('input-traduccion').click();
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('input-traduccion').addEventListener('change', async (event) => {
    const archivo = event.target.files[0];
    if (!archivo) return;

    const formData = new FormData();
    formData.append('archivo', archivo);

    try {
      const response = await fetch(
        `${API_URL}/documentos/${documentoActivoParaTraduccion}/traduccion`,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: formData,
        }
      );

      if (response.ok) {
        alert('Traducción subida exitosamente');
        event.target.value = '';
        await cargarDocumentos();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'No se pudo subir la traducción.'));
      }
    } catch {
      alert('No se pudo conectar con el servidor.');
    }
  });
});

// ── Cargar documentos ──────────────────────────────────────────────────────────

let documentosCargados = [];

async function cargarDocumentos() {
  try {
    const response = await fetch(`${API_URL}/documentos`, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (!response.ok) {
      alert('Error al cargar los documentos. Inicia sesión nuevamente.');
      localStorage.removeItem('token');
      window.location.href = '../index.html';
      return;
    }

    const documentos = await response.json();
    documentosCargados = documentos;
    documentosActuales = documentos;

    // ── Encabezados ───────────────────────────────────────────────────────────
    const thead = document.getElementById('thead-documentos');
    thead.innerHTML = `<tr>
      <th class="px-4 py-3 whitespace-nowrap">Título</th>
      <th class="px-4 py-3 whitespace-nowrap">Estado</th>
      <th class="px-4 py-3 whitespace-nowrap">Fecha Límite</th>
      <th class="px-4 py-3"></th>
    </tr>`;

    // ── Filas ─────────────────────────────────────────────────────────────────
    const tbody = document.getElementById('tabla-documentos');
    tbody.innerHTML = '';

    documentos.forEach((doc) => {
      const fechaLimite = doc.fecha_entrega
        ? formatearFechaHora(doc.fecha_entrega)
        : '-';

      const estadoClases = {
        'Pendiente':   'bg-slate-100 text-slate-600',
        'En proceso':  'bg-blue-100 text-blue-700',
        'En revisión': 'bg-yellow-100 text-yellow-700',
        'Completado':  'bg-green-100 text-green-700',
      };
      const badgeClase = estadoClases[doc.estado] || 'bg-slate-100 text-slate-600';
      const badgeEstado = `<span class="px-2 py-1 rounded-full text-xs font-semibold ${badgeClase}">${doc.estado}</span>`;

      const fila = document.createElement('tr');
      fila.className = 'cursor-pointer hover:bg-white/10 transition-colors border-b border-white/10';
      fila.setAttribute('onclick', `verDetalle('${doc._id}')`);

      fila.innerHTML = `
        <td class="px-4 py-4 font-medium text-white">${doc.titulo}</td>
        <td class="px-4 py-4">${badgeEstado}</td>
        <td class="px-4 py-4 text-xs text-gray-300">${fechaLimite}</td>
        <td class="px-4 py-4 text-gray-400 text-right text-lg">›</td>
      `;
      tbody.appendChild(fila);
    });
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
}


// ── Eliminar documento ─────────────────────────────────────────────────────────

window.eliminarDocumento = async (id) => {
  if (!confirm('¿Seguro que deseas eliminar este documento?')) return;

  try {
    const response = await fetch(`${API_URL}/documentos/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (response.ok) {
      alert('Documento eliminado exitosamente');
      await cargarDocumentos();
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo eliminar el documento.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
};

// ── Modal documentos: abrir / cerrar ──────────────────────────────────────────

const modal    = document.getElementById('modal-crear');
const formCrear = document.getElementById('form-crear-documento');

const dropzone      = document.getElementById('dropzone-nuevo');
const inputFile     = document.getElementById('archivo-origen');
const dropzoneTexto = document.getElementById('dropzone-texto');

const actualizarTextoDropzone = () => {
  if (inputFile.files.length > 0) {
    dropzoneTexto.textContent = 'Archivo listo: ' + inputFile.files[0].name;
    dropzoneTexto.classList.replace('text-gray-400', 'text-blue-400');
  } else {
    dropzoneTexto.textContent = 'Arrastra tu archivo PDF aquí o haz clic para explorar';
    dropzoneTexto.classList.replace('text-blue-400', 'text-gray-400');
  }
};

dropzone.addEventListener('click', () => inputFile.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('border-blue-500', 'bg-blue-900/20');
});

dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropzone.classList.remove('border-blue-500', 'bg-blue-900/20');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('border-blue-500', 'bg-blue-900/20');
  if (e.dataTransfer.files.length) {
    inputFile.files = e.dataTransfer.files;
    actualizarTextoDropzone();
  }
});

inputFile.addEventListener('change', actualizarTextoDropzone);

// Mantiene Origen/Destino siempre en idiomas opuestos (Inglés ⇄ Español).
const selectIdiomaOrigen  = document.getElementById('input-idioma-origen');
const selectIdiomaDestino = document.getElementById('input-idioma-destino');

selectIdiomaOrigen.addEventListener('change', () => {
  selectIdiomaDestino.value = selectIdiomaOrigen.value === 'Inglés' ? 'Español' : 'Inglés';
});

selectIdiomaDestino.addEventListener('change', () => {
  selectIdiomaOrigen.value = selectIdiomaDestino.value === 'Inglés' ? 'Español' : 'Inglés';
});

// Formatea un Date a "YYYY-MM-DDTHH:mm" en hora local, formato que exige el atributo
// min/value de un <input type="datetime-local">.
const _fechaLocalInputValue = (fecha) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
};

document.getElementById('btn-nuevo-documento').addEventListener('click', () => {
  cargarTraductoresEnSelect();
  // Bloquea nativamente en el calendario cualquier fecha/hora anterior al momento actual.
  document.getElementById('input-fecha-entrega').min = _fechaLocalInputValue(new Date());
  modal.classList.remove('hidden');
});

document.getElementById('btn-cancelar').addEventListener('click', () => {
  modal.classList.add('hidden');
  formCrear.reset();
  actualizarTextoDropzone();
});

// ── Crear documento (FormData) ────────────────────────────────────────────────

formCrear.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!inputFile.files[0]) {
    alert('Debes seleccionar un archivo original.');
    return;
  }

  const idiomaOrigen  = selectIdiomaOrigen.value;
  const idiomaDestino = selectIdiomaDestino.value;
  if (idiomaOrigen === idiomaDestino) {
    alert('El idioma de origen y destino no pueden ser el mismo.');
    return;
  }

  const fechaLimite = new Date(document.getElementById('input-fecha-entrega').value);
  if (fechaLimite <= new Date()) {
    alert('La fecha límite de entrega no puede ser anterior o igual a la fecha actual.');
    return;
  }

  const formData = new FormData();
  formData.append('titulo',          document.getElementById('input-titulo').value);
  formData.append('idioma_origen',   idiomaOrigen);
  formData.append('idioma_destino',  idiomaDestino);
  formData.append('fecha_entrega',   fechaLimite.toISOString());
  formData.append('asignado_a',      document.getElementById('select-traductor').value);
  formData.append('comentarios',     document.getElementById('input-comentarios').value);
  formData.append('archivo_origen',  inputFile.files[0]);

  try {
    const response = await fetch(`${API_URL}/documentos`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });

    if (response.ok) {
      modal.classList.add('hidden');
      formCrear.reset();
      actualizarTextoDropzone();
      await cargarDocumentos();
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo crear el documento.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
});

// ── Cargar usuarios ────────────────────────────────────────────────────────────

let usuariosCargados = [];

async function cargarUsuarios() {
  try {
    const response = await fetch(`${API_URL}/usuarios`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (!response.ok) {
      alert('Error al cargar los usuarios.');
      return;
    }

    usuariosCargados = await response.json();

    const payload = JSON.parse(atob(localStorage.getItem('token').split('.')[1]));
    const miCorreo = payload.sub;
    const usuariosFiltrados = usuariosCargados.filter((u) => u.correo !== miCorreo);

    const tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';

    usuariosFiltrados.forEach((usuario) => {
      const fila = document.createElement('tr');
      fila.className = 'hover:bg-white/10 transition-colors duration-200 border-b border-white/10';
      fila.innerHTML = `
        <td class="px-6 py-4 font-medium text-white">${usuario.nombre}</td>
        <td class="px-6 py-4 text-gray-200">${usuario.correo}</td>
        <td class="px-6 py-4 capitalize text-gray-200">${usuario.rol}</td>
        <td class="px-6 py-4 flex gap-2">
          <button onclick="editarUsuario('${usuario._id}')"
            class="bg-yellow-400 text-white px-2 py-1 rounded text-sm hover:bg-yellow-500">
            Editar
          </button>
          <button onclick="eliminarUsuario('${usuario._id}')"
            class="bg-red-500 text-white px-2 py-1 rounded text-sm hover:bg-red-600">
            Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(fila);
    });
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
}

// ── Eliminar usuario ───────────────────────────────────────────────────────────

window.eliminarUsuario = async (id) => {
  if (!confirm('¿Seguro que deseas eliminar este usuario?')) return;

  try {
    const response = await fetch(`${API_URL}/usuarios/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (response.ok) {
      alert('Usuario eliminado exitosamente');
      await cargarUsuarios();
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo eliminar el usuario.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
};

// ── Modal usuarios: abrir / cerrar ────────────────────────────────────────────

const modalUsuario     = document.getElementById('modal-usuario');
const formCrearUsuario = document.getElementById('form-crear-usuario');
const tituloModalUsuario = modalUsuario.querySelector('h3');

function cerrarModalUsuario() {
  modalUsuario.classList.add('hidden');
  formCrearUsuario.reset();
  document.getElementById('user-id').value = '';
  tituloModalUsuario.textContent = 'Nuevo Usuario';
}

document.getElementById('btn-nuevo-usuario').addEventListener('click', () => {
  cerrarModalUsuario();   // resetea estado previo
  modalUsuario.classList.remove('hidden');
});

document.getElementById('btn-cancelar-usuario').addEventListener('click', cerrarModalUsuario);

// ── Editar usuario ─────────────────────────────────────────────────────────────

window.editarUsuario = (id) => {
  const usuario = usuariosCargados.find((u) => u._id === id);
  if (!usuario) return;

  document.getElementById('user-id').value              = usuario._id;
  document.getElementById('input-usuario-nombre').value = usuario.nombre;
  document.getElementById('input-usuario-correo').value = usuario.correo;
  document.getElementById('input-usuario-password').value = '';
  document.getElementById('rol-usuario').value          = usuario.rol;
  tituloModalUsuario.textContent = 'Editar Usuario';
  modalUsuario.classList.remove('hidden');
};

// ── Crear / Editar usuario ────────────────────────────────────────────────────

formCrearUsuario.addEventListener('submit', async (e) => {
  e.preventDefault();

  const userId   = document.getElementById('user-id').value;
  const nombre   = document.getElementById('input-usuario-nombre').value;
  const correo   = document.getElementById('input-usuario-correo').value;
  const password = document.getElementById('input-usuario-password').value;
  const rol      = document.getElementById('rol-usuario').value;

  const payload = { nombre, correo, rol };
  if (password !== '') payload.password = password;

  const url    = userId ? `${API_URL}/usuarios/${userId}` : `${API_URL}/usuarios`;
  const method = userId ? 'PUT' : 'POST';

  // POST requiere password
  if (!userId && !password) {
    alert('La contraseña es obligatoria al crear un usuario.');
    return;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      cerrarModalUsuario();
      await cargarUsuarios();
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo guardar el usuario.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
});

// ── Iniciar traducción (traductor descarga y marca En proceso) ────────────────

window.iniciarTraduccion = async (id, urlRaw) => {
  try {
    await fetch(`${API_URL}/documentos/${id}/iniciar`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token },
    });
  } catch {
    // continúa aunque falle el cambio de estado
  }
  window.open(normalizeUrl(urlRaw), '_blank');
  await cargarDocumentos();
};

// ── Modal evaluación ───────────────────────────────────────────────────────────

const modalEvaluacion = document.getElementById('modal-evaluacion');

window.abrirEvaluacion = (id) => {
  document.getElementById('eval-doc-id').value = id;
  document.getElementById('input-feedback').value = '';
  modalEvaluacion.classList.remove('hidden');
};

document.getElementById('btn-cancelar-evaluacion').addEventListener('click', () => {
  modalEvaluacion.classList.add('hidden');
});

async function enviarEvaluacion(aprobado) {
  const id       = document.getElementById('eval-doc-id').value;
  const feedback = document.getElementById('input-feedback').value;

  try {
    const response = await fetch(`${API_URL}/documentos/${id}/evaluar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ aprobado, feedback }),
    });

    if (response.ok) {
      modalEvaluacion.classList.add('hidden');
      alert(aprobado ? 'Traducción aprobada.' : 'Corrección solicitada al traductor.');
      await cargarDocumentos();
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo registrar la evaluación.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
}

document.getElementById('btn-aprobar').addEventListener('click', () => enviarEvaluacion(true));
document.getElementById('btn-solicitar-correccion').addEventListener('click', () => enviarEvaluacion(false));

// ── Alertas ────────────────────────────────────────────────────────────────────

document.getElementById('btn-alertas').addEventListener('click', () => {
  document.getElementById('menu-alertas').classList.toggle('hidden');
});

document.getElementById('btn-limpiar-alertas').addEventListener('click', async (event) => {
  event.stopPropagation();

  const items = [...document.querySelectorAll('#lista-alertas li[data-tipo]')];
  const descartadas = _obtenerAlertasDescartadas();
  items
    .filter((item) => item.dataset.tipo === 'alerta')
    .forEach((item) => descartadas.add(_claveAlerta(item.dataset.titulo, item.dataset.mensaje)));
  _guardarAlertasDescartadas(descartadas);

  _mostrarListaVacia();
  document.getElementById('contador-alertas').classList.add('hidden');
  document.getElementById('contador-alertas').textContent = '';

  await _marcarTodasNotificacionesLeidas();
});

async function cargarAlertas() {
  try {
    const headers = { 'Authorization': 'Bearer ' + token };
    const [resAlertas, resNotifs] = await Promise.all([
      fetch(`${API_URL}/alertas`,       { headers }),
      fetch(`${API_URL}/notificaciones`, { headers }),
    ]);

    const alertasCrudas = resAlertas.ok ? await resAlertas.json() : [];
    const notifs        = resNotifs.ok  ? await resNotifs.json()  : [];

    const descartadas = _obtenerAlertasDescartadas();
    const alertas = alertasCrudas.filter((a) => !descartadas.has(_claveAlerta(a.titulo, a.mensaje)));

    const contador = document.getElementById('contador-alertas');
    const lista    = document.getElementById('lista-alertas');
    lista.innerHTML = '';

    const total = alertas.length + notifs.length;

    if (total > 0) {
      contador.classList.remove('hidden');
      contador.textContent = total;
      notifs.forEach((n) => lista.appendChild(_crearItemAlerta(n.mensaje, n.titulo, 'purple', { tipo: 'notif', id: n._id })));
      alertas.forEach((a) => lista.appendChild(_crearItemAlerta(a.mensaje, a.titulo, 'red', { tipo: 'alerta' })));
    } else {
      contador.classList.add('hidden');
      _mostrarListaVacia();
    }
  } catch {
    // silencioso
  }
}

// ── Estadísticas (solo admin / superadmin) ────────────────────────────────────

async function cargarEstadisticas() {
  try {
    const response = await fetch(`${API_URL}/estadisticas`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!response.ok) return;

    const datos = await response.json();

    document.getElementById('stat-total').textContent      = datos.total_documentos;
    document.getElementById('stat-proceso').textContent    = datos.en_proceso;
    document.getElementById('stat-completados').textContent = datos.completados;
    document.getElementById('stat-ganancias').textContent  =
      '$' + datos.ganancias_totales.toFixed(2);

    const ctx = document.getElementById('grafico-estados').getContext('2d');
    if (miGrafico) miGrafico.destroy();

    miGrafico = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Pendientes', 'En Proceso', 'En Revisión', 'Completados'],
        datasets: [{
          data: [datos.pendientes, datos.en_proceso, datos.en_revision, datos.completados],
          backgroundColor: ['#f43f5e', '#38bdf8', '#facc15', '#4ade80'],
          borderColor: 'transparent',
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: document.body.classList.contains('light-mode') ? '#1a1a1a' : '#ffffff', padding: 20 },
          },
        },
      },
    });
  } catch {
    // silencioso
  }
}

// ── Stepper de estados ────────────────────────────────────────────────────────

function renderizarLineaTiempo(estadoActual) {
  const pasos = ['Pendiente', 'En proceso', 'En revisión', 'Completado'];
  const indiceActual = pasos.indexOf(estadoActual);
  const anchoPct = indiceActual <= 0 ? 0 : (indiceActual / (pasos.length - 1)) * 100;

  const circulos = pasos.map((paso, i) => {
    const activo = i <= indiceActual;
    const circuloClase = activo
      ? 'bg-blue-500 border-2 border-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]'
      : 'bg-slate-800 border-2 border-slate-600';
    const textoClase = activo ? 'text-blue-300' : 'text-gray-500';
    return `
      <div class="relative z-10 flex flex-col items-center">
        <div class="w-8 h-8 rounded-full ${circuloClase}"></div>
        <span class="text-xs mt-2 absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-medium ${textoClase}">${paso}</span>
      </div>`;
  }).join('');

  document.getElementById('linea-tiempo').innerHTML = `
    <div class="flex items-center justify-between w-full relative">
      <div class="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-slate-700 rounded-full z-0"></div>
      <div class="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-blue-500 rounded-full z-0 transition-all duration-500" style="width:${anchoPct}%"></div>
      ${circulos}
    </div>`;
}

// ── Bandeja: volver y ver detalle ─────────────────────────────────────────────

window.volverBandeja = () => {
  document.getElementById('vista-detalle-documento').classList.add('hidden');
  document.getElementById('vista-documentos').classList.remove('hidden');
};

window.verDetalle = (id) => {
  const doc = documentosActuales.find((d) => d._id === id);
  if (!doc) return;

  const esAdmin = rol === 'superadmin' || rol === 'admin';

  // Título y badge de estado
  document.getElementById('det-titulo').textContent = doc.titulo;
  const estadoClases = {
    'Pendiente':   'bg-slate-100 text-slate-600',
    'En proceso':  'bg-blue-100 text-blue-700',
    'En revisión': 'bg-yellow-100 text-yellow-700',
    'Completado':  'bg-green-100 text-green-700',
  };
  const estadoBadge = document.getElementById('det-estado');
  estadoBadge.textContent = doc.estado;
  estadoBadge.className = `px-3 py-1 rounded-full text-sm font-semibold ${estadoClases[doc.estado] || 'bg-slate-100 text-slate-600'}`;

  renderizarLineaTiempo(doc.estado);

  // Campos comunes
  document.getElementById('det-idiomas').textContent  = `${doc.idioma_origen} → ${doc.idioma_destino}`;
  const fechaEnvio  = formatearFechaHora(doc.fecha_envio);
  const fechaLimite = formatearFechaHora(doc.fecha_entrega);
  document.getElementById('det-fechas').textContent      = `Enviado: ${fechaEnvio} · Límite: ${fechaLimite}`;
  document.getElementById('det-comentarios').textContent = doc.comentarios || '-';

  // Campos solo para admin
  const divAsignado = document.getElementById('div-det-asignado');
  const divCosto    = document.getElementById('div-det-costo');
  if (esAdmin) {
    divAsignado.classList.remove('hidden');
    divCosto.classList.remove('hidden');
    document.getElementById('det-asignado').textContent = doc.asignado_a || '-';
    document.getElementById('det-costo').textContent    = doc.costo != null ? `$${doc.costo.toFixed(2)}` : '-';
  } else {
    divAsignado.classList.add('hidden');
    divCosto.classList.add('hidden');
  }

  // Acciones
  const acciones = document.getElementById('det-acciones');
  acciones.innerHTML = '';

  const btnClass = 'font-medium px-5 py-2.5 rounded-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_5px_15px_rgba(0,0,0,0.3)]';

  // Chat — todos los roles
  acciones.innerHTML += `<button onclick="abrirChat('${doc._id}')"
    class="bg-purple-600 hover:bg-purple-700 text-white ${btnClass}">
    Chat
  </button>`;

  if (esAdmin) {
    if (doc.archivo_origen_url) {
      acciones.innerHTML += `<a href="${normalizeUrl(doc.archivo_origen_url)}" target="_blank"
        class="bg-green-600 hover:bg-green-500 text-white inline-block ${btnClass}">
        Descargar Original
      </a>`;
    }
    if (doc.archivo_traduccion_url) {
      acciones.innerHTML += `<a href="${normalizeUrl(doc.archivo_traduccion_url)}" target="_blank"
        class="bg-teal-600 hover:bg-teal-500 text-white inline-block ${btnClass}">
        Descargar Traducción
      </a>`;
    }
    if (doc.estado === 'En revisión') {
      acciones.innerHTML += `<button onclick="abrirEvaluacion('${doc._id}')"
        class="bg-yellow-500 hover:bg-yellow-400 text-white ${btnClass}">
        Evaluar
      </button>`;
    }
    acciones.innerHTML += `<button onclick="eliminarDocumento('${doc._id}')"
      class="bg-red-600 hover:bg-red-500 text-white ${btnClass}">
      Eliminar
    </button>`;
  } else {
    if (doc.archivo_origen_url) {
      const urlRaw = doc.archivo_origen_url.split('\\').join('/');
      acciones.innerHTML += `<button onclick="iniciarTraduccion('${doc._id}', '${urlRaw}')"
        class="bg-green-600 hover:bg-green-500 text-white ${btnClass}">
        Descargar Original
      </button>`;
    }
    if (doc.estado === 'En proceso') {
      acciones.innerHTML += `<button onclick="prepararTraduccion('${doc._id}')"
        class="bg-blue-600 hover:bg-blue-500 text-white ${btnClass}">
        Subir Traducción
      </button>`;
    }
  }

  // Mostrar detalle
  document.getElementById('vista-documentos').classList.add('hidden');
  document.getElementById('vista-detalle-documento').classList.remove('hidden');
};

// ── Chat ───────────────────────────────────────────────────────────────────────

const modalChat = document.getElementById('modal-chat');

document.getElementById('btn-cerrar-chat').addEventListener('click', () => {
  modalChat.classList.add('hidden');
});

window.abrirChat = async (id) => {
  document.getElementById('chat-doc-id').value = id;
  modalChat.classList.remove('hidden');
  await cargarMensajes(id);
};

async function cargarMensajes(id) {
  try {
    const response = await fetch(`${API_URL}/documentos/${id}/chat`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!response.ok) return;

    const mensajes = await response.json();
    const cajaMensajes = document.getElementById('caja-mensajes');
    cajaMensajes.innerHTML = '';

    const miCorreo = JSON.parse(atob(token.split('.')[1])).sub;

    mensajes.forEach((msg, index) => {
      const esIA   = msg.remitente === 'Sistema IA 🤖';
      const esMio  = !esIA && msg.remitente === miCorreo;
      // Reutiliza el mismo helper que normaliza UTC y convierte a hora local
      // usado en la tabla de documentos, para que ambas vistas queden consistentes.
      const fecha  = formatearFechaHora(msg.fecha);

      const burbuja = document.createElement('div');
      burbuja.className = esMio
        ? 'bg-blue-600 text-white self-end rounded-l-xl rounded-tr-xl p-3 max-w-[80%]'
        : esIA
          ? 'bg-purple-900/60 border border-purple-500/40 text-white self-start rounded-r-xl rounded-tl-xl p-3 max-w-[85%]'
          : 'bg-slate-700 text-white self-start rounded-r-xl rounded-tl-xl p-3 max-w-[80%]';

      burbuja.innerHTML = `
        <p class="text-sm whitespace-pre-wrap">${msg.mensaje}</p>
        <p class="text-xs mt-1 opacity-60">${msg.remitente} · ${fecha}</p>
      `;
      cajaMensajes.appendChild(burbuja);
    });

    cajaMensajes.scrollTop = cajaMensajes.scrollHeight;
  } catch {
    // silencioso
  }
}

document.getElementById('form-chat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id    = document.getElementById('chat-doc-id').value;
  const input = document.getElementById('input-mensaje');
  const texto = input.value.trim();
  if (!texto) return;

  try {
    const response = await fetch(`${API_URL}/documentos/${id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ mensaje: texto }),
    });

    if (response.ok) {
      input.value = '';
      await cargarMensajes(id);
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo enviar el mensaje.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
});

// ── Auditoría ──────────────────────────────────────────────────────────────────

async function cargarAuditoria() {
  try {
    const response = await fetch(`${API_URL}/auditoria`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!response.ok) return;

    const logs = await response.json();
    const tbody = document.getElementById('tabla-auditoria');
    tbody.innerHTML = '';

    logs.forEach((log) => {
      const fecha = new Date(log.fecha).toLocaleString('es-CL');
      const fila = document.createElement('tr');
      fila.className = 'hover:bg-white/10 transition-colors border-b border-white/10 text-sm text-gray-300';

      const celdaAcciones = rol === 'superadmin'
        ? `<td class="px-6 py-3">
             <button onclick="eliminarLogAuditoria('${log._id}', this)"
               class="bg-red-500 hover:bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
               🗑 Eliminar
             </button>
           </td>`
        : '<td></td>';

      fila.innerHTML = `
        <td class="px-6 py-3 whitespace-nowrap">${fecha}</td>
        <td class="px-6 py-3">${log.usuario}</td>
        <td class="px-6 py-3 font-medium text-white">${log.accion}</td>
        <td class="px-6 py-3">${log.detalles || '-'}</td>
        ${celdaAcciones}
      `;
      tbody.appendChild(fila);
    });
  } catch {
    // silencioso
  }
}

window.eliminarLogAuditoria = async (id, btn) => {
  if (!confirm('¿Estás seguro de que deseas eliminar este registro del historial?')) return;

  try {
    const response = await fetch(`${API_URL}/auditoria/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (response.ok) {
      const fila = btn.closest('tr');
      fila.style.transition = 'opacity 0.3s ease';
      fila.style.opacity = '0';
      setTimeout(() => fila.remove(), 300);
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo eliminar el registro.'));
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
};

// ── Cerrar sesión ──────────────────────────────────────────────────────────────

document.getElementById('btn-cerrar-sesion').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '../index.html';
});

// ── Inicio ─────────────────────────────────────────────────────────────────────

cargarDocumentos();
cargarAlertas();
_conectarWebSocket();
