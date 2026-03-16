function resolveApiBase() {
  if (typeof window !== 'undefined' && typeof window.HSF_API_BASE === 'string' && window.HSF_API_BASE.trim()) {
    return window.HSF_API_BASE.trim().replace(/\/+$/, '');
  }

  if (typeof document !== 'undefined') {
    const meta = document.querySelector("meta[name='hsf-api-base']");
    const metaValue = meta ? String(meta.getAttribute('content') || '').trim() : '';
    if (metaValue) return metaValue.replace(/\/+$/, '');
  }

  return '/api';
}

const API = resolveApiBase();
let token = sessionStorage.getItem('hsf_token') || '';
let currentUser = null;

try {
  currentUser = JSON.parse(sessionStorage.getItem('hsf_user') || 'null');
} catch {
  currentUser = null;
}

const adminContentState = { team: [], gallery: [], users: [] };
const publicLoaderCaptions = [
  'Preparing a dignified experience for every visitor.',
  'Gathering hope, care, and practical support.',
  'Opening the doors to schools, sponsors, donors, and volunteers.'
];
let publicLoaderCaptionTimer = 0;
let publicLoaderProgressTimer = 0;
let publicLoaderProgressValue = 0;

async function req(path, opt = {}, auth = false) {
  const headers = { 'Content-Type': 'application/json', ...(opt.headers || {}) };
  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(API + path, { ...opt, headers });
  } catch {
    throw new Error('Unable to reach the back office server.');
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();

  if (!response.ok) {
    const err = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

    if (response.status === 404) {
      throw new Error('Back office server endpoint not found on this host.');
    }

    if (response.status >= 500) {
      throw new Error('Back office server error.');
    }

    throw new Error((err && err.error) || `Request failed (${response.status})`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error('Invalid back office server response.');
  }

  return response.json();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUserRole(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'member') return 'Member';
  if (role === 'viewer') return 'Viewer';
  return String(role || 'User');
}

function animateCounter(el, target, options = {}) {
  if (!el) return;

  const value = Number(target || 0);
  const suffix = options.suffix || '';
  const decimals = Number(options.decimals || 0);
  const initialized = el.dataset.counterInitialized === '1';
  const previous = initialized ? Number(el.dataset.counterValue || 0) : 0;

  if (!Number.isFinite(value)) {
    el.textContent = String(target ?? '');
    return;
  }

  if (el._counterFrame) {
    window.cancelAnimationFrame(el._counterFrame);
    el._counterFrame = 0;
  }

  const render = (nextValue) => {
    const numeric = decimals > 0 ? nextValue.toFixed(decimals) : Math.round(nextValue).toLocaleString();
    el.textContent = String(numeric) + suffix;
  };

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion || previous === value) {
    render(value);
    el.dataset.counterValue = String(value);
    el.dataset.counterInitialized = '1';
    return;
  }

  const duration = Math.max(700, Math.min(1500, 650 + Math.abs(value - previous) * 24));
  const startedAt = performance.now();

  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = previous + (value - previous) * eased;
    render(current);

    if (progress < 1) {
      el._counterFrame = window.requestAnimationFrame(step);
      return;
    }

    render(value);
    el.dataset.counterValue = String(value);
    el.dataset.counterInitialized = '1';
    el._counterFrame = 0;
  };

  el._counterFrame = window.requestAnimationFrame(step);
}

function setKpis(kpis) {
  if (!kpis) return;
  document.querySelectorAll("[data-kpi='kitsDistributed']").forEach((el) => {
    animateCounter(el, kpis.kitsDistributed || 0);
  });
  document.querySelectorAll("[data-kpi='beneficiariesServed']").forEach((el) => {
    animateCounter(el, kpis.beneficiariesServed || 0);
  });
  document.querySelectorAll("[data-kpi='schoolPartners']").forEach((el) => {
    animateCounter(el, kpis.schoolPartners || 0);
  });
}

function setPublicStats(stats) {
  if (!stats) return;
  const interactions = document.getElementById('interactionCount');
  const messages = document.getElementById('messageCount');
  const conversion = document.getElementById('conversionRate');

  if (interactions) animateCounter(interactions, stats.interactionCount || 0);
  if (messages) animateCounter(messages, stats.messageCount || 0);
  if (conversion) animateCounter(conversion, stats.conversionRate || 0, { suffix: '%' });
}

function setAdminStats(stats) {
  if (!stats) return;
  const interactions = document.getElementById('adminInteractions');
  const messages = document.getElementById('adminMessages');
  const visits = document.getElementById('adminVisits');

  if (interactions) animateCounter(interactions, stats.interactionCount || 0);
  if (messages) animateCounter(messages, stats.messageCount || 0);
  if (visits) animateCounter(visits, stats.pageVisits || 0);
}

function setInventory(summary, transactions) {
  const summaryWrap = document.getElementById('inventorySummary');
  const body = document.querySelector('#inventoryTable tbody');
  const stockRows = summary || [];
  const movementRows = transactions || [];

  if (summaryWrap) {
    if (!stockRows.length) {
      summaryWrap.innerHTML = "<div class='stat'><span>0</span><p>No stock recorded yet</p><small class='inventory-stat-meta'>Add your first donated item below.</small></div>";
    } else {
      summaryWrap.innerHTML = stockRows
        .map(
          (item) => '<div class="stat"><span>' + Number(item.quantityOnHand || 0).toLocaleString() + '</span><p>' + escapeHtml(item.itemName) + '</p><small class="inventory-stat-meta">' + escapeHtml(item.category || 'General') + '</small></div>'
        )
        .join('');
    }
  }

  if (body) {
    body.innerHTML = '';
    if (!movementRows.length) {
      body.innerHTML = "<tr><td colspan='7'>No inventory movements recorded yet.</td></tr>";
    } else {
      movementRows.forEach((row) => {
        const tr = document.createElement('tr');
        const movementLabel = row.direction === 'out' ? 'Distribution Out' : 'Donation In';
        const qtyClass = row.direction === 'out' ? 'out' : 'in';
        const qtyValue = row.direction === 'out' ? '-' + Number(row.quantity || 0).toLocaleString() : '+' + Number(row.quantity || 0).toLocaleString();
        tr.innerHTML = '<td>' + escapeHtml(new Date(row.createdAt).toLocaleString()) + '</td><td>' + escapeHtml(row.itemName) + '</td><td>' + escapeHtml(row.category) + '</td><td>' + escapeHtml(movementLabel) + '</td><td class="inventory-table-qty ' + qtyClass + '">' + escapeHtml(qtyValue) + '</td><td>' + escapeHtml(row.note || '-') + '</td><td>' + escapeHtml(row.recordedBy || '-') + '</td>';
        body.appendChild(tr);
      });
    }
  }
}

function setInteractions(rows) {
  const body = document.querySelector('#interactionsTable tbody');
  const volunteersBody = document.querySelector('#volunteersTable tbody');
  const schoolsBody = document.querySelector('#schoolsTable tbody');
  const sponsorsBody = document.querySelector('#sponsorsTable tbody');
  const allRows = rows || [];

  if (body) {
    body.innerHTML = '';
    if (!allRows.length) {
      body.innerHTML = "<tr><td colspan='5'>No interactions yet.</td></tr>";
    } else {
      allRows.forEach((item) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.interest)}</td><td>${escapeHtml(item.message)}</td>`;
        body.appendChild(tr);
      });
    }
  }

  if (volunteersBody) {
    const volunteerRows = allRows.filter((item) => String(item.interest || '').toLowerCase().startsWith('volunteer'));
    volunteersBody.innerHTML = '';

    if (!volunteerRows.length) {
      volunteersBody.innerHTML = "<tr><td colspan='5'>No volunteer applications yet.</td></tr>";
    } else {
      volunteerRows.forEach((item) => {
        const role = String(item.interest || '').replace(/^Volunteer:\s*/i, '').trim();
        const rawMessage = String(item.message || '');
        const availabilityMatch = rawMessage.match(/Volunteer availability:\s*([^\r\n]*)/i);
        const contributionMatch = rawMessage.match(/Volunteer contribution:\s*([\s\S]*)/i);
        const availability = availabilityMatch ? availabilityMatch[1].trim() : rawMessage.replace(/^Volunteer availability:\s*/i, '').trim();
        const contribution = contributionMatch ? contributionMatch[1].trim() : '';
        const details = contribution ? `${availability} | ${contribution}` : availability;

        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(role)}</td><td>${escapeHtml(details)}</td>`;
        volunteersBody.appendChild(tr);
      });
    }
  }

  if (schoolsBody) {
    const schoolRows = allRows.filter((item) => {
      const interest = String(item.interest || '').toLowerCase();
      return interest.startsWith('school signup') || interest.includes('request support for learners');
    });
    schoolsBody.innerHTML = '';

    if (!schoolRows.length) {
      schoolsBody.innerHTML = "<tr><td colspan='5'>No school signup requests yet.</td></tr>";
    } else {
      schoolRows.forEach((item) => {
        const rawMessage = String(item.message || '');
        const schoolMatch = rawMessage.match(/School:\s*([^\r\n]*)/i);
        const locationMatch = rawMessage.match(/Location:\s*([^\r\n]*)/i);
        const needMatch = rawMessage.match(/Need:\s*([\s\S]*)/i);
        const schoolLabel = schoolMatch ? schoolMatch[1].trim() : item.name;
        const location = locationMatch ? locationMatch[1].trim() : 'Not specified';
        const need = needMatch ? needMatch[1].trim() : rawMessage;

        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(item.date)}</td><td>${escapeHtml(schoolLabel)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(location)}</td><td>${escapeHtml(need)}</td>`;
        schoolsBody.appendChild(tr);
      });
    }
  }

  if (sponsorsBody) {
    const sponsorRows = allRows.filter((item) => {
      const interest = String(item.interest || '').toLowerCase();
      return interest.startsWith('sponsor signup') || interest.includes('sponsor');
    });
    sponsorsBody.innerHTML = '';

    if (!sponsorRows.length) {
      sponsorsBody.innerHTML = "<tr><td colspan='5'>No sponsor requests yet.</td></tr>";
    } else {
      sponsorRows.forEach((item) => {
        const rawMessage = String(item.message || '');
        const typeMatch = rawMessage.match(/Sponsorship type:\s*([^\r\n]*)/i);
        const commitmentMatch = rawMessage.match(/Commitment:\s*([\s\S]*)/i);
        const sponsorType = typeMatch ? typeMatch[1].trim() : String(item.interest || '').replace(/^Sponsor Signup:\s*/i, '').trim();
        const commitment = commitmentMatch ? commitmentMatch[1].trim() : rawMessage;

        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(sponsorType || "Not specified")}</td><td>${escapeHtml(commitment)}</td>`;
        sponsorsBody.appendChild(tr);
      });
    }
  }
}

function renderPublicTeam(team) {
  const grid = document.getElementById('publicTeamGrid');
  if (!grid) return;

  const members = team || [];
  if (!members.length) {
    grid.innerHTML = "<article class='team-card'><p class='muted'>Team updates will appear here soon.</p></article>";
    return;
  }

  grid.innerHTML = members
    .map(
      (member) => `
      <article class="team-card">
        <img src="${escapeHtml(member.photoUrl)}" alt="${escapeHtml(member.name)} headshot" class="team-headshot" loading="lazy" />
        <p class="team-role">${escapeHtml(member.role)}</p>
        <h3>${escapeHtml(member.name)}</h3>
        <p>${escapeHtml(member.bio)}</p>
      </article>`
    )
    .join('');
}

function renderPublicGallery(gallery) {
  const grid = document.getElementById('publicGalleryGrid');
  if (!grid) return;

  const items = gallery || [];
  if (!items.length) {
    grid.innerHTML = "<article class='panel-card'><p class='muted'>Gallery updates will appear here soon.</p></article>";
    return;
  }

  grid.innerHTML = items
    .map(
      (item) => `
      <figure class="gallery-card">
        <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.altText || item.caption || 'Gallery image')}" loading="lazy" />
        <figcaption>${escapeHtml(item.caption)}</figcaption>
      </figure>`
    )
    .join('');
}

function setTeamAdmin(team) {
  const body = document.querySelector('#teamAdminTable tbody');
  if (!body) return;

  const rows = team || [];
  body.innerHTML = '';

  if (!rows.length) {
    body.innerHTML = "<tr><td colspan='5'>No team members yet.</td></tr>";
    return;
  }

  rows.forEach((member) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(member.sortOrder)}</td>
      <td>${escapeHtml(member.name)}</td>
      <td>${escapeHtml(member.role)}</td>
      <td><a href="${escapeHtml(member.photoUrl)}" target="_blank" rel="noreferrer">View</a></td>
      <td>
        <button type="button" class="btn btn-small admin-edit-team" data-id="${member.id}">Edit</button>
        <button type="button" class="btn btn-small admin-delete-team" data-id="${member.id}">Delete</button>
      </td>`;
    body.appendChild(tr);
  });
}

function setGalleryAdmin(gallery) {
  const body = document.querySelector('#galleryAdminTable tbody');
  if (!body) return;

  const rows = gallery || [];
  body.innerHTML = '';

  if (!rows.length) {
    body.innerHTML = "<tr><td colspan='4'>No gallery items yet.</td></tr>";
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.sortOrder)}</td>
      <td>${escapeHtml(item.caption)}</td>
      <td><a href="${escapeHtml(item.imageUrl)}" target="_blank" rel="noreferrer">View</a></td>
      <td>
        <button type="button" class="btn btn-small admin-edit-gallery" data-id="${item.id}">Edit</button>
        <button type="button" class="btn btn-small admin-delete-gallery" data-id="${item.id}">Delete</button>
      </td>`;
    body.appendChild(tr);
  });
}

function setUsersAdmin(users) {
  const body = document.querySelector('#usersTable tbody');
  if (!body) return;

  const rows = users || [];
  body.innerHTML = '';

  if (!rows.length) {
    body.innerHTML = "<tr><td colspan='6'>No users found.</td></tr>";
    return;
  }

  rows.forEach((user) => {
    const status = user.isActive ? 'Active' : 'Inactive';
    const lastLogin = user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(user.fullName)}</td>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(formatUserRole(user.role))}</td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(lastLogin)}</td>
      <td>
        <button type="button" class="btn btn-small admin-edit-user" data-id="${user.id}">Edit</button>
        <button type="button" class="btn btn-small admin-toggle-user" data-id="${user.id}">${user.isActive ? 'Deactivate' : 'Activate'}</button>
      </td>`;
    body.appendChild(tr);
  });
}

function clearTeamForm() {
  const form = document.getElementById('teamMemberForm');
  if (!form) return;
  form.reset();

  const idInput = document.getElementById('teamMemberId');
  const sortInput = document.getElementById('teamMemberSortOrder');
  const fileInput = document.getElementById('teamMemberPhotoFile');
  const fileName = document.getElementById('teamMemberPhotoFileName');
  const previewWrap = document.getElementById('teamMemberPhotoPreviewWrap');
  const preview = document.getElementById('teamMemberPhotoPreview');

  if (idInput) idInput.value = '';
  if (sortInput) sortInput.value = '0';
  if (fileInput) fileInput.value = '';
  if (fileName) fileName.textContent = 'No local file selected.';
  if (preview) preview.removeAttribute('src');
  if (previewWrap) previewWrap.hidden = true;
}

function clearGalleryForm() {
  const form = document.getElementById('galleryForm');
  if (!form) return;
  form.reset();
  const idInput = document.getElementById('galleryId');
  const sortInput = document.getElementById('gallerySortOrder');
  if (idInput) idInput.value = '';
  if (sortInput) sortInput.value = '0';
}

function clearUserForm() {
  const form = document.getElementById('userForm');
  if (!form) return;
  form.reset();
  const idInput = document.getElementById('userId');
  const roleInput = document.getElementById('userRole');
  const activeInput = document.getElementById('userActive');
  if (idInput) idInput.value = '';
  if (roleInput) roleInput.value = 'member';
  if (activeInput) activeInput.checked = true;
}

function applyRoleAccess() {
  if (!document.body.classList.contains('admin-body')) return;

  const isAdmin = !!currentUser && currentUser.role === 'admin';
  const inventoryEntryPanel = document.querySelector('.inventory-entry-panel');
  const adminOnlyTabs = ['updates', 'content', 'users'];

  adminOnlyTabs.forEach((tabId) => {
    const tabButton = document.querySelector('.tab-link[data-tab="' + tabId + '"]');
    const panel = document.getElementById(tabId);
    if (tabButton) tabButton.style.display = isAdmin ? '' : 'none';
    if (panel && !isAdmin) panel.classList.remove('active');
  });

  if (!isAdmin) {
    const active = document.querySelector('.tab-panel.active');
    if (!active || adminOnlyTabs.includes(active.id)) {
      document.querySelectorAll('.tab-link').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
      const overviewBtn = document.querySelector('.tab-link[data-tab="overview"]');
      const overviewPanel = document.getElementById('overview');
      if (overviewBtn) overviewBtn.classList.add('active');
      if (overviewPanel) overviewPanel.classList.add('active');
    }
  }

  const badge = document.getElementById('currentUserBadge');
  if (badge && currentUser) {
    badge.textContent = 'Welcome, ' + currentUser.fullName + ' (' + formatUserRole(currentUser.role) + ')';
  } else if (badge) {
    badge.textContent = '';
  }

  if (inventoryEntryPanel) inventoryEntryPanel.style.display = currentUser && currentUser.role === 'viewer' ? 'none' : '';

  syncAdminSessionUi();
}
function syncAdminSessionUi() {
  if (!document.body.classList.contains('admin-body')) return;
  const logoutButton = document.getElementById('logoutButton');
  const topWelcomeBadge = document.getElementById('topWelcomeBadge');

  if (logoutButton) logoutButton.hidden = !token;

  if (topWelcomeBadge) {
    if (token && currentUser && currentUser.fullName) {
      topWelcomeBadge.hidden = false;
      topWelcomeBadge.textContent = `Welcome, ${currentUser.fullName}`;
    } else {
      topWelcomeBadge.hidden = true;
      topWelcomeBadge.textContent = '';
    }
  }
}

function bindAdminSessionControls() {
  if (!document.body.classList.contains('admin-body')) return;
  const logoutButton = document.getElementById('logoutButton');
  if (!logoutButton) return;

  logoutButton.addEventListener('click', () => {
    sessionStorage.removeItem('hsf_token');
    sessionStorage.removeItem('hsf_user');
    token = '';
    currentUser = null;
    document.body.classList.add('login-mode');

    const existingLogin = document.getElementById('loginPanel');
    if (existingLogin) existingLogin.remove();

    const main = document.querySelector('main');
    if (main) main.style.display = 'none';

    buildLogin();
  });
}

async function loadPublic() {
  try {
    const data = await req('/public/dashboard');
    setKpis(data.kpis);
    setPublicStats(data.stats);
  } catch {
    // Keep page usable even when API is temporarily unavailable.
  }
}

async function loadPublicContent() {
  if (!document.body.classList.contains('site-body')) return;

  try {
    const data = await req('/public/content');
    renderPublicTeam(data.team || []);
    renderPublicGallery(data.gallery || []);
  } catch {
    // Keep existing static content if content API is unavailable.
  }
}

async function trackVisit() {
  if (!document.body.classList.contains('site-body')) return;
  if (sessionStorage.getItem('hsf_visited')) return;

  sessionStorage.setItem('hsf_visited', '1');
  try {
    await req('/public/visit', { method: 'POST' });
  } catch {
    // Ignore visit tracking failure.
  }
  await loadPublic();
}

async function submitInteraction(payload) {
  await req('/public/interactions', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function initDonationCalculator() {
  const range = document.getElementById('donationRange');
  const amount = document.getElementById('donationAmount');
  const hidden = document.getElementById('donationAmountHidden');
  const kitsOut = document.getElementById('kitsOut');
  const learnersOut = document.getElementById('learnersOut');
  const tierButtons = document.querySelectorAll('.tier-btn');

  if (!range || !amount || !hidden || !kitsOut || !learnersOut) return;

  const sync = (value) => {
    const clean = Math.max(10, Number(value) || 10);
    range.value = clean;
    amount.value = clean;
    hidden.value = clean;

    const kits = Math.max(1, Math.round(clean / 50));
    const learners = Math.max(1, Math.round(kits * 0.9));
    kitsOut.textContent = kits.toLocaleString();
    learnersOut.textContent = learners.toLocaleString();

    tierButtons.forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.amount) === clean);
    });
  };

  range.addEventListener('input', () => sync(range.value));
  amount.addEventListener('input', () => sync(amount.value));
  tierButtons.forEach((btn) => {
    btn.addEventListener('click', () => sync(btn.dataset.amount));
  });

  sync(amount.value);
}

function initFaq() {
  document.querySelectorAll('.faq-item').forEach((item) => {
    const trigger = item.querySelector('.faq-q');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach((it) => it.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
}

function initRolePicker() {
  const roleInput = document.getElementById('preferredRole');
  if (!roleInput) return;

  document.querySelectorAll('.role-card').forEach((card) => {
    card.addEventListener('click', () => {
      const role = card.dataset.role || '';
      roleInput.value = role;
      if (!role) roleInput.focus();
      document.querySelectorAll('.role-card').forEach((item) => item.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

function initVolunteerChoice() {
  const buttons = Array.from(document.querySelectorAll('.choice-btn'));
  const panels = Array.from(document.querySelectorAll('.choice-panel'));
  if (!buttons.length || !panels.length) return;

  const showPanel = (targetId) => {
    panels.forEach((panel) => {
      panel.classList.toggle('is-hidden', panel.id !== targetId);
    });

    buttons.forEach((button) => {
      button.classList.toggle('active', button.dataset.target === targetId);
    });
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => showPanel(button.dataset.target));
  });

  const initial = buttons.find((button) => button.classList.contains('active')) || buttons[0];
  showPanel(initial.dataset.target);
}

function initRevealAndProgress() {
  const progress = document.getElementById('scrollProgress');
  if (progress) {
    const update = () => {
      const top = window.scrollY;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = height > 0 ? (top / height) * 100 : 0;
      progress.style.width = `${ratio}%`;
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  const revealItems = document.querySelectorAll('.reveal-lux');
  if (revealItems.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    revealItems.forEach((el) => observer.observe(el));
  }
}

function initSmoothAnchors() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = document.querySelector(targetId);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function initPublicNav() {
  const navs = document.querySelectorAll('.luxury-nav');
  navs.forEach((nav) => {
    const links = Array.from(nav.querySelectorAll('a'));
    if (!links.length) return;

    let indicator = nav.querySelector('.nav-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'nav-indicator';
      nav.prepend(indicator);
    }

    let orb = nav.querySelector('.nav-orb');
    if (!orb) {
      orb = document.createElement('span');
      orb.className = 'nav-orb';
      nav.appendChild(orb);
    }

    const activeLink = links.find((link) => link.classList.contains('is-active')) || links[0];
    let currentLink = activeLink;

    const markHot = (target) => {
      links.forEach((link) => link.classList.toggle('is-hot', link === target));
    };

    const moveIndicator = (target, instant = false) => {
      if (!target) return;
      if (instant) indicator.style.transition = 'none';
      indicator.style.width = String(target.offsetWidth) + 'px';
      indicator.style.transform = 'translateX(' + String(target.offsetLeft) + 'px)';
      indicator.style.opacity = '1';
      markHot(target);
      if (instant) {
        window.requestAnimationFrame(() => {
          indicator.style.transition = '';
        });
      }
    };

    const sync = () => moveIndicator(currentLink || activeLink, true);
    const reset = () => {
      currentLink = activeLink;
      nav.classList.remove('is-engaged');
      moveIndicator(activeLink);
    };

    const trackPointer = (event) => {
      const rect = nav.getBoundingClientRect();
      const x = Math.max(0, event.clientX - rect.left);
      const y = Math.max(0, event.clientY - rect.top);
      nav.style.setProperty('--nav-pointer-x', String(x) + 'px');
      nav.style.setProperty('--nav-pointer-y', String(y) + 'px');
      orb.style.transform = 'translate(' + String(x - 32) + 'px, ' + String(y - 32) + 'px)';
    };

    nav.addEventListener('pointermove', (event) => {
      nav.classList.add('is-engaged');
      trackPointer(event);
    });

    nav.addEventListener('pointerleave', reset);
    nav.addEventListener('focusout', (event) => {
      if (!nav.contains(event.relatedTarget)) reset();
    });

    links.forEach((link) => {
      const activate = () => {
        currentLink = link;
        moveIndicator(link);
      };

      link.addEventListener('mouseenter', activate);
      link.addEventListener('focus', activate);
      link.addEventListener('click', () => {
        currentLink = link;
      });
    });

    window.addEventListener('resize', sync);
    nav.addEventListener('scroll', sync, { passive: true });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(sync).catch(() => {});
    }
    nav.classList.add('is-ready');
    window.requestAnimationFrame(sync);
  });

  const headers = document.querySelectorAll('.luxury-topbar');
  if (headers.length) {
    const updateHeader = () => {
      const compact = window.scrollY > 18;
      headers.forEach((header) => header.classList.toggle('is-compact', compact));
    };

    window.addEventListener('scroll', updateHeader, { passive: true });
    updateHeader();
  }
}

function ensurePublicLoader() {
  if (!document.body.classList.contains('site-body')) return null;
  let loader = document.getElementById('publicPageLoader');
  if (loader) return loader;

  loader = document.createElement('div');
  loader.id = 'publicPageLoader';
  loader.className = 'public-site-loader';
  loader.setAttribute('role', 'status');
  loader.setAttribute('aria-live', 'polite');
  loader.innerHTML =
    '<div class="loader-shell">' +
      '<div class="loader-aura loader-aura-one" aria-hidden="true"></div>' +
      '<div class="loader-aura loader-aura-two" aria-hidden="true"></div>' +
      '<div class="loader-stage">' +
        '<div class="loader-brand-mark" aria-hidden="true">' +
          '<span class="loader-brand-ring loader-brand-ring-one"></span>' +
          '<span class="loader-brand-ring loader-brand-ring-two"></span>' +
          '<img src="logo-heavensent.png" alt="" class="loader-logo" />' +
        '</div>' +
        '<p class="eyebrow">Heaven Sent Foundation NGO</p>' +
        '<h3 class="loader-title">Opening a warm, elegant space for dignity, care, and hope.</h3>' +
        '<div class="loader-statline" aria-hidden="true">' +
          '<div class="loader-count-wrap">' +
            '<strong class="loader-count">00</strong>' +
            '<span class="loader-count-label">% ready</span>' +
          '</div>' +
        '</div>' +
        '<p class="loader-caption">Preparing a dignified experience for every visitor.</p>' +
        '<div class="loader-progress" aria-hidden="true"><span class="loader-progress-bar"></span></div>' +
        '<div class="loader-pillars" aria-hidden="true">' +
          '<span>Protect</span>' +
          '<span>Restore</span>' +
          '<span>Empower</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(loader);
  return loader;
}

function setPublicLoaderProgress(loader, value) {
  if (!loader) return;
  const nextValue = Math.max(0, Math.min(100, Math.round(value)));
  publicLoaderProgressValue = nextValue;
  loader.style.setProperty('--loader-progress', String(nextValue));

  const counter = loader.querySelector('.loader-count');
  if (counter) {
    counter.textContent = String(nextValue).padStart(2, '0');
  }
}

function stopPublicLoaderProgressTimer() {
  if (publicLoaderProgressTimer) {
    window.clearInterval(publicLoaderProgressTimer);
    publicLoaderProgressTimer = 0;
  }
}

function startPublicLoaderProgress(loader) {
  stopPublicLoaderProgressTimer();
  setPublicLoaderProgress(loader, 0);

  publicLoaderProgressTimer = window.setInterval(() => {
    const ceiling = 93;
    if (publicLoaderProgressValue >= ceiling) {
      stopPublicLoaderProgressTimer();
      return;
    }

    let step = 1;
    if (publicLoaderProgressValue < 28) step = 5;
    else if (publicLoaderProgressValue < 54) step = 3;
    else if (publicLoaderProgressValue < 76) step = 2;

    setPublicLoaderProgress(loader, Math.min(ceiling, publicLoaderProgressValue + step));
  }, 85);
}

function finishPublicLoaderProgress(loader, duration = 420) {
  if (!loader) return;
  stopPublicLoaderProgressTimer();

  const start = publicLoaderProgressValue;
  const target = 100;
  const total = Math.max(180, duration);
  const startedAt = Date.now();

  publicLoaderProgressTimer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const ratio = Math.min(1, elapsed / total);
    const eased = 1 - Math.pow(1 - ratio, 3);
    setPublicLoaderProgress(loader, start + (target - start) * eased);

    if (ratio >= 1) {
      setPublicLoaderProgress(loader, target);
      stopPublicLoaderProgressTimer();
    }
  }, 16);
}

function showPublicLoader(message) {
  const loader = ensurePublicLoader();
  if (!loader) return;

  const caption = loader.querySelector('.loader-caption');
  if (publicLoaderCaptionTimer) {
    window.clearInterval(publicLoaderCaptionTimer);
    publicLoaderCaptionTimer = 0;
  }

  if (caption) {
    let index = 0;
    caption.textContent = message || publicLoaderCaptions[0];
    publicLoaderCaptionTimer = window.setInterval(() => {
      index = (index + 1) % publicLoaderCaptions.length;
      caption.textContent = publicLoaderCaptions[index];
    }, 1250);
  }

  startPublicLoaderProgress(loader);
  loader.classList.remove('is-hidden');
}

function hidePublicLoader(delay = 560) {
  const loader = document.getElementById('publicPageLoader');
  if (!loader) return;

  const caption = loader.querySelector('.loader-caption');
  if (publicLoaderCaptionTimer) {
    window.clearInterval(publicLoaderCaptionTimer);
    publicLoaderCaptionTimer = 0;
  }

  if (caption) {
    caption.textContent = 'Welcome to Heaven Sent Foundation.';
  }

  finishPublicLoaderProgress(loader, delay - 120);

  window.setTimeout(() => {
    loader.classList.add('is-hidden');
  }, delay);
}
function bindPasswordToggles(scope = document) {
  scope.querySelectorAll('.password-toggle').forEach((button) => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';

    button.addEventListener('click', () => {
      const targetId = button.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;

      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      button.classList.toggle('is-on', showing);
      button.setAttribute('aria-pressed', showing ? 'true' : 'false');
      button.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    });
  });
}
function bindPublicActions() {
  document.querySelectorAll('.track-action').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const href = button.getAttribute('href');
      const shouldNavigate = button.tagName === 'A' && href && !href.startsWith('#');
      if (shouldNavigate) event.preventDefault();

      try {
        await req('/public/action', {
          method: 'POST',
          body: JSON.stringify({ type: button.dataset.action })
        });
        await loadPublic();
      } catch {
        // keep UX smooth even if tracking fails
      } finally {
        if (shouldNavigate) window.location.href = href;
      }
    });
  });

  const generalForm = document.getElementById('publicForm');
  if (generalForm) {
    generalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(generalForm);

      try {
        await submitInteraction({
          name: data.get('name'),
          email: data.get('email'),
          interest: data.get('interest'),
          message: data.get('message')
        });

        generalForm.reset();
        alert('Thank you. Your request was submitted successfully.');
        await loadPublic();
      } catch (err) {
        alert(err.message || 'Unable to submit right now.');
      }
    });
  }

  const schoolForm = document.getElementById('schoolForm');
  if (schoolForm) {
    schoolForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(schoolForm);
      const schoolName = String(data.get('schoolName') || '').trim();
      const contactName = String(data.get('contactName') || '').trim();
      const email = String(data.get('email') || '').trim();
      const phone = String(data.get('phone') || '').trim();
      const province = String(data.get('province') || '').trim();
      const town = String(data.get('town') || '').trim();
      const grades = String(data.get('grades') || '').trim();
      const learners = String(data.get('learners') || '').trim();
      const urgency = String(data.get('urgency') || '').trim();
      const need = String(data.get('need') || '').trim();
      const facilities = String(data.get('facilities') || '').trim();
      const location = [town, province].filter(Boolean).join(', ');

      try {
        await submitInteraction({
          name: contactName || schoolName,
          email,
          interest: 'School Signup: Hygiene Support',
          message:
            'School: ' + schoolName + '\n' +
            'Contact person: ' + contactName + '\n' +
            'Phone: ' + phone + '\n' +
            'Location: ' + location + '\n' +
            'Grades: ' + grades + '\n' +
            'Learners: ' + learners + '\n' +
            'Urgency: ' + urgency + '\n' +
            'Facilities: ' + (facilities || 'Not specified') + '\n' +
            'Need: ' + need
        });

        schoolForm.reset();
        alert('School application submitted successfully. Our team will review it in the back office.');
        await loadPublic();
      } catch (err) {
        alert(err.message || 'Unable to submit the school application right now.');
      }
    });
  }

  const sponsorForm = document.getElementById('sponsorForm');
  if (sponsorForm) {
    sponsorForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(sponsorForm);
      const organization = String(data.get('organization') || '').trim();
      const contactName = String(data.get('contactName') || '').trim();
      const email = String(data.get('email') || '').trim();
      const phone = String(data.get('phone') || '').trim();
      const website = String(data.get('website') || '').trim();
      const sponsorType = String(data.get('sponsorType') || '').trim();
      const supportArea = String(data.get('supportArea') || '').trim();
      const commitment = String(data.get('commitment') || '').trim();
      const notes = String(data.get('notes') || '').trim();

      try {
        await submitInteraction({
          name: organization || contactName,
          email,
          interest: 'Sponsor Signup: ' + sponsorType,
          message:
            'Organization: ' + organization + '\n' +
            'Contact person: ' + contactName + '\n' +
            'Phone: ' + phone + '\n' +
            'Website: ' + (website || 'Not provided') + '\n' +
            'Sponsorship type: ' + sponsorType + '\n' +
            'Support area: ' + supportArea + '\n' +
            'Commitment: ' + commitment + '\n' +
            'Notes: ' + (notes || 'None')
        });

        sponsorForm.reset();
        alert('Sponsor signup submitted successfully. Our team will contact you.');
        await loadPublic();
      } catch (err) {
        alert(err.message || 'Unable to submit sponsor signup right now.');
      }
    });
  }

  const donationForm = document.getElementById('donationForm');
  if (donationForm) {
    const purposeSelect = donationForm.querySelector('#purposeSelect');
    const purposeOtherWrap = donationForm.querySelector('#purposeOtherWrap');
    const purposeOtherInput = donationForm.querySelector('#purposeOther');
    const anonymousDonorInput = donationForm.querySelector('#anonymousDonor');
    const donorNameWrap = donationForm.querySelector('#donorNameWrap');
    const donorNameInput = donationForm.querySelector('#donorName');
    const donorEmailInput = donationForm.querySelector('#donorEmail');
    const monthlyMethodSwitch = donationForm.querySelector('#monthlyMethodSwitch');
    const paymentMethodInputs = donationForm.querySelectorAll('input[name="paymentMethod"]');
    const debitOrderFields = donationForm.querySelector('#debitOrderFields');
    const accountHolderInput = donationForm.querySelector('#accountHolder');
    const bankNameInput = donationForm.querySelector('#bankName');
    const accountTypeInput = donationForm.querySelector('#accountType');
    const accountNumberInput = donationForm.querySelector('#accountNumber');
    const branchCodeInput = donationForm.querySelector('#branchCode');
    const debitDayInput = donationForm.querySelector('#debitDay');
    const debitConsentInput = donationForm.querySelector('#debitConsent');

    const syncDonationPurpose = () => {
      const isOther = !!purposeSelect && purposeSelect.value === 'Other';
      if (purposeOtherWrap) {
        purposeOtherWrap.classList.toggle('is-hidden', !isOther);
      }

      if (purposeOtherInput) {
        purposeOtherInput.required = isOther;
        if (!isOther) purposeOtherInput.value = '';
      }
    };

    const syncDonationIdentity = () => {
      const isAnonymous = !!anonymousDonorInput && anonymousDonorInput.checked;

      if (donorNameWrap) {
        donorNameWrap.classList.toggle('is-hidden', isAnonymous);
      }

      if (donorNameInput) {
        donorNameInput.required = !isAnonymous;
        if (isAnonymous) donorNameInput.value = '';
      }

      if (donorEmailInput) {
        donorEmailInput.required = !isAnonymous;
        donorEmailInput.placeholder = isAnonymous ? 'Optional for anonymous donor' : '';
      }
    };

    const syncMonthlyPaymentMode = () => {
      const frequency = String(donationForm.querySelector('input[name="frequency"]:checked')?.value || 'Once-off');
      const isMonthly = frequency === 'Monthly';
      const paymentMethod = String(donationForm.querySelector('input[name="paymentMethod"]:checked')?.value || 'card');
      const isDebitOrder = isMonthly && paymentMethod === 'debit-order';

      if (monthlyMethodSwitch) {
        monthlyMethodSwitch.classList.toggle('is-hidden', !isMonthly);
      }

      if (!isMonthly) {
        paymentMethodInputs.forEach((input) => {
          input.checked = input.value === 'card';
        });
      }

      if (debitOrderFields) {
        debitOrderFields.classList.toggle('is-hidden', !isDebitOrder);
      }

      [accountHolderInput, bankNameInput, accountTypeInput, accountNumberInput, branchCodeInput, debitDayInput].forEach((input) => {
        if (input) input.required = isDebitOrder;
      });

      if (debitConsentInput) {
        debitConsentInput.required = isDebitOrder;
        if (!isDebitOrder) debitConsentInput.checked = false;
      }
    };

    if (purposeSelect) {
      purposeSelect.addEventListener('change', syncDonationPurpose);
      syncDonationPurpose();
    }

    if (anonymousDonorInput) {
      anonymousDonorInput.addEventListener('change', syncDonationIdentity);
      syncDonationIdentity();
    }

    donationForm.querySelectorAll('input[name="frequency"]').forEach((input) => {
      input.addEventListener('change', syncMonthlyPaymentMode);
    });

    paymentMethodInputs.forEach((input) => {
      input.addEventListener('change', syncMonthlyPaymentMode);
    });

    syncMonthlyPaymentMode();

    donationForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(donationForm);
      const amount = data.get('amount');
      const purposeChoice = String(data.get('purpose') || '').trim();
      const otherPurpose = String(data.get('purposeOther') || '').trim();
      const purpose = purposeChoice === 'Other' ? otherPurpose : purposeChoice;
      const frequency = String(data.get('frequency') || 'Once-off');
      const paymentMethod = String(data.get('paymentMethod') || 'card');
      const anonymous = data.get('anonymousDonor') === 'on';
      const donorName = anonymous ? 'Anonymous Donor' : String(data.get('name') || '').trim();
      const donorEmailRaw = String(data.get('email') || '').trim();
      const donorEmail = anonymous ? donorEmailRaw || 'anonymous@heavensent.local' : donorEmailRaw;

      if (!donorName) {
        alert('Please enter your full name.');
        return;
      }

      if (!donorEmail) {
        alert('Please enter your email address.');
        return;
      }

      if (!purpose) {
        alert('Please enter your donation purpose.');
        return;
      }

      if (frequency === 'Monthly' && paymentMethod === 'debit-order') {
        const accountHolder = String(data.get('accountHolder') || '').trim();
        const bankName = String(data.get('bankName') || '').trim();
        const accountType = String(data.get('accountType') || '').trim();
        const accountNumber = String(data.get('accountNumber') || '').trim();
        const branchCode = String(data.get('branchCode') || '').trim();
        const debitDay = String(data.get('debitDay') || '').trim();
        const debitConsent = data.get('debitConsent') === 'on';

        if (!accountHolder || !bankName || !accountType || !accountNumber || !branchCode || !debitDay || !debitConsent) {
          alert('Please complete all debit order signup fields and consent.');
          return;
        }

        const maskedAccount = accountNumber.length > 4 ? `****${accountNumber.slice(-4)}` : accountNumber;

        try {
          await submitInteraction({
            name: donorName,
            email: donorEmail,
            interest: `Debit Order Signup (Monthly): ${purpose}`,
            message: `Monthly debit order signup of R${amount} for ${purpose}. Donor type: ${anonymous ? "Anonymous" : "Named"}. Account holder: ${accountHolder}. Bank: ${bankName}. Account type: ${accountType}. Account number: ${maskedAccount}. Branch code: ${branchCode}. Debit day: ${debitDay}.`
          });

          await loadPublic();
          const signupParams = new URLSearchParams({
            amount: String(amount || "10"),
            frequency,
            purpose,
            name: donorName,
            email: donorEmail,
            anonymous: anonymous ? 'yes' : 'no',
            mode: 'debit-order',
            bankName,
            accountType,
            accountNumber: maskedAccount,
            branchCode,
            debitDay
          });
          window.location.href = `payment-success.html?${signupParams.toString()}`;
        } catch (err) {
          alert(err.message || 'Unable to submit debit order signup right now.');
        }

        return;
      }

      try {
        await submitInteraction({
          name: donorName,
          email: donorEmail,
          interest: `Donation (${frequency}): ${purpose}`,
          message: `${frequency} donation pledge of R${amount} for ${purpose}. Payment method: ${paymentMethod}. Donor type: ${anonymous ? "Anonymous" : "Named"}.`
        });

        await loadPublic();
        const checkoutParams = new URLSearchParams({
          amount: String(amount || "10"),
          frequency,
          purpose,
          name: donorName,
          email: donorEmail,
          anonymous: anonymous ? 'yes' : 'no',
          paymentMethod
        });
        window.location.href = `paygate.html?${checkoutParams.toString()}`;
      } catch (err) {
        alert(err.message || 'Unable to proceed to donation right now.');
      }
    });
  }

  const volunteerForm = document.getElementById('volunteerForm');
  if (volunteerForm) {
    volunteerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(volunteerForm);

      try {
        const role = String(data.get('role') || '').trim();
        const contribution = String(data.get('contribution') || '').trim();
        const availability = String(data.get('availability') || '').trim();
        const selectedRole = role || 'Volunteer';
        const note = contribution
          ? `Volunteer availability: ${availability}\nVolunteer contribution: ${contribution}`
          : `Volunteer availability: ${availability}`;

        await submitInteraction({
          name: data.get('name'),
          email: data.get('email'),
          interest: `Volunteer: ${selectedRole}`,
          message: note
        });

        await loadPublic();

        const subject = encodeURIComponent(`Volunteer Application - ${selectedRole}`);
        const details = contribution ? `How I can help: ${contribution}\n` : '';
        const body = encodeURIComponent(
          `Name: ${data.get('name')}\nEmail: ${data.get('email')}\nRole: ${selectedRole}\n${details}Availability: ${availability}`
        );
        window.location.href = `mailto:info@thehsf.org.za?subject=${subject}&body=${body}`;

        volunteerForm.reset();
        alert('Volunteer application submitted successfully.');
      } catch (err) {
        alert(err.message || 'Unable to submit volunteer application.');
      }
    });
  }
}

function buildLogin() {
  if (!document.body.classList.contains('admin-body')) return;

  const main = document.querySelector('main');
  if (!main) return;

  const existingLogin = document.getElementById('loginPanel');

  if (token) {
    if (existingLogin) existingLogin.remove();
    document.body.classList.remove('login-mode');
    main.style.display = 'grid';
    applyRoleAccess();
    syncAdminSessionUi();
    return;
  }

  document.body.classList.add('login-mode');
  main.style.display = 'none';
  syncAdminSessionUi();

  if (existingLogin) return;

  const wrap = document.createElement('section');
  wrap.className = 'login-shell';
  wrap.id = 'loginPanel';
  wrap.innerHTML = `
    <div class="login-hero">
      <p class="login-kicker">Heaven Sent Foundation</p>
      <h1><span>Secure</span> Back Office Login</h1>
      <p class="login-subtitle">Authorized staff, advisors, and approved members can sign in here.</p>
    </div>
    <div class="login-card">
      <section class="login-art-panel">
        <div class="login-art-glow login-art-glow-one"></div>
        <div class="login-art-glow login-art-glow-two"></div>
        <div class="ghost-stage" id="ghostStage">
          <div class="ghost-reaction" id="loginGhostReaction" role="status" aria-live="polite">
            <span id="loginGhostReactionText">Enter your password to continue.</span>
          </div>
          <div class="ghost ghost-small">
            <span class="ghost-eye left"></span>
            <span class="ghost-eye right"></span>
            <span class="ghost-mouth"></span>
            <span class="ghost-tear tear-left"></span>
            <span class="ghost-tear tear-right"></span>
          </div>
          <div class="ghost ghost-large">
            <span class="ghost-eye left"></span>
            <span class="ghost-eye right"></span>
            <span class="ghost-mouth"></span>
            <span class="ghost-tear tear-left"></span>
            <span class="ghost-tear tear-right"></span>
          </div>
        </div>
        <div class="login-art-badge">
          <img src="logo-heavensent.png" alt="" />
          <p>Dignity protected. Access controlled.</p>
        </div>
      </section>
      <section class="login-form-panel">
        <p class="login-panel-eyebrow">Member Access</p>
        <h2>Sign In</h2>
        <p class="login-panel-copy">Use your assigned username and password to enter the NGO back office.</p>
        <form id="loginForm" class="contact-form login-form">
          <label>Username<input name="username" autocomplete="username" required /></label>
          <label>Password<div class="password-wrap"><input id="loginPassword" name="password" type="password" autocomplete="current-password" required /><button type="button" class="password-toggle" data-target="loginPassword" aria-label="Show password" aria-pressed="false">&#128065;</button></div></label>
          <button class="btn login-submit" type="submit">Sign In</button>
        </form>
        <p id="loginMessage" class="login-message" hidden></p>
        <p class="notice login-note">Each member must use their own login details.</p>
      </section>
    </div>`;
  document.body.appendChild(wrap);
  bindPasswordToggles(wrap);

  const ghostStage = document.getElementById('ghostStage');
  const ghostReactionText = document.getElementById('loginGhostReactionText');
  const passwordInput = document.getElementById('loginPassword');
  const toggleButton = wrap.querySelector('.password-toggle');
  let ghostMoodTimer = 0;

  const setGhostMood = (mood, text, duration = 2200) => {
    if (!ghostStage || !ghostReactionText) return;

    ghostStage.classList.remove('is-error', 'is-success', 'is-reveal');

    if (ghostMoodTimer) {
      window.clearTimeout(ghostMoodTimer);
      ghostMoodTimer = 0;
    }

    if (text) {
      ghostReactionText.textContent = text;
    }

    if (!mood) return;

    ghostStage.classList.add(`is-${mood}`);

    if (duration > 0) {
      ghostMoodTimer = window.setTimeout(() => {
        ghostStage.classList.remove(`is-${mood}`);
        ghostReactionText.textContent = 'Enter your password to continue.';
      }, duration);
    }
  };

  if (toggleButton && passwordInput) {
    toggleButton.addEventListener('click', () => {
      window.setTimeout(() => {
        const isVisible = passwordInput.type === 'text';
        setGhostMood(
          'reveal',
          isVisible ? 'Password is visible now.' : 'Password hidden again.',
          1600
        );
      }, 0);
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener('input', () => {
      if (!ghostStage || !ghostStage.classList.contains('is-error')) return;
      setGhostMood('', 'Enter your password to continue.', 0);
    });
  }

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const message = document.getElementById('loginMessage');

    if (message) {
      message.hidden = true;
      message.textContent = '';
      message.classList.remove('is-error', 'is-success');
    }

    try {
      const response = await req('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: data.get('username'), password: data.get('password') })
      });

      setGhostMood('success', 'Login approved. Welcome back.', 1400);
      token = response.token;
      currentUser = response.user || null;
      sessionStorage.setItem('hsf_token', token);
      sessionStorage.setItem('hsf_user', JSON.stringify(currentUser || null));
      if (message) {
        message.hidden = false;
        message.classList.add('is-success');
        message.textContent = 'Login successful. Opening your dashboard...';
      }
      await new Promise((resolve) => window.setTimeout(resolve, 850));
      document.body.classList.remove('login-mode');
      wrap.remove();
      main.style.display = 'grid';
      applyRoleAccess();
      syncAdminSessionUi();
      await loadAdmin();
    } catch (err) {
      const errorText = String(err.message || '').trim();
      const lower = errorText.toLowerCase();
      let feedback = 'Login failed. Please try again.';

      if (lower.includes('invalid credentials')) {
        feedback = 'Your username or password is incorrect. Please try again.';
      } else if (lower.includes('inactive')) {
        feedback = 'This user account is inactive.';
      } else if (
        lower.includes('unable to reach the back office server') ||
        lower.includes('endpoint not found') ||
        lower.includes('invalid back office server response') ||
        lower.includes('back office server error')
      ) {
        feedback = 'The back office server is not connected on this website yet.';
      } else if (errorText) {
        feedback = errorText;
      }

      setGhostMood('error', feedback, 3200);
      if (message) {
        message.hidden = false;
        message.classList.add('is-error');
        message.textContent = feedback;
      } else {
        alert(feedback);
      }
    }
  });
}
async function loadAdminContent() {
  if (!document.body.classList.contains('admin-body') || !token) return;
  if (!document.getElementById('content')) return;

  const content = await req('/admin/content', {}, true);
  adminContentState.team = content.team || [];
  adminContentState.gallery = content.gallery || [];

  setTeamAdmin(adminContentState.team);
  setGalleryAdmin(adminContentState.gallery);
}

async function loadAdminUsers() {
  if (!document.body.classList.contains('admin-body') || !token) return;
  if (!currentUser || currentUser.role !== 'admin') return;

  const data = await req('/admin/users', {}, true);
  adminContentState.users = data.users || [];
  setUsersAdmin(adminContentState.users);
}

async function loadAdminInventory() {
  if (!document.body.classList.contains('admin-body') || !token) return;
  if (!document.getElementById('inventory')) return;

  const data = await req('/admin/inventory', {}, true);
  setInventory(data.summary || [], data.transactions || []);
}

async function loadAdmin() {
  if (!document.body.classList.contains('admin-body') || !token) return;

  try {
    const overview = await req('/admin/overview', {}, true);

    if (overview.user) {
      currentUser = overview.user;
      sessionStorage.setItem('hsf_user', JSON.stringify(currentUser));
    }

    applyRoleAccess();
    setKpis(overview.kpis);
    setAdminStats(overview.stats);

    const kpiForm = document.getElementById('kpiForm');
    if (kpiForm) {
      kpiForm.kitsDistributed.value = overview.kpis.kitsDistributed;
      kpiForm.beneficiariesServed.value = overview.kpis.beneficiariesServed;
      kpiForm.schoolPartners.value = overview.kpis.schoolPartners;
    }
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('unauthorized') || msg.includes('forbidden')) {
      sessionStorage.removeItem('hsf_token');
      sessionStorage.removeItem('hsf_user');
      token = '';
      currentUser = null;
      buildLogin();
    } else {
      alert(err.message || 'Unable to load dashboard.');
    }
    return;
  }

  try {
    const list = await req('/admin/interactions', {}, true);
    setInteractions(list.interactions || []);
  } catch {
    // Keep dashboard visible even if interactions call fails.
  }

  try {
    await loadAdminContent();
  } catch {
    // Keep dashboard usable if content call fails.
  }

  try {
    await loadAdminUsers();
  } catch {
    // Non-admin users cannot view users list.
  }

  try {
    await loadAdminInventory();
  } catch {
    // Keep dashboard usable if inventory call fails.
  }
}

function bindContentManager() {
  const teamForm = document.getElementById('teamMemberForm');
  const galleryForm = document.getElementById('galleryForm');
  if (!teamForm || !galleryForm) return;

  const teamReset = document.getElementById('teamMemberReset');
  const galleryReset = document.getElementById('galleryReset');
  const teamPhotoUrlInput = document.getElementById('teamMemberPhotoUrl');
  const teamPhotoFileInput = document.getElementById('teamMemberPhotoFile');
  const teamPhotoFileName = document.getElementById('teamMemberPhotoFileName');
  const teamPhotoPreviewWrap = document.getElementById('teamMemberPhotoPreviewWrap');
  const teamPhotoPreview = document.getElementById('teamMemberPhotoPreview');

  let uploadedTeamPhotoDataUrl = '';

  const setTeamPhotoPreview = (src) => {
    if (!teamPhotoPreviewWrap || !teamPhotoPreview) return;
    const clean = String(src || "").trim();
    if (!clean) {
      teamPhotoPreview.removeAttribute('src');
      teamPhotoPreviewWrap.hidden = true;
      return;
    }

    teamPhotoPreview.src = clean;
    teamPhotoPreviewWrap.hidden = false;
  };

  const toDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error('Could not read selected image file.'));
      reader.readAsDataURL(file);
    });

  if (teamPhotoUrlInput) {
    teamPhotoUrlInput.addEventListener('input', () => {
      const url = String(teamPhotoUrlInput.value || "").trim();
      if (url) {
        uploadedTeamPhotoDataUrl = '';
        if (teamPhotoFileInput) teamPhotoFileInput.value = '';
        if (teamPhotoFileName) teamPhotoFileName.textContent = 'No local file selected.';
        setTeamPhotoPreview(url);
        return;
      }

      if (!uploadedTeamPhotoDataUrl) setTeamPhotoPreview("");
    });
  }

  if (teamPhotoFileInput) {
    teamPhotoFileInput.addEventListener('change', async () => {
      const file = teamPhotoFileInput.files && teamPhotoFileInput.files[0];

      if (!file) {
        uploadedTeamPhotoDataUrl = '';
        if (teamPhotoFileName) teamPhotoFileName.textContent = 'No local file selected.';
        const fallbackUrl = String(teamPhotoUrlInput ? teamPhotoUrlInput.value : "").trim();
        setTeamPhotoPreview(fallbackUrl);
        return;
      }

      if (teamPhotoFileName) {
        teamPhotoFileName.textContent = `Selected file: ${file.name}`;
      }

      try {
        uploadedTeamPhotoDataUrl = await toDataUrl(file);
        if (teamPhotoUrlInput) teamPhotoUrlInput.value = "";
        setTeamPhotoPreview(uploadedTeamPhotoDataUrl);
      } catch (err) {
        uploadedTeamPhotoDataUrl = '';
        alert(err.message || "Could not process selected headshot image.");
      }
    });
  }

  if (teamReset) {
    teamReset.addEventListener('click', () => {
      uploadedTeamPhotoDataUrl = '';
      clearTeamForm();
    });
  }

  if (galleryReset) galleryReset.addEventListener("click", clearGalleryForm);

  teamForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.getElementById("teamMemberId").value;
    let photoUrl = String(teamPhotoUrlInput ? teamPhotoUrlInput.value : "").trim();
    if (uploadedTeamPhotoDataUrl) photoUrl = uploadedTeamPhotoDataUrl;

    if (!photoUrl) {
      alert("Please provide a headshot URL or upload a local headshot image.");
      return;
    }

    const payload = {
      name: document.getElementById("teamMemberName").value,
      role: document.getElementById("teamMemberRole").value,
      bio: document.getElementById("teamMemberBio").value,
      photoUrl,
      sortOrder: document.getElementById("teamMemberSortOrder").value
    };

    try {
      const data = id
        ? await req(`/admin/team/${id}`, { method: "PUT", body: JSON.stringify(payload) }, true)
        : await req("/admin/team", { method: "POST", body: JSON.stringify(payload) }, true);

      adminContentState.team = data.team || [];
      setTeamAdmin(adminContentState.team);
      uploadedTeamPhotoDataUrl = '';
      clearTeamForm();
      alert("Team member saved.");
      await loadPublicContent();
    } catch (err) {
      alert(err.message || "Could not save team member.");
    }
  });

  galleryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.getElementById("galleryId").value;
    const payload = {
      imageUrl: document.getElementById("galleryImageUrl").value,
      caption: document.getElementById("galleryCaption").value,
      altText: document.getElementById("galleryAltText").value,
      sortOrder: document.getElementById("gallerySortOrder").value
    };

    try {
      const data = id
        ? await req(`/admin/gallery/${id}`, { method: "PUT", body: JSON.stringify(payload) }, true)
        : await req("/admin/gallery", { method: "POST", body: JSON.stringify(payload) }, true);

      adminContentState.gallery = data.gallery || [];
      setGalleryAdmin(adminContentState.gallery);
      clearGalleryForm();
      alert("Gallery item saved.");
      await loadPublicContent();
    } catch (err) {
      alert(err.message || "Could not save gallery item.");
    }
  });

  const teamTable = document.getElementById("teamAdminTable");
  if (teamTable) {
    teamTable.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const editBtn = target.closest(".admin-edit-team");
      const deleteBtn = target.closest(".admin-delete-team");

      if (editBtn) {
        const id = Number(editBtn.dataset.id);
        const member = adminContentState.team.find((item) => Number(item.id) === id);
        if (!member) return;

        document.getElementById("teamMemberId").value = String(member.id);
        document.getElementById("teamMemberName").value = member.name || "";
        document.getElementById("teamMemberRole").value = member.role || "";
        document.getElementById("teamMemberBio").value = member.bio || "";
        if (teamPhotoUrlInput) teamPhotoUrlInput.value = member.photoUrl || "";
        document.getElementById("teamMemberSortOrder").value = String(member.sortOrder || 0);

        uploadedTeamPhotoDataUrl = '';
        if (teamPhotoFileInput) teamPhotoFileInput.value = '';
        if (teamPhotoFileName) teamPhotoFileName.textContent = 'No local file selected.';
        setTeamPhotoPreview(member.photoUrl || "");
        return;
      }

      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.id);
        if (!confirm("Delete this team member?")) return;

        try {
          const data = await req(`/admin/team/${id}`, { method: "DELETE" }, true);
          adminContentState.team = data.team || [];
          setTeamAdmin(adminContentState.team);
          uploadedTeamPhotoDataUrl = '';
          clearTeamForm();
          alert("Team member deleted.");
          await loadPublicContent();
        } catch (err) {
          alert(err.message || "Could not delete team member.");
        }
      }
    });
  }

  const galleryTable = document.getElementById("galleryAdminTable");
  if (galleryTable) {
    galleryTable.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const editBtn = target.closest(".admin-edit-gallery");
      const deleteBtn = target.closest(".admin-delete-gallery");

      if (editBtn) {
        const id = Number(editBtn.dataset.id);
        const item = adminContentState.gallery.find((row) => Number(row.id) === id);
        if (!item) return;

        document.getElementById("galleryId").value = String(item.id);
        document.getElementById("galleryImageUrl").value = item.imageUrl || "";
        document.getElementById("galleryCaption").value = item.caption || "";
        document.getElementById("galleryAltText").value = item.altText || "";
        document.getElementById("gallerySortOrder").value = String(item.sortOrder || 0);
        return;
      }

      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.id);
        if (!confirm("Delete this gallery item?")) return;

        try {
          const data = await req(`/admin/gallery/${id}`, { method: "DELETE" }, true);
          adminContentState.gallery = data.gallery || [];
          setGalleryAdmin(adminContentState.gallery);
          clearGalleryForm();
          alert("Gallery item deleted.");
          await loadPublicContent();
        } catch (err) {
          alert(err.message || "Could not delete gallery item.");
        }
      }
    });
  }
}

function bindInventoryManager() {
  const inventoryForm = document.getElementById('inventoryForm');
  if (!inventoryForm) return;

  inventoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(inventoryForm);

    try {
      const result = await req(
        '/admin/inventory',
        {
          method: 'POST',
          body: JSON.stringify({
            itemName: data.get('itemName'),
            category: data.get('category'),
            direction: data.get('direction'),
            quantity: data.get('quantity'),
            note: data.get('note')
          })
        },
        true
      );

      setInventory(result.summary || [], result.transactions || []);
      inventoryForm.reset();
      alert('Inventory updated successfully.');
    } catch (err) {
      alert(err.message || 'Could not save inventory movement.');
    }
  });
}

function bindUserManager() {
  const form = document.getElementById('userForm');
  if (!form) return;

  const resetButton = document.getElementById('userReset');
  if (resetButton) {
    resetButton.addEventListener('click', clearUserForm);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('userId').value;
    const payload = {
      fullName: document.getElementById('userFullName').value,
      username: document.getElementById('userUsername').value,
      password: document.getElementById('userPassword').value,
      role: document.getElementById('userRole').value,
      isActive: document.getElementById('userActive').checked
    };

    try {
      const data = id
        ? await req(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }, true)
        : await req('/admin/users', { method: 'POST', body: JSON.stringify(payload) }, true);

      adminContentState.users = data.users || [];
      setUsersAdmin(adminContentState.users);
      clearUserForm();
      alert(id ? 'User updated successfully.' : 'User created successfully.');
      await loadAdmin();
    } catch (err) {
      alert(err.message || (id ? 'Could not update user.' : 'Could not create user.'));
    }
  });

  const usersTable = document.getElementById('usersTable');
  if (!usersTable) return;

  usersTable.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editBtn = target.closest('.admin-edit-user');
    const toggleBtn = target.closest('.admin-toggle-user');

    if (editBtn) {
      const id = Number(editBtn.dataset.id);
      const user = adminContentState.users.find((item) => Number(item.id) === id);
      if (!user) return;

      document.getElementById('userId').value = String(user.id);
      document.getElementById('userFullName').value = user.fullName || '';
      document.getElementById('userUsername').value = user.username || '';
      document.getElementById('userPassword').value = '';
      document.getElementById('userRole').value = user.role || 'member';
      document.getElementById('userActive').checked = !!user.isActive;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (toggleBtn) {
      const id = Number(toggleBtn.dataset.id);
      const user = adminContentState.users.find((item) => Number(item.id) === id);
      if (!user) return;

      const nextState = !user.isActive;

      try {
        const data = await req(
          `/admin/users/${id}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              fullName: user.fullName,
              username: user.username,
              password: '',
              role: user.role,
              isActive: nextState
            })
          },
          true
        );

        adminContentState.users = data.users || [];
        setUsersAdmin(adminContentState.users);

        const editingId = Number(document.getElementById('userId').value || 0);
        if (editingId === id) {
          document.getElementById('userActive').checked = nextState;
        }

        alert(nextState ? 'User authorized successfully.' : 'User access removed successfully.');
        await loadAdmin();
      } catch (err) {
        alert(err.message || 'Could not update user authorization.');
      }
    }
  });
}

function bindAdmin() {
  document.querySelectorAll('.tab-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-link').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(btn.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });

  const kpiForm = document.getElementById('kpiForm');
  if (kpiForm) {
    kpiForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(kpiForm);

      try {
        await req(
          '/admin/kpis',
          {
            method: 'PUT',
            body: JSON.stringify({
              kitsDistributed: data.get('kitsDistributed'),
              beneficiariesServed: data.get('beneficiariesServed'),
              schoolPartners: data.get('schoolPartners')
            })
          },
          true
        );

        alert('Public KPI values updated successfully.');
        await loadAdmin();
      } catch (err) {
        alert(err.message || 'Could not update KPIs.');
      }
    });
  }

  bindPasswordToggles();
  bindContentManager();
  bindInventoryManager();
  bindUserManager();
}
document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.classList.contains('site-body')) {
    showPublicLoader();
  }

  try {
    bindPublicActions();
    bindAdmin();
    bindAdminSessionControls();
    buildLogin();

    initDonationCalculator();
    initFaq();
    initRolePicker();
    initVolunteerChoice();
    initRevealAndProgress();
    initSmoothAnchors();
    initPublicNav();

    await trackVisit();
    await loadPublic();
    await loadPublicContent();
    await loadAdmin();
  } finally {
    hidePublicLoader();
  }
});



















