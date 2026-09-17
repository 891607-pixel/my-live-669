/**
 * Cloudflare Worker - 臻美视界 (大单页全量 M3U)
 */

const SITE_URL = "https://ommjs4.xxsxlz.top";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const API_KEY_BYTES = new TextEncoder().encode("a9yX32LpQvUt7wBc");
const API_IV_BYTES  = new TextEncoder().encode("N7cPk2Bv38hWqFzM");

const CLASS_LIST = [
  { id: "2383", name: "乱伦毁三观" },
  { id: "2411", name: "中文字幕" },
  { id: "2412", name: "SM调教" },
  { id: "2421", name: "丝袜制服" },
  { id: "2432", name: "国内换脸" },
  { id: "2433", name: "自拍偷拍" },
  { id: "2434", name: "传媒剧情" },
  { id: "2435", name: "抖阴短片" },
  { id: "2436", name: "网爆吃瓜" },
  { id: "2437", name: "偷拍偷窥" },
  { id: "2438", name: "探花约炮" },
  { id: "2439", name: "主播诱惑" },
  { id: "2440", name: "国产自拍" },
  { id: "2441", name: "女优明星" },
  { id: "2443", name: "日韩无码" },
  { id: "2444", name: "日韩精品" }
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/live.m3u" || path === "/") {
      return await handleM3uRequest(url);
    }

    if (path === "/play") {
      const vid = url.searchParams.get("id");
      if (!vid) return new Response("Missing id param", { status: 400 });
      return await handlePlayRequest(vid);
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function handleM3uRequest(reqUrl) {
  const domain = reqUrl.origin;
  const targetTid = reqUrl.searchParams.get("tid"); 
  
  // ps 改为 100（每页100条），depth 默认抓 2 页，即单分组 200 条；若单分组请求，直接抓 10 页（1000条）
  const pageSize = parseInt(reqUrl.searchParams.get("ps") || "100");
  const depth = targetTid ? parseInt(reqUrl.searchParams.get("depth") || "10") : parseInt(reqUrl.searchParams.get("depth") || "2");

  let m3uContent = "#EXTM3U x-tvg-url=\"\"\n";
  let fetchTasks = [];

  if (targetTid) {
    const cls = CLASS_LIST.find(c => c.id === targetTid || c.name === targetTid);
    if (cls) {
      for (let p = 1; p <= depth; p++) {
        fetchTasks.push(fetchCategoryPage(cls.id, p, pageSize, cls.name));
      }
    }
  } else {
    // 16个分组，每个分组抓取 depth 页，每页 pageSize 条
    for (const cls of CLASS_LIST) {
      for (let p = 1; p <= depth; p++) {
        fetchTasks.push(fetchCategoryPage(cls.id, p, pageSize, cls.name));
      }
    }
  }

  // 限制在 Cloudflare 50 次子请求上限以内 (16 * 2 = 32 次请求)
  const results = await Promise.all(fetchTasks.slice(0, 48));

  for (const vodList of results) {
    for (const item of vodList) {
      const playUrl = `${domain}/play?id=${encodeURIComponent(item.id)}`;
      m3uContent += `#EXTINF:-1 group-title="${item.group}" tvg-logo="${item.pic}",${item.name}\n`;
      m3uContent += `${playUrl}\n`;
    }
  }

  return new Response(m3uContent, {
    headers: {
      "Content-Type": "application/x-mpegurl; charset=utf-8",
      "Cache-Control": "public, max-age=1800"
    }
  });
}

async function fetchCategoryPage(tid, page, ps, groupName) {
  const apiPath = `/videos?category_id=${tid}&page=${page}&ps=${ps}`;
  const data = await apiGet(apiPath);
  if (!data || !data.data || !Array.isArray(data.data.list)) return [];

  return data.data.list.map(v => ({
    id: v.id,
    name: unescapeHtml(v.title || "未命名"),
    pic: v.cover_url || "",
    group: groupName
  }));
}

async function handlePlayRequest(vid) {
  const apiPath = `/movie?id=${vid}`;
  const data = await apiGet(apiPath);

  if (data && data.data && data.data.info && data.data.info.play_url) {
    const realUrl = data.data.info.play_url.trim();
    if (realUrl.startsWith("http")) {
      return Response.redirect(realUrl, 302);
    }
  }

  return new Response("Failed to parse play url", { status: 502 });
}

async function apiGet(path) {
  const targetUrl = `${SITE_URL}/api${path}`;
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": UA,
        "Referer": `${SITE_URL}/`,
        "Accept": "application/json,text/html,*/*"
      }
    });

    if (!res.ok) return null;
    const text = await res.text();
    const json = JSON.parse(text);

    if (json && json.cipher) {
      const cipherBuffer = base64ToBuffer(json.cipher);
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: API_IV_BYTES },
        await crypto.subtle.importKey("raw", API_KEY_BYTES, "AES-CBC", false, ["decrypt"]),
        cipherBuffer
      );
      const decStr = new TextDecoder().decode(decryptedBuffer);
      return JSON.parse(decStr);
    }
    return json;
  } catch (e) {
    return null;
  }
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

function unescapeHtml(str) {
  if (!str) return "";
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
