const API_URL = 'https://united-republic-web.onrender.com';
const WS_URL = 'wss://united-republic-web.onrender.com/ws';

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
};

applyTheme(localStorage.getItem('theme') === 'light');

themeToggleBtn.addEventListener('click', () => {
  const isLight = !document.body.classList.contains('light-mode');
  applyTheme(isLight);
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

// ── Inicio de sesión ───────────────────────────────────────────────────────────

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();

  const correo = document.getElementById('input-correo').value;
  const password = document.getElementById('input-password').value;

  const body = new URLSearchParams();
  body.append('username', correo);
  body.append('password', password);

  try {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('token', data.access_token);
      window.location.href = 'pages/dashboard.html';
    } else if (response.status === 429) {
      alert(data.detail);
    } else if (response.status === 401) {
      alert(data.detail);
    } else {
      alert(data.detail || 'Error al iniciar sesión.');
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
});
