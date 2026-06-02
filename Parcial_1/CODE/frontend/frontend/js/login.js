document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();

  const correo = document.getElementById('input-correo').value;
  const password = document.getElementById('input-password').value;

  const body = new URLSearchParams();
  body.append('username', correo);
  body.append('password', password);

  try {
    const response = await fetch('https://united-republic-api.onrender.com/login', {
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
