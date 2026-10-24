import { fetchProfile, fetchTopRepos, fetchCommits, GhError } from './github.js';
import { buildGalaxy } from './galaxy.js';
import * as scene from './scene.js';
import { downloadPoster } from './poster.js';

const $ = (id) => document.getElementById(id);
let galaxy = null;

/* ---------- UI 基础 ---------- */
function setLoading(text) { $('loading').classList.remove('hidden'); $('loading-text').textContent = text; }
function hideLoading() { $('loading').classList.add('hidden'); }
function showError(msg) { hideLoading(); $('error-text').textContent = msg; $('error').classList.remove('hidden'); }
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------- 悬浮提示 ---------- */
function renderTooltip(e) {
  const tip = $('tooltip');
  const star = scene.getHoveredStar();
  if (!e || !star) { tip.classList.add('hidden'); return; }
  const h = String(star.hour).padStart(2, '0');
  tip.innerHTML = `<span class="t-repo">${star.repo}</span><br>` +
    `<span class="t-msg">${escapeHtml(star.msg || '(无提交信息)')}</span><br>` +
    `<span class="t-date">${star.dateStr} ${h}:00 · 点击查看提交</span>`;
  tip.classList.remove('hidden');
  const x = Math.min(e.x + 16, window.innerWidth - tip.offsetWidth - 12);
  const y = Math.min(e.y + 16, window.innerHeight - tip.offsetHeight - 12);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- 主流程 ---------- */
async function launch(input) {
  const login = String(input || '').trim().replace(/^@/, '');
  if (!login) return;
  const token = ($('token').value || '').trim() || null;
  $('landing').classList.add('fade-out');
  setLoading('正在读取用户…');
  try {
    const profile = await fetchProfile(login, token);
    setLoading('正在挑选最亮的仓库…');
    const repos = await fetchTopRepos(login, token, token ? 8 : 5);

    const commitLists = [];
    let n = 0;
    for (const r of repos) {
      setLoading(`正在收集星尘 · ${r.name}（已 ${n} 颗）`);
      const maxPages = token ? 3 : 1;
      const commits = await fetchCommits(r.owner.login, r.name, login, token, maxPages);
      if (commits.length) {
        commitLists.push({ repo: r.name, owner: r.owner.login, commits, capped: commits.length >= maxPages * 100 });
        n += commits.length;
      }
    }
    if (!n) throw new GhError('没有找到可识别的公开提交。账号刚创建、仓库都是空的？也可以填 Token 试试更深的抓取。', 0);

    galaxy = buildGalaxy(profile, commitLists);
    window.__galaxy = galaxy; // 调试钩子：控制台里可直接查看银河数据
    scene.setGalaxy(galaxy);
    fillHud(profile);
    $('hud').classList.remove('hidden');
    history.replaceState(null, '', location.pathname + '?u=' + encodeURIComponent(login));
  } catch (e) {
    showError(e.message || '出错了，请稍后再试');
    $('landing').classList.remove('fade-out');
    return;
  } finally {
    hideLoading();
  }
}

function fillHud(profile) {
  const s = galaxy.stats;
  $('st-commits').textContent = `${s.total} 颗${s.capped ? '+' : ''}`;
  $('st-age').textContent = `${s.ageYears.toFixed(1)} 年`;
  $('st-night').textContent = `${s.nightPct}%`;
  $('st-best').textContent = s.bestDay ? `${s.bestDay} · ${s.bestCount} 次` : '–';

  $('p-avatar').src = s.avatar;
  $('p-name').textContent = s.name;
  $('p-login').textContent = '@' + s.login;

  const ul = $('arms');
  ul.innerHTML = '';
  for (const a of galaxy.arms) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${a.tint};color:${a.tint}"></span>` +
      `<span>${escapeHtml(a.repo)}</span><span class="n">×${a.count}</span>`;
    ul.appendChild(li);
  }
  $('arms-card').classList.remove('hidden');
}

/* ---------- 事件绑定 ---------- */
$('launch-form').addEventListener('submit', (e) => { e.preventDefault(); launch($('username').value); });
document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
  $('username').value = b.dataset.u;
  launch(b.dataset.u);
}));
$('error-back').addEventListener('click', () => {
  $('error').classList.add('hidden');
  $('landing').classList.remove('fade-out');
});
$('btn-reset').addEventListener('click', () => {
  $('hud').classList.add('hidden');
  $('tooltip').classList.add('hidden');
  $('landing').classList.remove('fade-out');
  $('username').focus();
});
$('btn-poster').addEventListener('click', () => {
  if (!galaxy) return;
  downloadPoster(galaxy);
  toast('星空海报已生成 🌌');
});
$('btn-share').addEventListener('click', async () => {
  const url = location.origin + location.pathname + '?u=' + galaxy.stats.login;
  try {
    await navigator.clipboard.writeText(url);
    toast('链接已复制，发给朋友看你的银河吧 ✨');
  } catch {
    prompt('复制这个链接：', url);
  }
});

// Token 只存本地
const savedToken = localStorage.getItem('cg-token') || '';
if (savedToken) $('token').value = savedToken;
$('token').addEventListener('change', () => localStorage.setItem('cg-token', $('token').value.trim()));

/* ---------- 启动 ---------- */
try {
  scene.init($('space'), {
    hover: renderTooltip,
    clickStar: (index) => {
      const s = scene.getStar(index);
      if (s && s.sha) window.open(`https://github.com/${s.owner}/${s.repo}/commit/${s.sha}`, '_blank');
    },
  });
} catch (e) {
  showError('你的浏览器不支持 WebGL，无法渲染银河。换个新一点的浏览器试试？');
}

const u = new URLSearchParams(location.search).get('u');
if (u) { $('username').value = u; launch(u); }
