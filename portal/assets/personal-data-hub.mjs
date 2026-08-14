const HUB_URL_KEY = "traderhome-personal-data-hub-url-v1";
const HUB_TOKEN_KEY = "traderhome-personal-data-hub-token-v1";
const DEFAULT_HUB_URL = "http://127.0.0.1:8765";


function normalizeHubUrl(value) {
  const url = new URL(String(value || DEFAULT_HUB_URL));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("个人数据中枢必须是本机地址");
  }
  return url.origin;
}

export function consumeHubCredentials() {
  const params = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
  const token = params.get("hub_token");
  if (!token) return false;
  const url = normalizeHubUrl(params.get("hub_url") || DEFAULT_HUB_URL);
  localStorage.setItem(HUB_URL_KEY, url);
  localStorage.setItem(HUB_TOKEN_KEY, token);
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return true;
}

export function personalHubUrl() {
  try {
    return normalizeHubUrl(localStorage.getItem(HUB_URL_KEY) || DEFAULT_HUB_URL);
  } catch {
    localStorage.removeItem(HUB_URL_KEY);
    return DEFAULT_HUB_URL;
  }
}

export function hasPersonalHubToken() {
  return Boolean(localStorage.getItem(HUB_TOKEN_KEY));
}

export function forgetPersonalHub() {
  localStorage.removeItem(HUB_URL_KEY);
  localStorage.removeItem(HUB_TOKEN_KEY);
}

export function connectPersonalHub(returnUrl) {
  const target = returnUrl || `${location.origin}${location.pathname}`;
  location.assign(`${personalHubUrl()}/connect?return=${encodeURIComponent(target)}`);
}

export function openIbkrWebLogin() {
  window.open(`${personalHubUrl()}/api/v1/ibkr/login`, "traderhome-ibkr-login");
}

export async function personalHubFetch(path, { authenticated = true, timeout = 15_000 } = {}) {
  const headers = { Accept: "application/json" };
  if (authenticated) {
    const token = localStorage.getItem(HUB_TOKEN_KEY);
    if (!token) throw new Error("需要先授权本机个人数据中枢");
    headers.Authorization = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(new URL(path, personalHubUrl()), {
      headers,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `个人数据中枢返回 HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("个人数据中枢连接超时");
    if (error instanceof TypeError) throw new Error("本机个人数据中枢未运行或被浏览器拦截");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function personalHubStatus(deep = false) {
  return personalHubFetch(`/health${deep ? "?probe=true" : ""}`, {
    authenticated: false,
    timeout: deep ? 14_000 : 2_800,
  });
}
