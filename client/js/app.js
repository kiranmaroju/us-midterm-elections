/**
 * US Midterm Elections 2026 - PWA Application Client
 * Real-time data synchronization, routing, and Admin Studio
 */

let state = {
  overview: null,
  races: [],
  candidates: [],
  news: [],
  config: {},
  adminToken: localStorage.getItem('usmidterm_admin_token') || 'Midterm2026!AdminSec#',
  currentFilter: 'all',
  theme: localStorage.getItem('usmidterm_theme') || 'dark'
};

// -------------------------------------------------------------
// PWA Service Worker Registration
// -------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[PWA] Service Worker active:', reg.scope))
      .catch(err => console.log('[PWA] Service Worker reg failed:', err));
  });
}

// -------------------------------------------------------------
// Theme Management
// -------------------------------------------------------------
function initTheme() {
  if (state.theme === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('theme-toggle').textContent = '☀️';
  } else {
    document.body.classList.remove('light-theme');
    document.getElementById('theme-toggle').textContent = '🌙';
  }

  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('usmidterm_theme', state.theme);
    initTheme();
  });
}

// -------------------------------------------------------------
// Router & View Switcher
// -------------------------------------------------------------
function handleRouting() {
  const hash = window.location.hash || '#overview';
  const views = document.querySelectorAll('.app-view');
  views.forEach(v => v.style.display = 'none');

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(n => n.classList.remove('active'));

  if (hash.startsWith('#race/')) {
    const raceId = hash.replace('#race/', '');
    openRaceModal(raceId);
    document.getElementById('view-overview').style.display = 'block';
    document.querySelector('.nav-item[href="#overview"]')?.classList.add('active');
    return;
  }

  const activeNav = document.querySelector(`.nav-item[href="${hash}"]`);
  if (activeNav) {
    activeNav.classList.add('active');
  }

  switch (hash) {
    case '#senate':
      document.getElementById('view-senate').style.display = 'block';
      loadSenateView();
      break;
    case '#house':
      document.getElementById('view-house').style.display = 'block';
      loadHouseView();
      break;
    case '#news':
      document.getElementById('view-news').style.display = 'block';
      loadNewsView();
      break;
    case '#admin':
      document.getElementById('view-admin').style.display = 'block';
      initAdminView();
      break;
    case '#overview':
    default:
      document.getElementById('view-overview').style.display = 'block';
      loadOverview();
      break;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('hashchange', handleRouting);

// -------------------------------------------------------------
// Data Fetching & Overview
// -------------------------------------------------------------
async function loadOverview() {
  try {
    const res = await fetch('/api/overview');
    if (!res.ok) return;
    const data = await res.json();
    state.overview = data;

    // Senate Balance & Overall Position
    const senate = data.national.senate;
    if (senate.demProb !== null && senate.repProb !== null) {
      document.getElementById('senate-odds-display').style.display = 'block';
      document.getElementById('senate-no-odds').style.display = 'none';
      document.getElementById('senate-dem-prob').textContent = `${senate.demProb}%`;
      document.getElementById('senate-rep-prob').textContent = `${senate.repProb}%`;
      document.getElementById('bar-senate-dem').style.width = `${senate.demProb}%`;
      document.getElementById('bar-senate-rep').style.width = `${senate.repProb}%`;
    } else {
      document.getElementById('senate-odds-display').style.display = 'none';
      document.getElementById('senate-no-odds').style.display = 'block';
    }

    // House Balance & Overall Position
    const house = data.national.house;
    if (house.demProb !== null && house.repProb !== null) {
      document.getElementById('house-odds-display').style.display = 'block';
      document.getElementById('house-no-odds').style.display = 'none';
      document.getElementById('house-dem-prob').textContent = `${house.demProb}%`;
      document.getElementById('house-rep-prob').textContent = `${house.repProb}%`;
      document.getElementById('bar-house-dem').style.width = `${house.demProb}%`;
      document.getElementById('bar-house-rep').style.width = `${house.repProb}%`;
    } else {
      document.getElementById('house-odds-display').style.display = 'none';
      document.getElementById('house-no-odds').style.display = 'block';
    }

    // Render Top Battlegrounds
    renderTopBattlegrounds(data.topBattlegrounds);

    // Render Overview News
    renderOverviewNews(data.breakingNews);

    // Render Hex Map
    renderHexMap(data.topBattlegrounds);

  } catch (err) {
    console.error('Error loading overview:', err);
  }
}

function renderTopBattlegrounds(races) {
  const container = document.getElementById('top-battlegrounds-grid');
  if (!races || races.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-dim)">No battlegrounds found.</div>`;
    return;
  }

  container.innerHTML = races.map(r => {
    const hasOdds = r.dem_win_prob !== null && r.dem_win_prob !== undefined && r.rep_win_prob !== null && r.rep_win_prob !== undefined;
    const badgeClass = r.rating === 'tossup' ? 'badge-toss' : r.rating.includes('d') ? 'badge-dem' : 'badge-rep';
    const ratingLabel = r.rating.replace('_', ' ').toUpperCase();

    return `
      <div class="race-card" onclick="location.hash='#race/${r.id}'">
        <div class="race-header">
          <span class="state-flag">${r.state_code} • ${r.title.replace('2026 ', '')}</span>
          <span class="badge ${badgeClass}">${ratingLabel}</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">
          Current Incumbent: <strong style="color:var(--text-main);">${r.current_holder_party || 'Contested'}</strong>
        </div>
        ${hasOdds ? `
          <div class="bar-track" style="height: 12px;">
            <div class="bar-segment-dem" style="width: ${r.dem_win_prob}%;"></div>
            <div class="bar-segment-rep" style="width: ${r.rep_win_prob}%;"></div>
          </div>
          <div class="prob-meter">
            <span style="color:var(--dem-blue);">Dem: ${r.dem_win_prob}%</span>
            <span style="color:var(--rep-red);">Rep: ${r.rep_win_prob}%</span>
          </div>
        ` : `
          <div style="font-size:0.72rem; color:var(--text-dim); margin-top:8px; padding:6px; background:var(--bg-surface); border-radius:var(--radius-sm); text-align:center;">
            ⏳ Prediction Market Odds Pending
          </div>
        `}
      </div>
    `;
  }).join('');
}

function renderOverviewNews(articles) {
  const container = document.getElementById('overview-news-list');
  if (!articles || articles.length === 0) {
    container.innerHTML = `<div style="padding:10px;color:var(--text-dim);">Fetching live political wire...</div>`;
    return;
  }

  container.innerHTML = articles.slice(0, 4).map(a => `
    <a href="${a.url}" target="_blank" rel="noopener noreferrer" class="news-item">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="news-source">${a.source_name}</span>
        ${a.tagged_state ? `<span class="badge badge-toss">${a.tagged_state}</span>` : ''}
      </div>
      <div class="news-title">${a.title}</div>
      <div class="news-time">${new Date(a.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Non-partisan campaign wire</div>
    </a>
  `).join('');
}

// Interactive Hex Cartogram
function renderHexMap(battlegrounds) {
  const container = document.getElementById('hex-grid-container');
  // State layout matrix (50 US States representation)
  const states = [
    'WA','ID','MT','ND','MN','IL','WI','MI','NY','VT','ME',
    'OR','NV','WY','SD','IA','IN','OH','PA','NJ','MA','NH',
    'CA','UT','CO','NE','MO','KY','WV','VA','MD','DE','CT',
    'AZ','NM','KS','AR','TN','NC','SC','DC','RI',
    'TX','OK','LA','MS','AL','GA','FL','AK','HI'
  ];

  const bgMap = new Map();
  (battlegrounds || []).forEach(b => bgMap.set(b.state_code, b));

  container.innerHTML = states.slice(0, 44).map(st => {
    const bg = bgMap.get(st);
    let colorClass = 'hex-node';
    if (bg) {
      if (bg.dem_win_prob > bg.rep_win_prob + 5) colorClass += ' hex-dem';
      else if (bg.rep_win_prob > bg.dem_win_prob + 5) colorClass += ' hex-rep';
      else colorClass += ' hex-toss';
    }

    const clickAction = bg ? `onclick="location.hash='#race/${bg.id}'"` : `onclick="alert('${st} Contested Seat (Class II/House)')"`;
    return `<div class="${colorClass}" ${clickAction} title="${st}">${st}</div>`;
  }).join('');
}

// -------------------------------------------------------------
// Senate Races View
// -------------------------------------------------------------
async function loadSenateView() {
  try {
    const res = await fetch('/api/races?chamber=senate');
    const races = await res.json();
    state.races = races;
    renderSenateGrid(races);

    document.getElementById('senate-search-input').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = races.filter(r => r.title.toLowerCase().includes(q) || r.state_code.toLowerCase().includes(q));
      renderSenateGrid(filtered);
    };
  } catch (err) {
    console.error('Error loading Senate races:', err);
  }
}

function filterSenateRaces(filter) {
  state.currentFilter = filter;
  let filtered = [...state.races];
  if (filter === 'battleground') filtered = filtered.filter(r => r.is_battleground);
  else if (filter === 'tossup') filtered = filtered.filter(r => r.rating === 'tossup');
  else if (filter === 'lean_d') filtered = filtered.filter(r => r.rating === 'lean_d' || r.rating === 'solid_d');
  else if (filter === 'lean_r') filtered = filtered.filter(r => r.rating === 'lean_r' || r.rating === 'solid_r');
  renderSenateGrid(filtered);
}

function renderSenateGrid(races) {
  const container = document.getElementById('senate-races-grid');
  if (!races || races.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-dim);">No races match the filter.</div>`;
    return;
  }

  container.innerHTML = races.map(r => {
    const hasOdds = r.dem_win_prob !== null && r.dem_win_prob !== undefined && r.rep_win_prob !== null && r.rep_win_prob !== undefined;
    return `
      <div class="race-card" onclick="location.hash='#race/${r.id}'">
        <div class="race-header">
          <span class="state-flag">${r.state_code} • ${r.title.replace('2026 ', '')}</span>
          <span class="badge ${r.rating === 'tossup' ? 'badge-toss' : r.rating.includes('d') ? 'badge-dem' : 'badge-rep'}">${r.rating.replace('_', ' ').toUpperCase()}</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">
          Incumbent: <strong>${r.current_holder_party || 'Contested'}</strong>
        </div>
        ${hasOdds ? `
          <div class="bar-track" style="height: 12px;">
            <div class="bar-segment-dem" style="width: ${r.dem_win_prob}%;"></div>
            <div class="bar-segment-rep" style="width: ${r.rep_win_prob}%;"></div>
          </div>
          <div class="prob-meter">
            <span style="color:var(--dem-blue);">Dem: ${r.dem_win_prob}%</span>
            <span style="color:var(--rep-red);">Rep: ${r.rep_win_prob}%</span>
          </div>
        ` : `
          <div style="font-size:0.72rem; color:var(--text-dim); margin-top:8px; padding:6px; background:var(--bg-surface); border-radius:var(--radius-sm); text-align:center;">
            ⏳ Prediction Market Odds Pending
          </div>
        `}
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------
// House Races View
// -------------------------------------------------------------
async function loadHouseView() {
  try {
    const res = await fetch('/api/races?chamber=house');
    const races = await res.json();
    const container = document.getElementById('house-races-grid');

    const render = (list) => {
      container.innerHTML = list.map(r => `
        <div class="race-card" onclick="location.hash='#race/${r.id}'">
          <div class="race-header">
            <span class="state-flag">${r.title}</span>
            <span class="badge badge-toss">District ${r.district_num || 1}</span>
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted);">
            Incumbent Party: <strong style="color:var(--text-main);">${r.current_holder_party || 'Competitive'}</strong>
          </div>
        </div>
      `).join('');
    };

    render(races);

    document.getElementById('house-search-input').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      render(races.filter(r => r.title.toLowerCase().includes(q) || r.state_code.toLowerCase().includes(q)));
    };
  } catch (err) {
    console.error('Error loading House races:', err);
  }
}

// -------------------------------------------------------------
// Live News View
// -------------------------------------------------------------
async function loadNewsView() {
  try {
    const res = await fetch('/api/news?limit=40');
    const articles = await res.json();
    state.news = articles;
    renderFullNews(articles);

    document.getElementById('news-search-input').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      renderFullNews(articles.filter(a => a.title.toLowerCase().includes(q) || (a.summary || '').toLowerCase().includes(q)));
    };
  } catch (err) {
    console.error('Error loading news:', err);
  }
}

function renderFullNews(articles) {
  const container = document.getElementById('full-news-list');
  container.innerHTML = articles.map(a => `
    <a href="${a.url}" target="_blank" rel="noopener noreferrer" class="news-item">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="news-source">${a.source_name}</span>
        ${a.tagged_state ? `<span class="badge badge-toss">${a.tagged_state}</span>` : ''}
      </div>
      <div class="news-title">${a.title}</div>
      <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${a.summary || ''}</p>
      <div class="news-time">${new Date(a.published_at).toLocaleString()} • Verified Source</div>
    </a>
  `).join('');
}

// -------------------------------------------------------------
// Race Detail Modal
// -------------------------------------------------------------
async function openRaceModal(raceId) {
  try {
    const res = await fetch(`/api/races/${raceId}`);
    if (!res.ok) return;
    const data = await res.json();
    const { race, candidates, faqs } = data;

    document.getElementById('modal-race-title').textContent = race.title;
    document.getElementById('modal-race-rating').textContent = race.rating.replace('_', ' ').toUpperCase();

    const hasOdds = race.dem_win_prob !== null && race.dem_win_prob !== undefined && race.rep_win_prob !== null && race.rep_win_prob !== undefined;
    if (hasOdds) {
      document.getElementById('modal-dem-prob').textContent = `${race.dem_win_prob}%`;
      document.getElementById('modal-rep-prob').textContent = `${race.rep_win_prob}%`;
      document.getElementById('modal-bar-dem').style.width = `${race.dem_win_prob}%`;
      document.getElementById('modal-bar-rep').style.width = `${race.rep_win_prob}%`;
    } else {
      document.getElementById('modal-dem-prob').textContent = `Pending`;
      document.getElementById('modal-rep-prob').textContent = `Pending`;
      document.getElementById('modal-bar-dem').style.width = `0%`;
      document.getElementById('modal-bar-rep').style.width = `0%`;
    }

    // Candidates Showdown
    const cContainer = document.getElementById('modal-candidates-container');
    if (candidates.length === 0) {
      cContainer.innerHTML = `<div style="grid-column: span 2; text-align:center; padding:12px; color:var(--text-dim);">Awaiting official certified filings.</div>`;
    } else {
      cContainer.innerHTML = candidates.map(c => `
        <div class="candidate-box">
          <img src="${c.photo_url || 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png'}" 
               alt="${c.full_name}" class="candidate-photo" 
               onerror="this.src='https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png'">
          <div class="candidate-name">${c.full_name}</div>
          <div class="candidate-party" style="color:${c.party === 'Democrat' ? 'var(--dem-blue)' : 'var(--rep-red)'}; font-weight:700;">
            ${c.party} ${c.is_incumbent ? '• (Incumbent)' : ''}
          </div>
          <p style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;">${c.bio_snippet || ''}</p>
          ${c.campaign_website ? `<a href="${c.campaign_website}" target="_blank" style="display:inline-block; margin-top:8px; font-size:0.72rem; color:var(--dem-blue);">Official Site ↗</a>` : ''}
        </div>
      `).join('');
    }

    // FAQs for AI & User Insight
    const faqContainer = document.getElementById('modal-faq-container');
    faqContainer.innerHTML = faqs.map(f => `
      <div style="background:var(--bg-surface); padding:10px; border-radius:var(--radius-sm); margin-bottom:8px;">
        <div style="font-weight:700; color:var(--text-main); margin-bottom:3px;">Q: ${f.question}</div>
        <div>A: ${f.answer}</div>
      </div>
    `).join('');

    document.getElementById('race-modal').style.display = 'flex';
  } catch (err) {
    console.error('Error opening race modal:', err);
  }
}

function closeModal() {
  document.getElementById('race-modal').style.display = 'none';
  if (window.location.hash.startsWith('#race/')) {
    location.hash = '#overview';
  }
}

// -------------------------------------------------------------
// Admin Studio Management
// -------------------------------------------------------------
function unlockAdminPortal() {
  const input = document.getElementById('admin-key-input').value;
  state.adminToken = input;
  localStorage.setItem('usmidterm_admin_token', input);
  initAdminView();
}

async function initAdminView() {
  const headers = { 'Authorization': `Bearer ${state.adminToken}` };
  try {
    const res = await fetch('/api/admin/jobs', { headers });
    if (!res.ok) {
      document.getElementById('admin-login-box').style.display = 'block';
      document.getElementById('admin-dashboard-panel').style.display = 'none';
      return;
    }

    document.getElementById('admin-login-box').style.display = 'none';
    document.getElementById('admin-dashboard-panel').style.display = 'block';

    loadAdminJobs();
    loadAuditLogs();
    loadAdminCandidates();
    loadSiteConfig();

    // Stats
    const ovRes = await fetch('/api/overview');
    const ov = await ovRes.json();
    document.getElementById('stat-races').textContent = ov.totalRaces;
    document.getElementById('stat-candidates').textContent = ov.totalCandidates;
    document.getElementById('stat-news').textContent = ov.breakingNews.length;

  } catch (err) {
    console.error('Admin init error:', err);
  }
}

async function loadAdminJobs() {
  const headers = { 'Authorization': `Bearer ${state.adminToken}` };
  const res = await fetch('/api/admin/jobs', { headers });
  const jobs = await res.json();

  const container = document.getElementById('admin-jobs-list');
  container.innerHTML = jobs.map(j => `
    <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:12px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="display:flex; align-items:center; gap:8px;">
          <strong>${j.name}</strong>
          <span class="badge ${j.status === 'RUNNING' ? 'badge-toss' : j.status === 'SUCCESS' ? 'badge-dem' : 'badge-rep'}">${j.status}</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${j.description}</div>
        <div style="font-size:0.72rem; color:var(--text-dim); margin-top:4px;">
          Interval: Every ${j.schedule_interval_mins}m • Last Run: ${j.last_run_at ? new Date(j.last_run_at).toLocaleTimeString() : 'Never'} • ${j.last_status_message || ''}
        </div>
      </div>
      <div>
        <button class="btn btn-primary btn-sm" onclick="triggerJob('${j.id}')">Run Now</button>
      </div>
    </div>
  `).join('');
}

async function triggerJob(jobId) {
  const headers = { 'Authorization': `Bearer ${state.adminToken}` };
  alert(`Triggering job: ${jobId}...`);
  const res = await fetch(`/api/admin/jobs/${jobId}/run`, { method: 'POST', headers });
  const data = await res.json();
  alert(`Result: ${data.message}`);
  loadAdminJobs();
  loadAuditLogs();
}

async function loadAuditLogs() {
  const headers = { 'Authorization': `Bearer ${state.adminToken}` };
  const res = await fetch('/api/admin/jobs/logs', { headers });
  const logs = await res.json();

  const container = document.getElementById('admin-audit-logs');
  if (logs.length === 0) {
    container.innerHTML = `<div style="padding:10px; color:var(--text-dim);">No audit logs recorded yet.</div>`;
    return;
  }

  container.innerHTML = logs.map(l => `
    <div style="border-bottom:1px solid var(--border); padding:8px 0;">
      <span style="color:${l.status === 'SUCCESS' ? 'var(--dem-blue)' : 'var(--rep-red)'}; font-weight:700;">[${l.status}]</span>
      <strong>${l.job_id}</strong> (${l.duration_ms}ms) at ${new Date(l.started_at).toLocaleTimeString()}
      <pre style="margin-top:4px; white-space:pre-wrap; color:var(--text-muted); font-size:0.72rem;">${l.log_output}</pre>
    </div>
  `).join('');
}

async function loadAdminCandidates() {
  const res = await fetch('/api/candidates');
  const candidates = await res.json();
  state.candidates = candidates;
  renderAdminCandidates(candidates);
}

function searchAdminCandidates(query) {
  const q = query.toLowerCase();
  const filtered = state.candidates.filter(c => c.full_name.toLowerCase().includes(q) || c.party.toLowerCase().includes(q));
  renderAdminCandidates(filtered);
}

function renderAdminCandidates(candidates) {
  const container = document.getElementById('admin-candidates-list');
  container.innerHTML = candidates.slice(0, 30).map(c => `
    <div style="background:var(--bg-surface); padding:8px 12px; border-radius:var(--radius-sm); margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; align-items:center; gap:10px;">
        <img src="${c.photo_url || 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png'}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
        <div>
          <div style="font-size:0.85rem; font-weight:700;">${c.full_name}</div>
          <div style="font-size:0.72rem; color:var(--text-dim);">${c.party} • Race: ${c.race_id}</div>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="openEditCandidateModal('${c.id}')">Edit</button>
    </div>
  `).join('');
}

function openEditCandidateModal(id) {
  const c = state.candidates.find(item => item.id === id);
  if (!c) return;

  document.getElementById('edit-cand-id').value = c.id;
  document.getElementById('edit-cand-name').value = c.full_name;
  document.getElementById('edit-cand-party').value = c.party;
  document.getElementById('edit-cand-photo').value = c.photo_url || '';
  document.getElementById('edit-cand-bio').value = c.bio_snippet || '';
  document.getElementById('edit-cand-override').value = c.prob_override || '';

  document.getElementById('edit-candidate-modal').style.display = 'flex';
}

async function saveCandidateEdit() {
  const id = document.getElementById('edit-cand-id').value;
  const body = {
    full_name: document.getElementById('edit-cand-name').value,
    party: document.getElementById('edit-cand-party').value,
    photo_url: document.getElementById('edit-cand-photo').value,
    bio_snippet: document.getElementById('edit-cand-bio').value,
    prob_override: document.getElementById('edit-cand-override').value ? parseFloat(document.getElementById('edit-cand-override').value) : null
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${state.adminToken}`
  };

  await fetch(`/api/admin/candidates/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  alert('Candidate details updated successfully!');
  document.getElementById('edit-candidate-modal').style.display = 'none';
  loadAdminCandidates();
}

async function loadSiteConfig() {
  const res = await fetch('/api/seo');
  const cfg = await res.json();
  state.config = cfg;

  document.getElementById('cfg-site-title').value = cfg.site_title || '';
  document.getElementById('cfg-meta-desc').value = cfg.meta_description || '';
  document.getElementById('cfg-keywords').value = cfg.keywords || '';
  document.getElementById('cfg-banner-text').value = cfg.announcement_banner_text || '';
  document.getElementById('cfg-llm-directive').value = cfg.llm_summary_directive || '';
}

async function saveSiteConfig() {
  const body = {
    site_title: document.getElementById('cfg-site-title').value,
    meta_description: document.getElementById('cfg-meta-desc').value,
    keywords: document.getElementById('cfg-keywords').value,
    announcement_banner_text: document.getElementById('cfg-banner-text').value,
    llm_summary_directive: document.getElementById('cfg-llm-directive').value
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${state.adminToken}`
  };

  await fetch('/api/admin/config', { method: 'PUT', headers, body: JSON.stringify(body) });
  alert('Site configuration & SEO settings updated!');
}

// -------------------------------------------------------------
// App Initialization
// -------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  handleRouting();
});
