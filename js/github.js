// GitHub REST API 客户端：只用公开端点，Token 可选
const API = 'https://api.github.com';

export class GhError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { headers });
  if (res.status === 404) throw new GhError('用户不存在，检查一下用户名？', 404);
  if (res.status === 403 || res.status === 429) {
    throw new GhError('GitHub API 触发限流（未登录每小时 60 次）。稍等几分钟再试，或填入 Personal Access Token（额度 5000 次/时）。', 403);
  }
  if (!res.ok) throw new GhError('GitHub API 出错了（HTTP ' + res.status + '）', res.status);
  return res.json();
}

export async function fetchProfile(login, token) {
  return api(`/users/${encodeURIComponent(login)}`, token);
}

// 按星数 + 近期活跃度挑最可能"有故事"的仓库
export async function fetchTopRepos(login, token, max) {
  let repos = [];
  for (let page = 1; page <= 2; page++) {
    const r = await api(`/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed&page=${page}`, token);
    repos = repos.concat(r);
    if (r.length < 100) break;
  }
  const now = Date.now();
  return repos
    .filter((r) => !r.fork && !r.archived)
    .map((r) => {
      const weeksIdle = r.pushed_at ? (now - new Date(r.pushed_at)) / 604800000 : 9999;
      return { ...r, _score: r.stargazers_count * 3 + Math.max(0, 60 - weeksIdle) };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, max);
}

// 拉取某仓库中该作者的提交；author 参数由 GitHub 按邮箱关联识别
export async function fetchCommits(owner, repo, login, token, maxPages, onProgress) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    let list;
    try {
      list = await api(`/repos/${owner}/${repo}/commits?per_page=100&page=${page}&author=${encodeURIComponent(login)}`, token);
    } catch (e) {
      if (e.status === 409) return out; // 空仓库
      throw e;
    }
    if (!Array.isArray(list)) return out;
    for (const c of list) {
      const date = (c.commit.author && c.commit.author.date) || (c.commit.committer && c.commit.committer.date);
      if (!date) continue;
      const msg = c.commit.message || '';
      if (/^Merge (pull request|branch|remote)/i.test(msg)) continue; // 合并提交不算亲手写的星
      out.push({ sha: c.sha, date: new Date(date), msg: msg.split('\n')[0], repo });
    }
    if (onProgress) onProgress(out.length);
    if (list.length < 100) break;
  }
  return out;
}
