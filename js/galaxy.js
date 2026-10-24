// 数据 → 银河：仓库=旋臂，提交时刻=冷暖色，当日提交密度=亮度
// 用登录名做随机种子，同一个人生成的银河永远一样
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
const ARM_TINTS = ['#ffffff', '#ffd9a0', '#a0c8ff', '#ffb0b0', '#c0ffe0', '#e0c8ff'];

// 时刻 → 颜色：凌晨深蓝 → 清晨青 → 正午暖白 → 傍晚橙 → 夜里回到蓝
const HOUR_STOPS = [
  [0, 77, 111, 255], [4, 111, 157, 255], [7, 168, 221, 255], [11, 255, 243, 196],
  [15, 255, 217, 143], [18, 255, 157, 92], [20, 255, 138, 122], [22, 126, 157, 255], [24, 77, 111, 255],
];
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

  const arms = commitLists
    .filter((a) => a.commits.length > 0)
    .sort((a, b) => b.commits.length - a.commits.length)
    .slice(0, ARM_TINTS.length);

  // 当日提交密度 → 亮度
  const dayCount = new Map();
  for (const a of arms) for (const c of a.commits) {
    const k = dateKey(c.date);
    dayCount.set(k, (dayCount.get(k) || 0) + 1);
  }
  let maxDay = 1, bestKey = null;
  for (const [k, n] of dayCount) if (n > maxDay) { maxDay = n; bestKey = k; }

  const stars = [];
  let total = 0, night = 0, minT = Infinity, maxT = -Infinity;
  const A = arms.length;

  arms.forEach((arm, k) => {
    const commits = arm.commits.slice().sort((a, b) => a.date - b.date);
    const tint = hexRgb(ARM_TINTS[k % ARM_TINTS.length]);
    const baseAngle = (k * 2 * Math.PI) / A + rnd() * 0.8;
    arm.tint = ARM_TINTS[k % ARM_TINTS.length];
    arm.count = commits.length;
    commits.forEach((c, j) => {
      const t = commits.length > 1 ? j / (commits.length - 1) : 0.5; // 0=最早(中心) 1=最新(外缘)
      const r = R_IN + t * (R_OUT - R_IN) + (rnd() - 0.5) * 2.6;
      const theta = baseAngle + r * 0.3 + (rnd() - 0.5) * 0.17;
      const z = gauss() * (1.7 - t * 1.0);
      const hour = c.date.getHours();
      const d = (dayCount.get(dateKey(c.date)) || 1) / maxDay;
      const size = 1.5 + 3.4 * Math.pow(d, 0.75) + rnd() * 0.7;
      const col = mix(hourColor(hour), tint, 0.18);

      total++;
      if (hour >= 22 || hour < 7) night++;
      if (c.date < minT) minT = c.date;
      if (c.date > maxT) maxT = c.date;

      stars.push({
        x: r * Math.cos(theta), y: z, z: r * Math.sin(theta),
        r, theta,
        color: col, size, seed: rnd(),
        repo: arm.repo, owner: arm.owner, sha: c.sha, msg: c.msg, hour,
        date: c.date, dateStr: `${c.date.getFullYear()}-${pad(c.date.getMonth() + 1)}-${pad(c.date.getDate())}`,
      });
    });
  });

  const created = new Date(profile.created_at);
  const ageYears = Math.max(0.1, (Date.now() - created) / 31557600000);

  return {
    stars, arms,
    stats: {
      login: profile.login,
      name: profile.name || profile.login,
      avatar: profile.avatar_url,
      total,
      capped: commitLists.some((a) => a.capped),
      ageYears,
      nightPct: total ? Math.round((night / total) * 100) : 0,
      bestDay: bestKey, bestCount: maxDay,
      dateFrom: minT === Infinity ? null : minT,
      dateTo: maxT === -Infinity ? null : maxT,
    },
  };
}
