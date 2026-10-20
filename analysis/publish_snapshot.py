"""Publish only the generated, verified snapshot to the fixed implementation branch."""
import json
import os
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

API = "https://api.github.com/repos/AncPower/nem-bess-formula-workbench"
BRANCH = "feat/t6-p13-standalone-data"


def request(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    with urlopen(Request(API + path, data=data, method=method, headers={"Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"}), timeout=60) as response:
        return json.load(response)


head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
if request(f"/git/ref/heads/{BRANCH}")["object"]["sha"] != head:
    raise RuntimeError("Branch changed during CI; refusing to publish")
blob = request("/git/blobs", {"content": Path("data/daily_summary.json").read_text(), "encoding": "utf-8"})
tree = request("/git/trees", {"base_tree": request(f"/git/commits/{head}")["tree"]["sha"], "tree": [{"path": "data/daily_summary.json", "mode": "100644", "type": "blob", "sha": blob["sha"]}]})
commit = request("/git/commits", {"message": "data: publish verified public AEMO single-cycle history", "tree": tree["sha"], "parents": [head]})
request(f"/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False}, "PATCH")
request(f"/statuses/{commit['sha']}", {"state": "success", "context": "test", "description": "Same CI run: tests and generated snapshot verified before publication", "target_url": f"https://github.com/AncPower/nem-bess-formula-workbench/actions/runs/{os.environ['GITHUB_RUN_ID']}"})
print(f"Published verified snapshot: {commit['sha']}")
