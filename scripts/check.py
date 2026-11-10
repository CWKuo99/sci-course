#!/usr/bin/env python3
"""課程站上線前檢查。用法：python3 scripts/check.py

錯誤（ERROR）要先修好才能 commit；警告（WARN）是需要人判斷的事。只用 Python 標準函式庫；有 node 時會檢查 JS 語法。
"""
import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors, warns = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


# 1. 每個頁面都要有 viewport
for p in sorted(ROOT.glob("*.html")):
    if 'name="viewport"' not in p.read_text(encoding="utf-8"):
        err(f"{p.name} 缺少 viewport meta")

# 2. localStorage 只能經由 learn.js 的 store（pc- 前綴）
for p in sorted(ROOT.rglob("*.js")) + sorted(ROOT.glob("*.html")):
    if ".git" in p.parts:
        continue
    t = p.read_text(encoding="utf-8")
    for k in re.findall(r"""localStorage\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)""", t):
        if k.strip() != "'pc-' + k":
            err(f"{p.relative_to(ROOT)} 直接使用 localStorage（{k.strip()}），請改用 store")

# 3. JS 語法
node = shutil.which("node")
if node:
    for p in sorted((ROOT / "assets").glob("*.js")):
        r = subprocess.run([node, "--check", str(p)], capture_output=True, text=True)
        if r.returncode:
            err(f"{p.relative_to(ROOT)} 語法錯誤：{r.stderr.strip().splitlines()[-1]}")
else:
    warn("找不到 node，略過 JS 語法檢查")

# 4. 課綱索引、重點卡、題庫格式
LEARN = ROOT
if (LEARN / "data" / "curriculum.json").exists():
    try:
        cur = json.loads((LEARN / "data" / "curriculum.json").read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(f"data/curriculum.json 不是合法 JSON：{e}")
        cur = None
    if cur:
        kc_code = {}
        for ax in cur["axes"]:
            for c in ax["codes"]:
                if not re.fullmatch(r"[A-Z][a-z]-IV-\d+", c["code"]):
                    err(f"課綱代碼格式不對：{c['code']}")
                for kc in c["kcs"]:
                    if kc["id"] in kc_code:
                        err(f"知識成分 id 重複：{kc['id']}")
                    kc_code[kc["id"]] = c["code"]
                    if not (LEARN / "content" / f"{kc['id']}.md").exists():
                        warn(f"知識成分 {kc['id']} 還沒有重點卡（content/{kc['id']}.md）")
        for ed in cur["editions"].values():
            for sem in ed["semesters"]:
                for ch in sem["chapters"]:
                    for s in ch["sections"]:
                        for k in s["kcs"]:
                            if k not in kc_code:
                                err(f"{s['id']} 用到不存在的知識成分：{k}")
                        for m in s.get("sims", []):
                            if not m["href"].startswith("https://cwkuo99.github.io/test/"):
                                warn(f"{s['id']} 的模擬連結不在舊站：{m['href']}")
        seen, per_kc = set(), defaultdict(lambda: [0, 0])
        for qf in sorted((LEARN / "data" / "questions").glob("*.json")):
            name = f"data/questions/{qf.name}"
            try:
                qs = json.loads(qf.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                err(f"{name} 不是合法 JSON：{e}")
                continue
            for q in qs:
                qid = q.get("id", "?")
                where = f"{name} {qid}"
                if qid in seen:
                    err(f"{where}：題號重複")
                seen.add(qid)
                if not qid.startswith(qf.stem + "-"):
                    err(f"{where}：題號要以檔名的課綱代碼開頭")
                if kc_code.get(q.get("kc")) != qf.stem:
                    err(f"{where}：知識成分 {q.get('kc')} 不屬於 {qf.stem}")
                if q.get("level") not in ("L0", "L1", "L2", "L3"):
                    err(f"{where}：level 要是 L0～L3")
                if q.get("level") == "L3":
                    warn(f"{where}：L3 遷移題原則上留給精熟站")
                if q.get("rep") not in ("巨觀", "微觀", "符號"):
                    err(f"{where}：rep 要是 巨觀／微觀／符號")
                opts = q.get("options", [])
                if sum(1 for o in opts if o.get("ok")) != 1:
                    err(f"{where}：正確選項要剛好一個")
                if not 3 <= len(opts) <= 5:
                    err(f"{where}：選項數要在 3～5 個")
                for o in opts:
                    if not o.get("ok") and not (o.get("mis") and o.get("why")):
                        err(f"{where}：錯誤選項「{o.get('t', '')[:12]}」缺少 mis 或 why")
                if not q.get("stem") or not q.get("explain"):
                    err(f"{where}：缺少題幹或解析")
                per_kc[q.get("kc")][1 if q.get("predict") else 0] += 1
        for ed in cur["editions"].values():
            for sem in ed["semesters"]:
                for ch in sem["chapters"]:
                    for s in ch["sections"]:
                        checks = sum(per_kc[k][0] for k in s["kcs"])
                        preds = sum(per_kc[k][1] for k in s["kcs"])
                        if checks < 3:
                            msg = f"{s['id']} 檢核題只有 {checks} 題，至少要 3 題（章末檢核每節抽 2 題）"
                            # draft：節的骨架已上線、檢核題還在寫。降為警告，避免卡住其他內容
                            (warn if s.get("draft") else err)(msg + ("（建置中）" if s.get("draft") else ""))
                        if not preds:
                            warn(f"{s['id']} 沒有預測題")
        # 5. 常見難題與招式
        skill_ids = set()
        sk_path = LEARN / "data" / "skills.json"
        if sk_path.exists():
            try:
                for s in json.loads(sk_path.read_text(encoding="utf-8")):
                    if s.get("id") in skill_ids:
                        err(f"招式 id 重複：{s.get('id')}")
                    skill_ids.add(s.get("id"))
                    if not s.get("name") or not s.get("detail"):
                        err(f"招式 {s.get('id')} 缺少 name 或 detail")
                    for k in s.get("kcs", []):
                        if k not in kc_code:
                            err(f"招式 {s.get('id')} 用到不存在的知識成分：{k}")
            except json.JSONDecodeError as e:
                err(f"data/skills.json 不是合法 JSON：{e}")
        pr_path = LEARN / "data" / "problems.json"
        if pr_path.exists():
            engines_js = (LEARN / "assets" / "engines.js").read_text(encoding="utf-8") if (LEARN / "assets" / "engines.js").exists() else ""
            chapter_ids = {ch["id"] for ed in cur["editions"].values() for sem in ed["semesters"] for ch in sem["chapters"]}
            try:
                probs = json.loads(pr_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                err(f"data/problems.json 不是合法 JSON：{e}")
                probs = []
            for pr in probs:
                pid = pr.get("id", "?")
                where = f"data/problems.json {pid}"
                if pid in seen:
                    err(f"{where}：題號和題庫重複")
                seen.add(pid)
                m = re.fullmatch(r"([A-Z][a-z]-IV-\d+)-9\d\d", pid)
                if not m:
                    err(f"{where}：常見難題題號要是 <課綱代碼>-9xx")
                kcs = pr.get("kcs", [])
                if not kcs or any(k not in kc_code for k in kcs):
                    err(f"{where}：kcs 要有、且都要存在於 curriculum.json")
                elif m and kc_code[kcs[0]] != m.group(1):
                    err(f"{where}：第一個 kc 要屬於 {m.group(1)}")
                for s in pr.get("skills", []):
                    if s not in skill_ids:
                        err(f"{where}：招式 {s} 不存在於 data/skills.json")
                if pr.get("chapter") not in chapter_ids:
                    err(f"{where}：chapter {pr.get('chapter')} 不存在")
                if pr.get("license") not in ("自編", "公開考題"):
                    err(f"{where}：license 只能是 自編 或 公開考題（參考書、講義、習作的題目不能進公開 repo）")
                if pr.get("license") == "公開考題" and not pr.get("source"):
                    err(f"{where}：公開考題要寫出處 source")
                if f"'{pr.get('engine')}'" not in engines_js and f" {pr.get('engine')}," not in engines_js:
                    err(f"{where}：assets/engines.js 沒有引擎 {pr.get('engine')}")
                opts = pr.get("options", [])
                if sum(1 for o in opts if o.get("ok")) != 1:
                    err(f"{where}：正確選項要剛好一個")
                if [o.get("k") for o in opts] != ["A", "B", "C", "D", "E"][:len(opts)]:
                    err(f"{where}：選項代號要依序是 A、B、C…（解析步驟會引用代號，不能打亂）")
                for o in opts:
                    if not o.get("why") or (not o.get("ok") and not o.get("mis")):
                        err(f"{where}：選項 {o.get('k')} 缺少 why 或 mis")
                if not pr.get("stem") or not pr.get("explain") or not pr.get("title"):
                    err(f"{where}：缺少 title、stem 或 explain")
    site = LEARN / "data" / "site.json"
    if site.exists():
        url = json.loads(site.read_text(encoding="utf-8")).get("submitUrl", "")
        if url and not re.fullmatch(r"https://script\.google\.com/macros/s/[\w-]+/exec", url):
            err("data/site.json 的 submitUrl 不是 Apps Script 網址")
        if not url:
            warn("data/site.json 尚未設定 submitUrl，作答不會回收")

for m in warns:
    print("WARN ", m)
for m in errors:
    print("ERROR", m)
print(f"\n{len(errors)} 個錯誤，{len(warns)} 個警告")
sys.exit(1 if errors else 0)
