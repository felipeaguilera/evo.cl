// Lógica del nav compartida por todas las páginas (extraído de home.js, 28-07-2026)
function toggleTheme() {
  const html = document.documentElement;
  const icon = document.getElementById('theme-icon');
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  icon.className = isDark ? 'ph ph-moon' : 'ph ph-sun';
}

function toggleLang() {
  const html = document.documentElement;
  const current = html.getAttribute('data-lang') || 'es';
  const next = current === 'es' ? 'en' : 'es';
  html.setAttribute('data-lang', next);
  html.setAttribute('lang', next);
  document.getElementById('lang-btn').textContent = next === 'es' ? 'EN' : 'ES';
  applyLang(next);
}

// El swap de data-es/data-en es genérico (cualquier página). Los placeholders
// de formulario solo existen en la homepage; se aplican solo si los campos existen,
// así esta misma función sirve para páginas sin formulario de contacto.
function applyLang(lang) {
  document.querySelectorAll('[data-es]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.innerHTML = text;
  });
  const placeholders = {
    es: { nombre: 'Tu nombre', empresa: 'Tu empresa', mensaje: 'Cuéntanos qué necesitas...', email: 'tu@email.com' },
    en: { nombre: 'Your name', empresa: 'Your company', mensaje: 'Tell us what you need...', email: 'your@email.com' }
  };
  Object.entries(placeholders[lang]).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.placeholder = text;
  });
}
