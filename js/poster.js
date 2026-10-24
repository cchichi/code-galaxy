// 星空海报：把银河俯视图 + 统计文字绘制成一张可分享的竖版 PNG
const W = 1242, H = 1754;
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export function makePoster(galaxy, avatarImg) {
  const { stats, stars, arms } = galaxy;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // 背景
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#060915');
  bg.addColorStop(0.5, '#0a0f24');
  bg.addColorStop(1, '#05070f');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 420; i++) {
    g.globalAlpha = 0.25 + Math.random() * 0.5;
    g.fillStyle = Math.random() < 0.8 ? '#cdd8ff' : '#ffe9c9';
    const r = Math.random() * 1.4;
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // 银河（俯视图：x-z 平面）
  const cx = W / 2, cy = H * 0.44;
  const scale = Math.min(W * 0.82, H * 0.46) / 84;
  g.globalCompositeOperation = 'lighter';

  const core = g.createRadialGradient(cx, cy, 0, cx, cy, 120);
  core.addColorStop(0, 'rgba(255,238,200,0.9)');
  core.addColorStop(0.3, 'rgba(200,190,255,0.25)');
  core.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = core;
  g.fillRect(cx - 130, cy - 130, 260, 260);

  for (const s of stars) {
    const x = cx + s.x * scale, y = cy + s.z * scale;
    const rad = Math.max(1.2, s.size * 1.05);
    g.fillStyle = rgba(s.color, 0.22);
    g.beginPath(); g.arc(x, y, rad * 2.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgba(s.color, 0.95);
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  // 顶部标题
  g.textAlign = 'center';
  g.fillStyle = '#8fa3d4';
  g.font = `600 30px ${FONT}`;
  g.fillText('C O D E   G A L A X Y', W / 2, 118);
  // 名字过长时自动缩字号，并给左侧头像留位
  let nameSize = 78;
  do { g.font = `600 ${nameSize}px ${FONT}`; if (g.measureText(stats.name).width <= W - 380) break; nameSize -= 6; } while (nameSize > 40);
  g.fillStyle = '#e8ecf8';
  g.fillText(stats.name, W / 2 + 40, 210);
  g.fillStyle = '#9aa3c0';
  g.font = `26px ${FONT}`;
  const reposTxt = `${arms.length} 个仓库 · ${stats.total} 次提交 · ${stats.capped ? '展示部分' : '全部公开'}`;
  g.fillText(reposTxt, W / 2, 258);

  // 银河判词
  if (stats.verdict) {
    g.fillStyle = '#ffd977';
    g.font = `600 34px ${FONT}`;
    g.fillText(stats.verdict.title, W / 2, 310);
    g.fillStyle = '#8d97ba';
    g.font = `24px ${FONT}`;
    const line = stats.verdict.text.length > 52 ? stats.verdict.text.slice(0, 52) + '…' : stats.verdict.text;
    g.fillText(line, W / 2, 352);
  }

  // 头像
  const avR = 54, ax = 150, ay = 182;
  if (avatarImg) {
    g.save();
    g.beginPath(); g.arc(ax, ay, avR, 0, Math.PI * 2); g.clip();
    g.drawImage(avatarImg, ax - avR, ay - avR, avR * 2, avR * 2);
    g.restore();
    g.strokeStyle = 'rgba(143,180,255,0.4)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(ax, ay, avR + 2, 0, Math.PI * 2); g.stroke();
  }

  // 统计卡
  const cards = [
    ['⭐', '星数', `${stats.total} 颗`],
    ['🌌', '银河年龄', `${stats.ageYears.toFixed(1)} 年`],
    ['🦉', '夜猫子指数', `${stats.nightPct}%`],
    ['✨', '最亮的一天', stats.bestDay ? `${stats.bestDay} · ${stats.bestCount} 次` : '–'],
  ];
  const cw = (W - 120 - 24) / 2, ch = 120, gap = 20;
  const cy0 = H - 480;
  cards.forEach((cd, i) => {
    const x = 60 + (i % 2) * (cw + gap);
    const y = cy0 + Math.floor(i / 2) * (ch + gap);
    g.fillStyle = 'rgba(16, 22, 46, 0.72)';
    roundRect(g, x, y, cw, ch, 18);
    g.fill();
    g.strokeStyle = 'rgba(143,180,255,0.16)';
    g.lineWidth = 1.5;
    roundRect(g, x, y, cw, ch, 18);
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = '#9aa3c0';
    g.font = `24px ${FONT}`;
    g.fillText(`${cd[0]} ${cd[1]}`, x + 26, y + 42);
    g.fillStyle = '#e8ecf8';
    g.font = `600 32px ${FONT}`;
    g.fillText(cd[2], x + 26, y + 88);
  });

  // 旋臂图例（横排，超宽自动减项）
  g.textAlign = 'left';
  g.fillStyle = '#8fa3d4';
  g.font = `22px ${FONT}`;
  g.fillText('旋臂 · 仓库', 60, H - 196);
  let legendArms = arms.slice(0, 4);
  g.font = `26px ${FONT}`;
  while (legendArms.length > 1) {
    const txt = legendArms.map((a) => `${a.repo} ×${a.count}`).join('   ·   ');
    if (g.measureText(txt).width <= W - 120) break;
    legendArms.pop();
  }
  g.fillStyle = '#cdd6ee';
  g.fillText(legendArms.map((a) => `${a.repo} ×${a.count}`).join('   ·   '), 60, H - 152);

  // 时间范围与落款
  g.textAlign = 'center';
  g.fillStyle = '#5c6685';
  g.font = `24px ${FONT}`;
  const fmt = (d) => d ? `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}` : '';
  g.fillText(`${fmt(stats.dateFrom)} — ${fmt(stats.dateTo)}   ·   @${stats.login}`, W / 2, H - 100);
  g.fillStyle = '#46507a';
  g.font = `22px ${FONT}`;
  g.fillText('把你的 GitHub 提交记录变成星空 · code-galaxy', W / 2, H - 52);

  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function downloadPoster(galaxy) {
  const tryDraw = (img) => {
    const canvas = makePoster(galaxy, img || null);
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `code-galaxy-${galaxy.stats.login}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  };
  // 头像跨域加载失败也不影响海报生成
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => tryDraw(img);
  img.onerror = () => tryDraw(null);
  img.src = galaxy.stats.avatar;
}
