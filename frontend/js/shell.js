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
  btn.querySelector('.theme-label').textContent = isDark ? 'MODO CLARO' : 'MODO OSCURO';
  // swap icon: moon for dark (switch to light), sun for light (switch to dark)
  btn.querySelector('.theme-icon').innerHTML = isDark
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

// Shared layout builder
function buildShell(pageTitle, breadcrumb, topbarActions = '') {
  const nav = [
    { page: 'index.html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`, label: 'Dashboard' },
    { page: 'trackings.html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`, label: 'Trackings' },
    { page: 'operacion.html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`, label: 'Operación / Inspección', section: 'OPERACIÓN' },
    { page: 'clientes.html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, label: 'Clientes', section: 'ADMINISTRACIÓN' },
    { page: 'skus.html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`, label: 'Catálogo SKUs' },
    { page: 'reportes.html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`, label: 'Reportes / Manifiestos' },
  ];

  const current = window.location.pathname.split('/').pop() || 'index.html';
  let lastSection = '';

  let navHtml = nav.map(item => {
    let sectionHtml = '';
    if (item.section && item.section !== lastSection) {
      sectionHtml = `<div class="nav-section-label">${item.section}</div>`;
      lastSection = item.section;
    }
    const isActive = item.page === current;
    return `${sectionHtml}<a href="${item.page}" class="nav-item ${isActive ? 'active' : ''}" data-page="${item.page}">
      ${item.icon}
      <span>${item.label}</span>
    </a>`;
  }).join('');

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
          <button class="theme-toggle-btn" id="theme-toggle-btn" onclick="toggleTheme()">
            <span class="theme-icon"></span>
            <span class="theme-label"></span>
            <span class="theme-toggle-dot"></span>
          </button>
          <div class="sidebar-version">v1.0.0 — 2025</div>
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
}
