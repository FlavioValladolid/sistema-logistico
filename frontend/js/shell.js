// ── THEME ──
(function() {
  const t = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  _updateThemeBtn(next);
}

function _updateThemeBtn(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  const isDark = theme === 'dark';
  btn.querySelector('.theme-label').textContent = isDark ? t('shell.light_mode') : t('shell.dark_mode');
  btn.querySelector('.theme-icon').innerHTML = isDark
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

const ROL_LABELS = { ADMIN: 'Admin', SUPERVISOR: 'Supervisor', OPERADOR: 'Operador', CLIENTE: 'Cliente', LOGISTICA: 'Logística' };
const ROL_COLORS = { ADMIN: '#e74c3c', SUPERVISOR: '#e67e22', OPERADOR: '#3498db', CLIENTE: '#27ae60', LOGISTICA: '#8e44ad' };

// Shared layout builder
function buildShell(pageTitle, breadcrumb, topbarActions = '', usuario = null) {
  const ALL_NAV = [
    { page: 'index.html',      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`, labelKey: 'nav.dashboard', roles: ['ADMIN','SUPERVISOR','CLIENTE','LOGISTICA','OPERADOR'] },
    { page: 'trackings.html',  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`, labelKey: 'nav.trackings', roles: ['ADMIN','SUPERVISOR','CLIENTE','LOGISTICA','OPERADOR'] },
    { page: 'operacion.html',  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`, labelKey: 'nav.operacion',  sectionKey: 'nav.section.operacion', roles: ['ADMIN','SUPERVISOR','OPERADOR'] },
    { page: 'retrabajo.html',  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`, labelKey: 'nav.retrabajos', roles: ['ADMIN','SUPERVISOR','OPERADOR'] },
    { page: 'clientes.html',   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, labelKey: 'nav.clientes',   sectionKey: 'nav.section.admin', roles: ['ADMIN','SUPERVISOR'] },
    { page: 'cajas.html',      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`, labelKey: 'nav.cajas', roles: ['ADMIN','SUPERVISOR','LOGISTICA','OPERADOR'] },
    { page: 'skus.html',       icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`, labelKey: 'nav.skus', roles: ['ADMIN','SUPERVISOR'] },
    { page: 'skus-nuevos.html',icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`, labelKey: 'nav.skus_nuevos', roles: ['ADMIN','SUPERVISOR'] },
    { page: 'ordenes.html',     icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="12" y1="9" x2="8" y2="9"/><line x1="12" y1="17" x2="8" y2="17"/></svg>`, labelKey: 'nav.ordenes', roles: ['ADMIN','SUPERVISOR','CLIENTE'] },
    { page: 'reportes.html',   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`, labelKey: 'nav.reportes', roles: ['ADMIN','SUPERVISOR','CLIENTE','LOGISTICA','OPERADOR'] },
    { page: 'usuarios.html',      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="18" cy="8" r="3"/><path d="M22 20c0-2.7-2-4.7-4-5.4"/></svg>`, labelKey: 'nav.usuarios', sectionKey: 'nav.section.sistema', roles: ['ADMIN'] },
    { page: 'email-config.html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`, labelKey: 'nav.email_config', roles: ['ADMIN'] },
  ];

  const rol = usuario?.rol || 'ADMIN';
  const nav = ALL_NAV.filter(item => item.roles.includes(rol));

  const current = window.location.pathname.split('/').pop() || 'index.html';
  let lastSection = '';

  let navHtml = nav.map(item => {
    let sectionHtml = '';
    const sectionKey = item.sectionKey || '';
    if (sectionKey && sectionKey !== lastSection) {
      sectionHtml = `<div class="nav-section-label">${t(sectionKey)}</div>`;
      lastSection = sectionKey;
    }
    const isActive = item.page === current;
    return `${sectionHtml}<a href="${item.page}" class="nav-item ${isActive ? 'active' : ''}" data-page="${item.page}">
      ${item.icon}
      <span>${t(item.labelKey)}</span>
    </a>`;
  }).join('');

  const userBlock = usuario ? `
    <div style="padding:10px 14px;border-top:1px solid var(--border);margin-top:4px">
      <div style="font-size:11px;color:var(--text-muted);font-family:'IBM Plex Mono',monospace;margin-bottom:4px">${t('shell.session')}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${usuario.nombre}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:${ROL_COLORS[usuario.rol] || '#666'};color:#fff;font-family:'IBM Plex Mono',monospace">${ROL_LABELS[usuario.rol] || usuario.rol}</span>
      </div>
      <button onclick="logout()" style="margin-top:10px;width:100%;padding:6px 8px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--text-secondary);font-size:11px;cursor:pointer;font-family:'IBM Plex Mono',monospace;transition:all .15s" onmouseover="this.style.borderColor='var(--accent-red)';this.style.color='var(--accent-red)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)'">${t('shell.logout')}</button>
    </div>
  ` : '';

  document.body.innerHTML = `
    <div id="toast-container"></div>

    <!-- Confirm Dialog -->
    <div id="confirm-overlay" class="modal-overlay">
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <span class="modal-title" id="confirm-title">Confirmar</span>
        </div>
        <div class="modal-body">
          <p id="confirm-message" style="color:var(--text-secondary);line-height:1.6"></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="confirm-no">Cancelar</button>
          <button class="btn btn-danger" id="confirm-yes">Confirmar</button>
        </div>
      </div>
    </div>

    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-mark">
            <div class="logo-icon">
              <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </div>
            <div>
              <div class="logo-text">LOGÍSTICA</div>
              <div class="logo-sub">Sistema de Inspección</div>
            </div>
          </div>
        </div>
        <nav class="sidebar-nav">
          <div class="nav-section-label">PRINCIPAL</div>
          ${navHtml}
        </nav>
        <div class="sidebar-footer">
          ${userBlock}
          <button class="theme-toggle-btn" id="theme-toggle-btn" onclick="toggleTheme()">
            <span class="theme-icon"></span>
            <span class="theme-label"></span>
            <span class="theme-toggle-dot"></span>
          </button>
          <button class="theme-toggle-btn" id="lang-toggle-btn" onclick="toggleLang()" style="margin-top:6px">
            <span class="theme-icon" style="font-size:14px;display:flex;align-items:center">🌐</span>
            <span id="lang-label" style="flex:1;font-size:10px;font-weight:700;letter-spacing:.08em;font-family:'IBM Plex Mono',monospace"></span>
            <span style="font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--text-muted);font-weight:700" id="lang-current"></span>
          </button>
          <div class="sidebar-version">v1.0.0 — 2026</div>
        </div>
      </aside>

      <div class="main-content">
        <header class="topbar">
          <div class="topbar-breadcrumb">SISTEMA / <span>${breadcrumb}</span></div>
          <div class="topbar-actions">${topbarActions}</div>
        </header>
        <main class="page-content" id="page-content">
          <!-- page injected here -->
        </main>
      </div>
    </div>
  `;

  // Re-bind confirm helpers after DOM rebuild
  setActivePage();
  _updateThemeBtn(document.documentElement.getAttribute('data-theme') || 'dark');
  _updateLangBtn(window._LANG || 'es');
}

function _updateLangBtn(lang) {
  const label = document.getElementById('lang-label');
  const current = document.getElementById('lang-current');
  if (!label) return;
  label.textContent = t('shell.lang_switch');
  current.textContent = lang.toUpperCase();
}
