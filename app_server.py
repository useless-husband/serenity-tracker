#!/usr/bin/env python3
"""Serenity 追蹤 App 的本機伺服器：給 web/ 裡的畫面用。只聽 127.0.0.1。

  python3 app_server.py            # 預設 8795 埠
"""
import json
import re
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import serenity as S
import watch as W

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8795
HERE = Path(__file__).resolve().parent
WEB = HERE / "web"
ASKS = HERE / "live" / "asks.json"
ORIGIN = f"http://127.0.0.1:{PORT}"
# 問 AI 的兩種模式：快速＝Sonnet 5；仔細＝固定用 Opus 5.5、effort 開到 xhigh（使用者 2026-09-29 指定）
ASK_MODELS = {
    "sonnet": ["--model", "sonnet"],
    "opus": ["--model", "claude-opus-5-5", "--effort", "xhigh"],
}
PRICE_START = datetime(2025, 6, 1, tzinfo=timezone.utc)

_lock = threading.Lock()          # 推文快取、股價快取、問答紀錄共用
_tr_lock = threading.Lock()       # 翻譯一次只跑一批，避免同時寫 zh.json
_tweets = {"stamp": None, "list": []}
_prices = {}                      # symbol -> (抓取時間, prices, currency)
_jobs = {}                        # 問 agent 的工作


# ---------- 資料 ----------

def tweets():
    """推文清單（存檔＋即時抓取），檔案有變才重讀。"""
    files = [S.TWEETS, S.LIVE_TWEETS]
    stamp = tuple(f.stat().st_mtime if f.exists() else 0 for f in files)
    with _lock:
        if stamp != _tweets["stamp"]:
            _tweets["list"] = S.load_tweets()
            _tweets["stamp"] = stamp
        return _tweets["list"]


def zh_cache():
    try:
        return json.loads(S.ZH_CACHE.read_text())
    except (FileNotFoundError, ValueError):
        return {}


def tweet_json(t, zh):
    return {
        "id": t["id"],
        "time": t["_dt"].astimezone(S.TPE).strftime("%Y-%m-%d %H:%M"),
        "kind": "回覆" if t.get("isReply") else ("引用" if t.get("isQuote") else "發文"),
        "tickers": t["_tickers"],
        "text": t["text"],
        "zh": zh.get(t["id"]),
        "url": S.link(t),
        "views": (t.get("metrics") or {}).get("views"),
        "locked": bool(t.get("subscriberOnly")),
    }


def mentions(tk):
    """他提過這個代號的推文：$代號，或 3 個字母以上的大寫整字（例如沒加 $ 的 ESMT）。"""
    word = re.compile(rf"(?<![\w$]){re.escape(tk)}(?!\w)") if len(tk) >= 3 else None
    return [t for t in tweets() if tk in t["_tickers"] or (word and word.search(t["text"]))]


def cached_prices(symbol, start=None):
    """Yahoo 股價快取 20 分鐘；一律從 2025-06 抓起，回測時再切。"""
    with _lock:
        hit = _prices.get(symbol)
    if hit and time.time() - hit[0] < 1200:
        return hit[1], hit[2]
    prices, cur = _orig_fetch(symbol, PRICE_START)
    with _lock:
        _prices[symbol] = (time.time(), prices, cur)
    return prices, cur


_orig_fetch = S.fetch_prices
S.fetch_prices = cached_prices   # 讓 serenity.backtest 也吃快取


def status():
    ts = tweets()
    live = [t for t in ts if t.get("source") == "live-watch"]
    gh = [t for t in ts if t.get("source") != "live-watch"]
    return {
        "total": len(ts),
        "latest": ts[-1]["_dt"].astimezone(S.TPE).strftime("%Y-%m-%d %H:%M") if ts else None,
        "latestDays": (datetime.now(timezone.utc) - ts[-1]["_dt"]).days if ts else None,
        "liveCount": len(live),
        "githubLast": gh[-1]["_dt"].astimezone(S.TPE).strftime("%m/%d") if gh else None,
    }


def backtest(tk, start):
    """回傳統計數字＋畫圖用的每日報酬（股票 vs QQQ）＋他提到的日期。"""
    hits = mentions(tk)
    if start == "first" or start == "last":
        if not hits:
            raise ValueError(f"他沒有提過 {tk}")
        t0 = hits[0] if start == "first" else hits[-1]
    else:
        t0 = next((t for t in tweets() if t["id"] == start), None)
        if not t0:
            raise ValueError("找不到那則推文")
    sym = S.yahoo_symbol(tk)
    stats = S.backtest(sym, t0["_dt"])
    bench = S.backtest(S.BENCHMARK, t0["_dt"])
    prices, _ = cached_prices(sym)
    qqq, _ = cached_prices(S.BENCHMARK)
    after = [p for p in prices if p[1] >= t0["_dt"]]
    q_after = [p for p in qqq if p[1] >= t0["_dt"]]
    series, qi = [], 0
    for day, _, close in after:
        while qi + 1 < len(q_after) and q_after[qi + 1][0] <= day:
            qi += 1
        q = q_after[qi][2] / bench["entry"] - 1 if q_after and q_after[0][0] <= day else 0.0
        series.append({"d": day.isoformat(), "s": close / stats["entry"] - 1, "q": q, "c": close})
    # 每則推文對應到「之後第一個收盤日」，畫在圖下方
    marks = {}
    days = [(p[0], p[1]) for p in after]
    for t in hits:
        if t["_dt"] < t0["_dt"]:
            continue
        d = next((d for d, at in days if at >= t["_dt"]), None)
        if d:
            marks[d.isoformat()] = marks.get(d.isoformat(), 0) + 1

    def plain(r):
        return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()}
    return {
        "ticker": tk, "symbol": sym, "currency": stats["currency"],
        "from": tweet_json(t0, zh_cache()), "stats": plain(stats), "bench": plain(bench),
        "series": series, "marks": marks,
    }


def top(days, n):
    ts = tweets()
    rows = []

    def one(item):
        tk, cnt = item
        hits = mentions(tk)
        try:
            a = S.backtest(S.yahoo_symbol(tk), hits[0]["_dt"])
            b = S.backtest(S.yahoo_symbol(tk), hits[-1]["_dt"])
        except Exception as e:
            return {"ticker": tk, "recent": cnt, "error": str(e)}
        return {"ticker": tk, "recent": cnt, "total": len(hits),
                "first": hits[0]["_dt"].astimezone(S.TPE).strftime("%Y-%m-%d"),
                "last": hits[-1]["_dt"].astimezone(S.TPE).strftime("%Y-%m-%d"),
                "firstRet": a["ret"], "firstDD": a["max_dd"], "lastRet": b["ret"]}
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(one, S.top_tickers(ts, n, days)))
    return {"days": days, "until": ts[-1]["_dt"].astimezone(S.TPE).strftime("%m/%d"), "rows": rows}


# ---------- 問 agent ----------

def load_asks():
    try:
        return json.loads(ASKS.read_text())
    except (FileNotFoundError, ValueError):
        return []


def run_ask(job_id, question, model):
    job = _jobs[job_id]
    claude = S.find_claude()
    if not claude:
        job.update(status="error", answer="找不到 claude 指令（Claude Code 沒裝）")
        return
    today = datetime.now(S.TPE).strftime("%Y-%m-%d")
    prompt = f"（今天是 {today}。使用者在「Serenity 追蹤」App 裡問的，請照你的流程回答，用 Markdown。）\n\n{question}"
    try:
        r = subprocess.run(
            [str(claude), "-p", prompt, "--agent", "serenity", *ASK_MODELS[model],
             "--allowedTools", "Bash(python3 serenity.py *)", "Bash(python3 watch.py *)",
             "Read", "Grep", "WebSearch", "WebFetch", "--strict-mcp-config",
             "--no-session-persistence", "--output-format", "text"],
            cwd=HERE, capture_output=True, text=True, timeout=1200, stdin=subprocess.DEVNULL)
        out = r.stdout.strip()
        if r.returncode != 0 or not out:
            job.update(status="error", answer=f"agent 沒有回答（結束碼 {r.returncode}）：{(r.stderr or out)[:500]}")
        else:
            job.update(status="done", answer=out)
    except subprocess.TimeoutExpired:
        job.update(status="error", answer="超過 20 分鐘還沒回答，已停止。")
    job["seconds"] = int(time.time() - job["started"])
    with _lock:
        asks = load_asks()
        asks.insert(0, {k: job[k] for k in ("id", "question", "model", "status", "answer", "seconds", "at")})
        ASKS.parent.mkdir(exist_ok=True)
        ASKS.write_text(json.dumps(asks[:50], ensure_ascii=False, indent=1))


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def trusted(self):
        # 只接受 App 自己的畫面：要帶自訂標頭（別的網頁跨站送不出來），Origin 有帶就要是自己
        origin = self.headers.get("Origin")
        return self.headers.get("X-Serenity") == "1" and (origin in (None, ORIGIN))

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if not u.path.startswith("/api/"):
            return self.static(u.path)
        if not self.trusted() and u.path != "/api/health":
            return self.send(403, {"error": "forbidden"})
        try:
            if u.path == "/api/health":
                return self.send(200, {"ok": True})
            if u.path == "/api/status":
                return self.send(200, status())
            if u.path == "/api/latest":
                ts = tweets()[::-1]
                off, lim = int(q.get("offset", 0)), min(int(q.get("limit", 30)), 100)
                zh = zh_cache()
                return self.send(200, {"tweets": [tweet_json(t, zh) for t in ts[off:off + lim]], "total": len(ts)})
            if u.path == "/api/ticker":
                tk = q.get("t", "").upper().lstrip("$").strip()
                hits = mentions(tk)
                zh = zh_cache()
                recent30 = sum(1 for t in hits if t["_dt"] > tweets()[-1]["_dt"] - timedelta(days=30))
                return self.send(200, {
                    "ticker": tk, "count": len(hits), "recent30": recent30, "symbol": S.yahoo_symbol(tk),
                    "tweets": [tweet_json(t, zh) for t in hits[::-1][:150]]})
            if u.path == "/api/backtest":
                return self.send(200, backtest(q.get("t", "").upper().lstrip("$"), q.get("from", "first")))
            if u.path == "/api/top":
                return self.send(200, top(int(q.get("days", 30)), min(int(q.get("n", 15)), 30)))
            if u.path == "/api/asks":
                running = [{k: j[k] for k in ("id", "question", "model", "status", "at")} | {"seconds": int(time.time() - j["started"])}
                           for j in _jobs.values() if j["status"] == "running"]
                return self.send(200, {"running": running, "history": load_asks()})
            m = re.fullmatch(r"/api/ask/([\w-]+)", u.path)
            if m and m.group(1) in _jobs:
                j = _jobs[m.group(1)]
                return self.send(200, {**{k: j.get(k) for k in ("id", "status", "answer", "question", "model")},
                                       "seconds": int(time.time() - j["started"]) if j["status"] == "running" else j.get("seconds")})
            return self.send(404, {"error": "not found"})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:
            return self.send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_POST(self):
        u = urlparse(self.path)
        if not self.trusted():
            return self.send(403, {"error": "forbidden"})
        try:
            data = self.body()
            if u.path == "/api/refresh":
                new = W.check_new()
                return self.send(200, {"new": len(new), "status": status()})
            if u.path == "/api/translate":
                ids = set(data.get("ids", [])[:40])
                todo = [t for t in tweets() if t["id"] in ids]
                with _tr_lock:
                    zh = S.translate(todo)
                return self.send(200, {i: zh.get(i) for i in ids})
            if u.path == "/api/ask":
                question = (data.get("q") or "").strip()[:2000]
                if not question:
                    return self.send(400, {"error": "問題是空的"})
                model = "opus" if data.get("mode") == "deep" else "sonnet"
                jid = uuid.uuid4().hex[:12]
                _jobs[jid] = {"id": jid, "question": question, "model": model, "status": "running",
                              "answer": None, "started": time.time(),
                              "at": datetime.now(S.TPE).strftime("%Y-%m-%d %H:%M")}
                threading.Thread(target=run_ask, args=(jid, question, model), daemon=True).start()
                return self.send(200, {"id": jid})
            return self.send(404, {"error": "not found"})
        except Exception as e:
            return self.send(500, {"error": f"{type(e).__name__}: {e}"})

    def static(self, path):
        path = "/index.html" if path in ("", "/") else path
        f = (WEB / path.lstrip("/")).resolve()
        if WEB.resolve() not in f.parents or not f.is_file():
            return self.send(404, b"not found", "text/plain")
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png"}.get(f.suffix, "application/octet-stream")
        self.send(200, f.read_bytes(), ctype)


if __name__ == "__main__":
    print(f"Serenity 追蹤：{ORIGIN}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
