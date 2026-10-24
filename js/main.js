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
  if (!e || !star || (star.t != null && star.t > scene.getLimit() + 0.002)) { tip.classList.add('hidden'); return; }
  const h = star.hour != null ? ` ${String(star.hour).padStart(2, '0')}:00` : '';
  const dayTxt = star.planet ? star.msg : `当日 ${star.dayN} 次提交`;
  tip.innerHTML = `<span class="t-repo">${star.repo}${star.planet ? ' · ⭐ 巨新星' : ''}</span><br>` +
    `<span class="t-msg">${escapeHtml(star.msg || '(无提交信息)')}</span><br>` +
    `<span class="t-date">${star.dateStr}${h} · ${dayTxt}${star.sha ? ' · 点击查看提交' : ''}</span>`;
  tip.classList.remove('hidden');
  const x = Math.min(e.x + 16, window.innerWidth - tip.offsetWidth - 12);
  const y = Math.min(e.y + 16, window.innerHeight - tip.offsetHeight - 12);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- 生物钟 24h 玫瑰图 ---------- */
function drawClock(hist) {
  const c = $('clock');
  const g = c.getContext('2d');
  const S = c.width, cx = S / 2, cy = S / 2, R = S / 2 - 16;
  g.clearRect(0, 0, S, S);
  const max = Math.max(1, ...hist);
  // 刻度圈
  g.strokeStyle = 'rgba(143,180,255,0.14)';
  g.lineWidth = 1;
  for (const f of [0.5, 1]) {
    g.beginPath(); g.arc(cx, cy, R * f, 0, Math.PI * 2); g.stroke();
  }
  // 24 根径向条：0 点在正上方，顺时针
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    const len = (0.12 + 0.88 * Math.sqrt(hist[h] / max)) * R;
    const w = (Math.PI * 2 / 24) * 0.62;
    const c1 = hourCss(h);
    g.fillStyle = c1;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, len, a - w / 2, a + w / 2);
    g.closePath();
    g.globalAlpha = 0.28 + 0.72 * (hist[h] / max);
    g.fill();
    g.globalAlpha = 1;
  }
  // 时辰标注
  g.fillStyle = '#6f7a9c';
  g.font = '10px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [[0, '0点'], [6, '6点'], [12, '12点'], [18, '18点']].forEach(([h, t]) => {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    g.fillText(t, cx + Math.cos(a) * (R + 9), cy + Math.sin(a) * (R + 9));
  });
}
function hourCss(h) {
  const stops = [[0,77,111,255],[4,111,157,255],[7,168,221,255],[11,255,243,196],[15,255,217,143],[18,255,157,92],[20,255,138,122],[22,126,157,255],[24,77,111,255]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [h0,r0,g0,b0] = stops[i], [h1,r1,g1,b1] = stops[i+1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / ((h1 - h0) || 1);
      return `rgb(${r0+(r1-r0)*t|0},${g0+(g1-g0)*t|0},${b0+(b1-b0)*t|0})`;
    }
  }
  return 'rgb(77,111,255)';
}

/* ---------- 银河判词（打字机） ---------- */
let typeTimer = null;
function typewriter(el, text) {
  clearInterval(typeTimer);
  el.textContent = '';
  let i = 0;
  typeTimer = setInterval(() => {
    i++;
    el.textContent = text.slice(0, i);
    if (i >= text.length) clearInterval(typeTimer);
  }, 42);
}

/* ---------- 时间旅行 ---------- */
function yearAt(v) {
  if (!galaxy) return '';
  let y = galaxy.stats.firstYear;
  for (const m of galaxy.rings) if (m.year != null && m.t <= v) y = m.year;
  return y;
}
$('tl-range').addEventListener('input', () => {
  const v = parseFloat($('tl-range').value);
  scene.setLimit(v);
  $('tl-year').textContent = v >= 0.998 ? '现在' : `${yearAt(v)} 年`;
});

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
        commitLists.push({ repo: r.name, owner: r.owner.login, language: r.language, commits, capped: commits.length >= maxPages * 100 });
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

  // 生物钟
  drawClock(s.hourHist);
  $('clock-meta').textContent = `夜猫子 ${s.nightPct}% · 周末 ${s.weekendPct}%`;
  $('clock-card').classList.remove('hidden');

  // 银河判词
  $('verdict').classList.remove('hidden');
  $('verdict-badge').textContent = s.verdict.title;
  typewriter($('verdict-line'), s.verdict.text);

  // 时间旅行复位
  $('tl-range').value = 1;
  $('tl-year').textContent = '现在';
  scene.setLimit(1);

  // 旋臂图例（点击过滤）
  const ul = $('arms');
  ul.innerHTML = '';
  galaxy.arms.forEach((a, k) => {
    const li = document.createElement('li');
    li.dataset.k = k;
    li.title = a.language ? `主语言：${a.language}` : a.repo;
    li.innerHTML = `<span class="dot" style="background:${a.tint};color:${a.tint}"></span>` +
      `<span>${escapeHtml(a.repo)}${a.language ? ` <span class="lang">${escapeHtml(a.language)}</span>` : ''}</span>` +
      `<span class="n">×${a.count}</span>`;
    li.addEventListener('click', () => {
      const active = li.classList.contains('active');
      ul.querySelectorAll('li').forEach((x) => x.classList.remove('active', 'dimmed'));
      if (active) {
        scene.setArmFilter(-1);
      } else {
        li.classList.add('active');
        ul.querySelectorAll('li:not(.active)').forEach((x) => x.classList.add('dimmed'));
        scene.setArmFilter(k);
      }
    });
    ul.appendChild(li);
  });
  $('arms-card').classList.remove('hidden');

  // 重置颜色模式到「时刻」
  document.querySelectorAll('#mode-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === 'hour');
  });
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
// 颜色模式切换
document.querySelectorAll('#mode-switch button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#mode-switch button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    scene.updateColors(b.dataset.mode);
  });
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
