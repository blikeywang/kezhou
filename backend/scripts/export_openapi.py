"""导出 OpenAPI 契约到 openapi.json(供前端生成客户端 / 文档)。"""
import json
from pathlib import Path
from app.main import app

out = Path(__file__).resolve().parents[1] / "openapi.json"
out.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2))
print("wrote", out, f"({len(app.openapi()['paths'])} paths)")
