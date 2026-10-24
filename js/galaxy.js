// 数据 → 银河
// 半径 = 全局真实时间（越早越靠银心，年份环因此可读）
// 颜色三套（时刻/仓库/周末），旋臂 = 仓库，当日密度 = 亮度，爆肝日 = 巨新星
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const R_IN = 7, R_OUT = 38;
// 仓库维度的区分色板（时刻模式只在标签/图例里用它做淡混合）
const ARM_TINTS = ['#ffd166', '#4ecdc4', '#ef476f', '#54a0ff', '#c77dff', '#f78c6b'];
// 时刻色带：凌晨深蓝 → 清晨青 → 正午暖白 → 傍晚橙 → 夜里回到蓝
const HOUR_STOPS = [
  [0, 77, 111, 255], [4, 111, 157, 255], [7, 168, 221, 255], [11, 255, 243, 196],
  [15, 255, 217, 143], [18, 255, 157, 92], [20, 255, 138, 122], [22, 126, 157, 255], [24, 77, 111, 255],
];
const WEEKEND_COL = [255, 150, 82];
const WORKDAY_COL = [112, 150, 255];
const PLANET_COL = [255, 214, 110];

function hourColor(h) {
  for (let i = 0; i < HOUR_STOPS.length - 1; i++) {
    const [h0, r0, g0, b0] = HOUR_STOPS[i], [h1, r1, g1, b1] = HOUR_STOPS[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0 || 1);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
    }
  }
  return HOUR_STOPS[0].slice(1);
}
function hexRgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
function mix(c1, c2, t) { return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]; }

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function buildGalaxy(profile, commitLists) {
  const rnd = mulberry32(hashStr(profile.login || 'galaxy'));
  const gauss = () => {
    const u = Math.max(1e-9, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // 仓库元信息（语言等）带进旋臂
  const repoMeta = new Map(commitLists.map((a) => [a.repo, a]));

  const arms = commitLists
    .filter((a) => a.commits.length > 0)
    .sort((a, b) => b.commits.length - a.commits.length)
    .slice(0, ARM_TINTS.length);

  // 全局时间范围
  let minT = Infinity, maxT = -Infinity;
  for (const a of arms) for (const c of a.commits) {
    if (c.date < minT) minT = c.date;
    if (c.date > maxT) maxT = c.date;
  }
  const span = maxT - minT || 1;
  const timeT = (d) => (d - minT) / span;

  // 当日提交密度
  const dayCount = new Map(), dayRepo = new Map();
  for (const a of arms) for (const c of a.commits) {
    const k = dateKey(c.date);
    dayCount.set(k, (dayCount.get(k) || 0) + 1);
    const dr = dayRepo.get(k) || new Map();
    dr.set(a.repo, (dr.get(a.repo) || 0) + 1);
    dayRepo.set(k, dr);
  }
  let maxDay = 1;
  for (const n of dayCount.values()) if (n > maxDay) maxDay = n;

  const A = arms.length;
  const stars = [];
  const byDay = new Map(); // dateKey -> stars[]
  let total = 0, night = 0, weekend = 0;
  const hourHist = new Array(24).fill(0);
  const yearCount = new Map();

  arms.forEach((arm, k) => {
    const meta = repoMeta.get(arm.repo) || {};
    arm.tint = ARM_TINTS[k % ARM_TINTS.length];
    arm.language = meta.language || null;
    const tintRgb = hexRgb(arm.tint);
    const baseAngle = (k * 2 * Math.PI) / A + rnd() * 0.8;
    const commits = arm.commits.slice().sort((a, b) => a.date - b.date);
    arm.count = commits.length;

    commits.forEach((c) => {
      const t = timeT(c.date); // 0=最早 1=最新
      // 半径与时间「反向」：越新的提交越靠近银心——银心就是现在的你
      const r = R_IN + (1 - t) * (R_OUT - R_IN) + (rnd() - 0.5) * 2.0;
      const theta = baseAngle + r * 0.3 + (rnd() - 0.5) * 0.13;
      const z = gauss() * (0.7 + t * 1.8);
      const hour = c.date.getHours();
      const dow = c.date.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const dayN = dayCount.get(dateKey(c.date)) || 1;
      const d = dayN / maxDay;
      const size = 1.5 + 3.4 * Math.pow(d, 0.75) + rnd() * 0.7;

      total++;
      if (hour >= 22 || hour < 7) night++;
      if (isWeekend) weekend++;
      hourHist[hour]++;
      yearCount.set(c.date.getFullYear(), (yearCount.get(c.date.getFullYear()) || 0) + 1);

      const colHour = mix(hourColor(hour), tintRgb, 0.15);
      const colRepo = mix(tintRgb, [255, 255, 255], 0.12);
      const colWeekend = isWeekend ? WEEKEND_COL.slice() : WORKDAY_COL.slice();
      const s = {
        x: r * Math.cos(theta), y: z, z: r * Math.sin(theta),
        r, theta, t, hour, dayN, isWeekend, arm: k,
        size, seed: rnd(),
        colHour, colRepo, colWeekend, color: colHour,
        repo: arm.repo, owner: arm.owner, sha: c.sha, msg: c.msg,
        date: c.date, dateStr: dateKey(c.date),
        year: c.date.getFullYear(),
      };
      stars.push(s);
      const k2 = dateKey(c.date);
      if (!byDay.has(k2)) byDay.set(k2, []);
      byDay.get(k2).push(s);
    });
  });

  // 爆肝日 → 巨新星（暖金色大星）：单日提交 Top 5 且 ≥3 次
  const planets = [...dayCount.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => {
      const group = byDay.get(k);
      let x = 0, y = 0, z = 0;
      for (const s of group) { x += s.x; y += s.y; z += s.z; }
      x /= group.length; y /= group.length; z /= group.length;
      // 归属当天提交最多的仓库
      let topRepo = group[0].repo, topN = 0;
      const cnt = new Map();
      for (const s of group) {
        cnt.set(s.repo, (cnt.get(s.repo) || 0) + 1);
        if (cnt.get(s.repo) > topN) { topN = cnt.get(s.repo); topRepo = s.repo; }
      }
      const armIdx = arms.findIndex((a) => a.repo === topRepo);
      return {
        x, y: y + 0.3, z, r: Math.hypot(x, z), theta: Math.atan2(z, x), t: timeT(group[0].date),
        size: Math.min(11, 5.5 + n * 0.4), seed: rnd(),
        color: PLANET_COL, colHour: PLANET_COL, colRepo: PLANET_COL, colWeekend: PLANET_COL,
        arm: armIdx >= 0 ? armIdx : 0, planet: true, dayN: n,
        repo: topRepo, owner: group[0].owner, sha: null,
        msg: `爆肝日：单日 ${n} 次提交`, date: group[0].date, dateStr: k,
        year: group[0].date.getFullYear(), hour: null, isWeekend: group[0].isWeekend,
      };
    });

  // 年份环：每年 1 月 1 日对应一条刻度环（时间反向：新年份在内，「现在」在银心）
  const rings = [];
  const y0 = minT.getFullYear(), y1 = maxT.getFullYear();
  for (let y = y0; y <= y1; y++) {
    const jan1 = new Date(y, 0, 1);
    const t = timeT(jan1);
    if (t > 0.02 && t < 1.02) rings.push({ year: y, t, r: R_IN + (1 - Math.min(t, 1)) * (R_OUT - R_IN), count: yearCount.get(y) || 0 });
  }
  rings.push({ year: null, t: 1, r: R_IN - 2.4, count: 0, now: true });

  const created = new Date(profile.created_at);
  const ageYears = Math.max(0.1, (Date.now() - created) / 31557600000);

  // 银河判词：按数据特征生成称号与一句话解读
  const nightPct = total ? Math.round((night / total) * 100) : 0;
  const weekendPct = total ? Math.round((weekend / total) * 100) : 0;
  const peakHour = hourHist.indexOf(Math.max(...hourHist));
  const bestDayEntry = [...dayCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const badges = [];
  if (maxDay >= 10) badges.push(['💫 超新星制造机', `最猛的一天 ${bestDayEntry[0]}，你一口气点亮了 ${maxDay} 颗星。`]);
  if (nightPct >= 30) badges.push(['🌙 夜航星系', `${nightPct}% 的星在深夜点亮，这片银河偏爱夜幕。`]);
  else if (peakHour >= 5 && peakHour <= 11) badges.push(['🌅 日出星系', `你的星大多在清晨点亮，生物钟峰值出现在 ${peakHour} 点。`]);
  if (weekendPct >= 30) badges.push(['🌴 周末战士', `每 ${Math.max(2, Math.round(100 / Math.max(1, weekendPct)))} 颗星就有 1 颗诞生于周末。`]);
  if (ageYears >= 10) badges.push(['🌀 古老旋涡', `从 ${minT.getFullYear()} 年旋转至今，已发光 ${ageYears.toFixed(0)} 年。`]);
  if (!badges.length) badges.push(['✨ 漫游星云', `${total} 颗星散落在时间星盘上，静待下一次爆发。`]);
  const verdict = { title: badges[0][0], text: badges.slice(0, 2).map((b) => b[1]).join('') };

  return {
    stars: stars.concat(planets),
    arms,
    rings,
    stats: {
      login: profile.login,
      name: profile.name || profile.login,
      avatar: profile.avatar_url,
      total,
      capped: commitLists.some((a) => a.capped),
      ageYears,
      nightPct,
      weekendPct,
      hourHist,
      verdict,
      firstYear: minT === Infinity ? null : minT.getFullYear(),
      lastYear: maxT === -Infinity ? null : maxT.getFullYear(),
      bestDay: bestDayEntry ? bestDayEntry[0] : null,
      bestCount: maxDay,
      dateFrom: minT === Infinity ? null : minT,
      dateTo: maxT === -Infinity ? null : maxT,
    },
  };
}
