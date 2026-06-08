const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '../index.html';
}

// ── WebSocket: notificaciones en tiempo real ────────────────────────────────

const _wsCorreo = (() => {
  try { return JSON.parse(atob(token.split('.')[1])).sub; } catch { return null; }
})();

let _ws = null;

function _conectarWebSocket() {
  if (!_wsCorreo) return;
  _ws = new WebSocket(`wss://united-republic-api.onrender.com/ws?correo=${encodeURIComponent(_wsCorreo)}`);

  _ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.tipo !== 'nueva_alerta') return;

      const contador = document.getElementById('contador-alertas');
      const actual = parseInt(contador.textContent) || 0;
      contador.textContent = actual + 1;
      contador.classList.remove('hidden');

      _inyectarAlertaEnPanel(data.mensaje, data.titulo);

      if (document.getElementById('modal-chat').classList.contains('hidden')) {
        _mostrarToast(data.mensaje);
      }
    } catch { /* silencioso */ }
  };

  _ws.onclose = () => setTimeout(_conectarWebSocket, 3000);
}

function _crearItemAlerta(mensaje, titulo, color) {
  const item = document.createElement('li');
  item.className = 'px-4 py-3 hover:bg-white/10 transition-colors border-b border-white/5';
  const colorClase = color === 'purple' ? 'text-purple-400' : 'text-red-400';
  const icono      = color === 'purple' ? '💬 ' : '';
  item.innerHTML = `
    <p class="text-xs font-semibold ${colorClase}">${icono}${mensaje}</p>
    <p class="text-sm text-gray-200 mt-0.5">${titulo}</p>
  `;
  return item;
}

function _inyectarAlertaEnPanel(mensaje, titulo) {
  const lista = document.getElementById('lista-alertas');
  if (lista.children.length === 1 && lista.children[0].textContent.trim() === 'No hay alertas') {
    lista.innerHTML = '';
  }
  lista.insertBefore(_crearItemAlerta(mensaje, titulo || 'Nuevo mensaje en el chat', 'purple'), lista.firstChild);
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
let mensajesChatActual = [];

const obtenerRol = () => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.rol;
  } catch(e) {
    return null;
  }
};

const normalizeUrl = (ruta) =>
  'https://united-republic-api.onrender.com/' + ruta.split('\\\\').join('/').split('\\').join('/');

// ── Visibilidad según rol ──────────────────────────────────────────────────────

const rol = obtenerRol();

if (rol === 'superadmin' || rol === 'admin') {
  document.getElementById('btn-nav-usuarios').classList.remove('hidden');
  document.getElementById('btn-nav-estadisticas').classList.remove('hidden');
  document.getElementById('btn-nav-auditoria').classList.remove('hidden');
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

// ── Cargar traductores en el select del modal ──────────────────────────────────

async function cargarTraductoresEnSelect() {
  try {
    const response = await fetch('https://united-republic-api.onrender.com/usuarios', {
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
        `https://united-republic-api.onrender.com/documentos/${documentoActivoParaTraduccion}/traduccion`,
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
    const response = await fetch('https://united-republic-api.onrender.com/documentos', {
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
        ? new Date(doc.fecha_entrega).toLocaleDateString('es-CL')
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
    const response = await fetch(`https://united-republic-api.onrender.com/documentos/${id}`, {
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

document.getElementById('btn-nuevo-documento').addEventListener('click', () => {
  cargarTraductoresEnSelect();
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

  const formData = new FormData();
  formData.append('titulo',          document.getElementById('input-titulo').value);
  formData.append('idioma_origen',   document.getElementById('input-idioma-origen').value);
  formData.append('idioma_destino',  document.getElementById('input-idioma-destino').value);
  formData.append('fecha_entrega',   new Date(document.getElementById('input-fecha-entrega').value).toISOString());
  formData.append('asignado_a',      document.getElementById('select-traductor').value);
  formData.append('comentarios',     document.getElementById('input-comentarios').value);
  formData.append('archivo_origen',  inputFile.files[0]);

  const costoVal = document.getElementById('input-costo').value;
  if (costoVal !== '') formData.append('costo', costoVal);

  try {
    const response = await fetch('https://united-republic-api.onrender.com/documentos', {
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
    const response = await fetch('https://united-republic-api.onrender.com/usuarios', {
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
    const response = await fetch(`https://united-republic-api.onrender.com/usuarios/${id}`, {
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

  const url    = userId ? `https://united-republic-api.onrender.com/usuarios/${userId}` : 'https://united-republic-api.onrender.com/usuarios';
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
    await fetch(`https://united-republic-api.onrender.com/documentos/${id}/iniciar`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token },
    });
  } catch {
    // continúa aunque falle el cambio de estado
  }
  window.open('https://united-republic-api.onrender.com/' + urlRaw, '_blank');
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
    const response = await fetch(`https://united-republic-api.onrender.com/documentos/${id}/evaluar`, {
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

async function cargarAlertas() {
  try {
    const headers = { 'Authorization': 'Bearer ' + token };
    const [resAlertas, resNotifs] = await Promise.all([
      fetch('https://united-republic-api.onrender.com/alertas',       { headers }),
      fetch('https://united-republic-api.onrender.com/notificaciones', { headers }),
    ]);

    const alertas = resAlertas.ok ? await resAlertas.json() : [];
    const notifs  = resNotifs.ok  ? await resNotifs.json()  : [];

    const contador = document.getElementById('contador-alertas');
    const lista    = document.getElementById('lista-alertas');
    lista.innerHTML = '';

    const total = alertas.length + notifs.length;

    if (total > 0) {
      contador.classList.remove('hidden');
      contador.textContent = total;
      notifs.forEach((n) => lista.appendChild(_crearItemAlerta(n.mensaje, n.titulo, 'purple')));
      alertas.forEach((a) => lista.appendChild(_crearItemAlerta(a.mensaje, a.titulo, 'red')));
    } else {
      contador.classList.add('hidden');
      const item = document.createElement('li');
      item.className = 'px-4 py-4 text-sm text-gray-400 text-center';
      item.textContent = 'No hay alertas';
      lista.appendChild(item);
    }
  } catch {
    // silencioso
  }
}

// ── Estadísticas (solo admin / superadmin) ────────────────────────────────────

async function cargarEstadisticas() {
  try {
    const response = await fetch('https://united-republic-api.onrender.com/estadisticas', {
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
  const fechaEnvio  = doc.fecha_envio    ? new Date(doc.fecha_envio).toLocaleDateString('es-CL')    : '-';
  const fechaLimite = doc.fecha_entrega  ? new Date(doc.fecha_entrega).toLocaleDateString('es-CL')  : '-';
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
    acciones.innerHTML += `<button id="btn-ia-${doc._id}" onclick="generarBorradorIA('${doc._id}')"
      class="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(147,51,234,0.4)] hover:shadow-[0_0_25px_rgba(147,51,234,0.6)]">
      ✨ Generar Borrador IA
    </button>`;
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

// ── Borrador IA ───────────────────────────────────────────────────────────────

window.generarBorradorIA = async (id) => {
  const btn = document.getElementById(`btn-ia-${id}`);
  if (btn) {
    btn.textContent = 'Procesando...';
    btn.disabled = true;
  }

  try {
    const response = await fetch(`https://united-republic-api.onrender.com/documentos/${id}/borrador-ia`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (response.ok) {
      if (btn) {
        btn.innerHTML = '✨ Generar Borrador IA';
        btn.disabled = false;
      }
      await abrirChat(id);
    } else {
      const error = await response.json();
      alert('Error: ' + (error.detail || 'No se pudo generar el borrador.'));
      if (btn) {
        btn.innerHTML = '✨ Generar Borrador IA';
        btn.disabled = false;
      }
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
    if (btn) {
      btn.innerHTML = '✨ Generar Borrador IA';
      btn.disabled = false;
    }
  }
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
    const response = await fetch(`https://united-republic-api.onrender.com/documentos/${id}/chat`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!response.ok) return;

    const mensajes = await response.json();
    mensajesChatActual = mensajes;
    const cajaMensajes = document.getElementById('caja-mensajes');
    cajaMensajes.innerHTML = '';

    const miCorreo = JSON.parse(atob(token.split('.')[1])).sub;

    mensajes.forEach((msg, index) => {
      const esIA   = msg.remitente === 'Sistema IA 🤖';
      const esMio  = !esIA && msg.remitente === miCorreo;
      const fecha  = new Date(msg.fecha).toLocaleString('es-CL', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });

      const burbuja = document.createElement('div');
      burbuja.className = esMio
        ? 'bg-blue-600 text-white self-end rounded-l-xl rounded-tr-xl p-3 max-w-[80%]'
        : esIA
          ? 'bg-purple-900/60 border border-purple-500/40 text-white self-start rounded-r-xl rounded-tl-xl p-3 max-w-[85%]'
          : 'bg-slate-700 text-white self-start rounded-r-xl rounded-tl-xl p-3 max-w-[80%]';

      const btnDescarga = esIA
        ? `<button onclick="descargarTxtIA(${index})"
             class="mt-3 flex items-center gap-1 text-xs bg-purple-700/50 hover:bg-purple-600 border border-purple-500 text-white px-3 py-1.5 rounded-md transition-colors shadow-sm w-fit">
             ⬇️ Descargar Borrador .txt
           </button>`
        : '';

      burbuja.innerHTML = `
        <p class="text-sm whitespace-pre-wrap">${msg.mensaje}</p>
        <p class="text-xs mt-1 opacity-60">${msg.remitente} · ${fecha}</p>
        ${btnDescarga}
      `;
      cajaMensajes.appendChild(burbuja);
    });

    cajaMensajes.scrollTop = cajaMensajes.scrollHeight;
  } catch {
    // silencioso
  }
}

window.descargarTxtIA = (index) => {
  const mensajeOriginal = mensajesChatActual[index].mensaje;
  const textoLimpio = mensajeOriginal.replace('✨ **Borrador IA Generado:**\n\n', '');

  const blob = new Blob([textoLimpio], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'Borrador_IA_UnitedRepublic.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

document.getElementById('form-chat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id    = document.getElementById('chat-doc-id').value;
  const input = document.getElementById('input-mensaje');
  const texto = input.value.trim();
  if (!texto) return;

  try {
    const response = await fetch(`https://united-republic-api.onrender.com/documentos/${id}/chat`, {
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
    const response = await fetch('https://united-republic-api.onrender.com/auditoria', {
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
      fila.innerHTML = `
        <td class="px-6 py-3 whitespace-nowrap">${fecha}</td>
        <td class="px-6 py-3">${log.usuario}</td>
        <td class="px-6 py-3 font-medium text-white">${log.accion}</td>
        <td class="px-6 py-3">${log.detalles || '-'}</td>
      `;
      tbody.appendChild(fila);
    });
  } catch {
    // silencioso
  }
}

// ── Cerrar sesión ──────────────────────────────────────────────────────────────

document.getElementById('btn-cerrar-sesion').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '../index.html';
});

// ── Inicio ─────────────────────────────────────────────────────────────────────

cargarDocumentos();
cargarAlertas();
_conectarWebSocket();
