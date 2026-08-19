// Lógica del nav compartida por todas las páginas (Theme & i18n Language)

function setTheme(theme) {
  const html = document.documentElement;
  const icon = document.getElementById('theme-icon');
  html.setAttribute('data-theme', theme);
  if (icon) {
    icon.className = theme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
  }
  try {
    localStorage.setItem('evo_theme', theme);
  } catch (e) {}
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

function setLang(lang) {
  const html = document.documentElement;
  const btn = document.getElementById('lang-btn');
  html.setAttribute('data-lang', lang);
  html.setAttribute('lang', lang);
  if (btn) {
    btn.textContent = lang === 'es' ? 'EN' : 'ES';
  }
  applyLang(lang);
  try {
    localStorage.setItem('evo_lang', lang);
  } catch (e) {}
}

function toggleLang() {
  const html = document.documentElement;
  const current = html.getAttribute('data-lang') || 'es';
  const next = current === 'es' ? 'en' : 'es';
  setLang(next);
}

// Swap genérico de data-es/data-en y data-es-ph/data-en-ph para cualquier página
function applyLang(lang) {
  // 1. Text contents
  document.querySelectorAll('[data-es]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text !== null) el.innerHTML = text;
  });

  // 2. Placeholders
  document.querySelectorAll('[data-es-ph]').forEach(el => {
    const ph = el.getAttribute('data-' + lang + '-ph');
    if (ph !== null) el.placeholder = ph;
  });

  // 3. Contact Form placeholders fallback (homepage)
  const placeholders = {
    es: { nombre: 'Tu nombre', empresa: 'Tu empresa', mensaje: 'Cuéntanos qué necesitas...', email: 'tu@email.com' },
    en: { nombre: 'Your name', empresa: 'Your company', mensaje: 'Tell us what you need...', email: 'your@email.com' }
  };
  if (placeholders[lang]) {
    Object.entries(placeholders[lang]).forEach(([id, text]) => {
      const el = document.getElementById(id);
      if (el) el.placeholder = text;
    });
  }
}

// Inicialización inmediata al cargar
(function initNavPreferences() {
  try {
    // Check saved theme
    const savedTheme = localStorage.getItem('evo_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }

    // Check saved language
    const savedLang = localStorage.getItem('evo_lang');
    if (savedLang === 'en' || savedLang === 'es') {
      setLang(savedLang);
    }
  } catch (e) {}
})();
