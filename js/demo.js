// 离线演示模式：?demo=1 时不访问 GitHub API，使用内置示例数据
// 方便无网环境体验、演示与开发调试
(function () {
  if (!new URLSearchParams(location.search).has('demo')) return;

  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const REPOS = ['galaxy-demo', 'star-map', 'nebula-ui', 'comet-cli', 'pulsar-api'];
  const LANGS = ['JavaScript', 'Rust', 'TypeScript', 'Go', 'Python'];
  const MSGS = ['feat: 新增星轨绘制', 'fix: 修复星云偏移', 'docs: 更新星图说明', 'refactor: 重构渲染管线', 'chore: 升级依赖', 'perf: 优化粒子系统', 'test: 补充测试'];

  const profile = {
    login: 'stargazer',
    name: '星野漫游者',
    avatar_url: '',
    created_at: '2018-03-15T08:00:00Z',
  };

  const mk = (repo, d, hour, i) => ({
    sha: 'demo' + repo + i,
    commit: {
      author: { date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, Math.floor(rnd() * 60)).toISOString() },
      message: MSGS[Math.floor(rnd() * MSGS.length)],
    },
  });

  const commitsPool = {};
  REPOS.forEach((r, ri) => {
    const list = [];
    for (let i = 0; i < 110 + Math.floor(rnd() * 80); i++) {
      const d = new Date(2018 + Math.floor(rnd() * 9), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
      const hour = [9, 10, 11, 14, 16, 20, 22, 23, 1, 2][Math.floor(rnd() * 10)];
      list.push(mk(r, d, hour, ri + '-' + i));
    }
    // 爆肝日：几组密集提交（其中一个 ≥10 次，触发「超新星制造机」）
    const bursts = ri === 0 ? [[2024, 3, 12, 12]] : [[2021 + ri, 6, 8, 4]];
    for (const [y, m, day, n] of bursts) {
      for (let b = 0; b < n; b++) list.push(mk(r, new Date(y, m - 1, day), [9, 11, 14, 16, 20, 23, 1][b % 7], ri + '-burst' + b));
    }
    commitsPool[r] = list;
  });

  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (!u.includes('api.github.com')) return real(url, opts);
    const json = (obj) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (u.includes('/repos?')) {
      return json(REPOS.map((r, i) => ({
        name: r, owner: { login: profile.login }, language: LANGS[i],
        stargazers_count: 140 - i * 22, pushed_at: new Date().toISOString(), fork: false, archived: false,
      })));
    }
    const m = u.match(/repos\/[^/]+\/([^/]+)\/commits/);
    if (m) return json(commitsPool[m[1]] || []);
    if (/\/users\//.test(u)) return json(profile);
    return json({});
  };
  console.info('[code-galaxy] 演示模式：使用内置示例数据，不访问 GitHub API');
})();
