# -*- coding: utf-8 -*-
"""把新算出的 APPDATA 注入 prototype/app.html —— **只换数据块,不动 UI/JS 外壳**。

app.html 是前端唯一真源(经过大量手工精修)。每日刷新只替换其中
`<script id="APPDATA">…</script>` 的内容,其它一律保持不变。
"""
from __future__ import annotations
import json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP_HTML = os.path.join(ROOT, "prototype", "app.html")
META = os.path.join(os.path.dirname(__file__), "meta.json")

_APPDATA_RE = re.compile(r'(<script id="APPDATA"[^>]*>)(.*?)(</script>)', re.S)


def assemble(assets: dict, charts: dict) -> dict:
    """assets: {sym: asset_dict};charts: {'dark':{...},'light':{...}}。cats/icons 取静态 meta。"""
    meta = json.load(open(META, encoding="utf-8"))
    return {"assets": assets, "cats": meta["cats"], "icons": meta["icons"],
            "charts": {"dark": charts["dark"], "light": charts["light"]}}


def inject(appdata: dict, path: str = APP_HTML) -> None:
    h = open(path, encoding="utf-8").read()
    m = _APPDATA_RE.search(h)
    if not m:
        raise RuntimeError("APPDATA block not found in app.html")
    # 安全校验:绝不下发原始价
    for sym, a in appdata["assets"].items():
        if a.get("last") is not None:
            raise ValueError(f"{sym}: last price must be null (derived-only site)")
    body = json.dumps(appdata, ensure_ascii=False, separators=(",", ":"))
    h = h[:m.start()] + m.group(1) + body + m.group(3) + h[m.end():]
    open(path, "w", encoding="utf-8").write(h)


def load_meta_names() -> dict:
    return json.load(open(META, encoding="utf-8"))["names"]
