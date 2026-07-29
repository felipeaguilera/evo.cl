// Anti-spam: stamp the form with the load time, checked server-side
const tsField = document.getElementById('form-ts');
if (tsField) tsField.value = Date.now();

// Contact form — AJAX, no redirect
document.querySelector('.contact-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = this;
  const btn = form.querySelector('button[type="submit"]');
  const lang = document.documentElement.getAttribute('data-lang') || 'es';

  btn.disabled = true;
  btn.innerHTML = lang === 'es'
    ? '<span>Enviando...</span>'
    : '<span>Sending...</span>';

  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    });

    if (res.ok) {
      form.innerHTML = lang === 'es'
        ? '<p class="form-thanks">Mensaje enviado. Te contactamos en menos de 24 horas.</p>'
        : '<p class="form-thanks">Message sent. We\'ll be in touch within 24 hours.</p>';
    } else {
      showFormError(form, btn, lang);
    }
  } catch(err) {
    showFormError(form, btn, lang);
  }
});

function showFormError(form, btn, lang) {
  btn.disabled = false;
  btn.innerHTML = lang === 'es'
    ? '<span>Enviar mensaje</span><i class="ph ph-arrow-right"></i>'
    : '<span>Send message</span><i class="ph ph-arrow-right"></i>';
  let errMsg = form.querySelector('.form-error');
  if (!errMsg) {
    errMsg = document.createElement('p');
    errMsg.className = 'form-error';
    btn.before(errMsg);
  }
  errMsg.textContent = lang === 'es'
    ? 'Hubo un error al enviar. Escríbenos por WhatsApp.'
    : 'Something went wrong. Please reach out via WhatsApp.';
}
