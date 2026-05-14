// =====================================================
// AUTH HELPERS
// =====================================================

// Sync redirect — runs before anything renders
(function() {
  if (window.location.pathname.includes('login.html')) return;
  if (!localStorage.getItem('auth_token')) window.location.href = '/login.html';
})();

function getToken() {
  return localStorage.getItem('auth_token');
}

function getAuthHeaders(extra = {}) {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}`, ...extra } : { ...extra };
}

// Returns user from localStorage immediately (sync), then validates token in background.
// If token is invalid the next API call will get 401 and redirect to login.
function checkAuth(allowedRoles = null) {
  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return null; }

  const user = {
    id:     localStorage.getItem('auth_id')     || '',
    nombre: localStorage.getItem('auth_nombre') || 'Usuario',
    email:  localStorage.getItem('auth_email')  || '',
    rol:    localStorage.getItem('auth_rol')    || 'ADMIN',
    clienteIds: JSON.parse(localStorage.getItem('auth_clienteIds') || 'null')
  };

  if (allowedRoles && !allowedRoles.includes(user.rol)) {
    const redirectMap = { OPERADOR: 'operacion.html', CLIENTE: 'index.html', LOGISTICA: 'trackings.html' };
    window.location.href = redirectMap[user.rol] || 'index.html';
    return null;
  }

  // Background token validation
  fetch('/api/auth/me', { headers: getAuthHeaders() })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(me => {
      localStorage.setItem('auth_id',        me.id);
      localStorage.setItem('auth_nombre',    me.nombre);
      localStorage.setItem('auth_email',     me.email);
      localStorage.setItem('auth_rol',       me.rol);
      localStorage.setItem('auth_clienteIds', JSON.stringify(me.clienteIds));
    })
    .catch(status => {
      if (status === 401 || status === 403) {
        ['auth_token','auth_id','auth_nombre','auth_email','auth_rol','auth_clienteIds'].forEach(k => localStorage.removeItem(k));
        window.location.href = '/login.html';
      }
    });

  return user;
}

async function logout() {
  try { await API.post('/auth/logout', {}); } catch(e) {}
  ['auth_token','auth_id','auth_nombre','auth_email','auth_rol','auth_clienteIds'].forEach(k => localStorage.removeItem(k));
  window.location.href = '/login.html';
}

// =====================================================
// API CLIENT
// =====================================================
const API = {
  base: '/api',

  async _parseError(res) {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (res.status === 401) {
        localStorage.removeItem('auth_token');
        if (!window.location.pathname.includes('login.html')) window.location.href = '/login.html';
      }
      return data;
    } catch {
      return { error: `Error ${res.status} del servidor. Verifica que el servidor esté corriendo.` };
    }
  },

  async get(path) {
    const res = await fetch(this.base + path, { headers: getAuthHeaders() });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async post(path, data) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async postForm(path, formData) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData
    });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async put(path, data) {
    const res = await fetch(this.base + path, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  },

  async del(path) {
    const res = await fetch(this.base + path, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw await this._parseError(res);
    return res.json();
  }
};

// =====================================================
// XSS HELPER — escape user-provided text before innerHTML insertion
// =====================================================
function escHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    if (href && href === current) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// =====================================================
// GRADO LABELS
// =====================================================
function gradoBadge(grado) {
  const classes = { 1: 'grado-1', 2: 'grado-2', 3: 'grado-3' };
  const cls = classes[grado] || 'grado-2';
  const label = (typeof t === 'function') ? t(`grade.${grado}`) : `G${grado}`;
  return `<span class="grado-badge ${cls}">${label}</span>`;
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

// =====================================================
// LIGHTBOX (foto viewer + descarga)
// =====================================================
let _lbFotos = [];
let _lbIdx   = 0;

function verFoto(src, titulo, grupoId) {
  if (!document.getElementById('lightbox-overlay')) _crearLightbox();

  if (grupoId && window._fotoGrupos?.[grupoId]) {
    _lbFotos = window._fotoGrupos[grupoId];
    _lbIdx   = _lbFotos.findIndex(f => f.src === src);
    if (_lbIdx < 0) _lbIdx = 0;
  } else {
    _lbFotos = [{ src, titulo }];
    _lbIdx   = 0;
  }

  _lbMostrar(_lbIdx);
  document.getElementById('lightbox-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function _lbMostrar(idx) {
  const foto = _lbFotos[idx];
  document.getElementById('lightbox-img').src = foto.src;
  document.getElementById('lightbox-title').textContent = foto.titulo || '';

  const dl = document.getElementById('lightbox-download');
  dl.href = foto.src;
  dl.download = foto.src.split('/').pop();

  const multi = _lbFotos.length > 1;
  document.getElementById('lightbox-counter').textContent = multi ? `${idx + 1} / ${_lbFotos.length}` : '';
  document.getElementById('lightbox-prev').classList.toggle('hidden', !multi);
  document.getElementById('lightbox-next').classList.toggle('hidden', !multi);
}

function _lbNav(dir) {
  _lbIdx = (_lbIdx + dir + _lbFotos.length) % _lbFotos.length;
  _lbMostrar(_lbIdx);
}

function cerrarLightbox() {
  document.getElementById('lightbox-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

function _crearLightbox() {
  const el = document.createElement('div');
  el.id = 'lightbox-overlay';
  el.innerHTML = `
    <div id="lightbox-inner">
      <div id="lightbox-toolbar">
        <span id="lightbox-title"></span>
        <span id="lightbox-counter"></span>
        <div id="lightbox-actions">
          <a id="lightbox-download" href="#" class="lightbox-btn lightbox-btn-primary" download>↓ Descargar</a>
          <button class="lightbox-btn" onclick="cerrarLightbox()">✕ Cerrar</button>
        </div>
      </div>
      <div id="lightbox-img-wrap">
        <button id="lightbox-prev" class="lightbox-nav prev hidden" onclick="event.stopPropagation();_lbNav(-1)">‹</button>
        <img id="lightbox-img" onclick="event.stopPropagation()" alt="Foto ampliada">
        <button id="lightbox-next" class="lightbox-nav next hidden" onclick="event.stopPropagation();_lbNav(1)">›</button>
      </div>
    </div>
  `;
  el.addEventListener('click', e => { if (e.target === el) cerrarLightbox(); });
  document.body.appendChild(el);

  document.addEventListener('keydown', e => {
    if (!document.getElementById('lightbox-overlay')?.classList.contains('open')) return;
    if (e.key === 'Escape') cerrarLightbox();
    if (e.key === 'ArrowLeft')  _lbNav(-1);
    if (e.key === 'ArrowRight') _lbNav(1);
  });
}

// DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setActivePage();
});
