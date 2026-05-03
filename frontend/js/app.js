// =====================================================
// API CLIENT
// =====================================================
const API = {
  base: '/api',

  async _parseError(res) {
    const text = await res.text();
    try { return JSON.parse(text); } catch {
      return { error: `Error ${res.status} del servidor. Verifica que el servidor esté corriendo.` };
    }
  },

  async get(path) {
    const res = await fetch(this.base + path);
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async post(path, data) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async postForm(path, formData) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async put(path, data) {
    const res = await fetch(this.base + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async del(path) {
    const res = await fetch(this.base + path, { method: 'DELETE' });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  }
};

// =====================================================
// TOAST NOTIFICATIONS
// =====================================================
function toast(message, type = 'success') {
  const container = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();

  const icons = { success: '✓', error: '✕', warning: '⚠' };
  const el = document.createElement('div');
  el.className = `toast ${type !== 'success' ? type : ''}`;
  el.innerHTML = `<span style="font-weight:700;font-family:'IBM Plex Mono',monospace">${icons[type] || '•'}</span> ${message}`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = '0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// =====================================================
// MODAL HELPERS
// =====================================================
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// =====================================================
// NAVIGATION
// =====================================================
function navigateTo(page) {
  window.location.href = page;
}

function setActivePage() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('data-page') || item.getAttribute('href');
    if (href && (href === current || href.includes(current.replace('.html', '')))) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// =====================================================
// GRADO LABELS
// =====================================================
const GRADO_INFO = {
  1: { label: 'G1 – Flujo Rápido', class: 'grado-1', desc: 'Solo datos logísticos' },
  2: { label: 'G2 – Muestreo', class: 'grado-2', desc: 'Inspección estadística 30%' },
  3: { label: 'G3 – Control Total', class: 'grado-3', desc: 'Inspección 100% obligatoria' },
};

function gradoBadge(grado) {
  const info = GRADO_INFO[grado] || GRADO_INFO[2];
  return `<span class="grado-badge ${info.class}">${info.label}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('es-MX');
}

// =====================================================
// CONFIRM DIALOG
// =====================================================
function confirm(message, title = '¿Confirmar acción?') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    if (!overlay) {
      // Inline fallback
      resolve(window.confirm(message));
      return;
    }
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    overlay.classList.add('open');

    const yes = document.getElementById('confirm-yes');
    const no = document.getElementById('confirm-no');

    const cleanup = () => { overlay.classList.remove('open'); yes.onclick = null; no.onclick = null; };
    yes.onclick = () => { cleanup(); resolve(true); };
    no.onclick = () => { cleanup(); resolve(false); };
  });
}

// DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setActivePage();
});
