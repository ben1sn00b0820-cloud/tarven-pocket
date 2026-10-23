"""Create a standalone installer containing source, documentation and test evidence."""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'manifest.json').read_text())['version']
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / f'TavernPocket_v{version}_Install.cjs'
if root in out.parents:
    raise SystemExit('Write the installer outside its source folder to avoid recursive bundling.')
bundle = {}
for path in sorted(root.rglob('*')):
    rel = path.relative_to(root)
    if not path.is_file() or path.is_symlink() or any(part.startswith('.') or part in ('node_modules', '__pycache__') for part in rel.parts):
        continue
    if 'artifacts' in rel.parts and path.suffix != '.json':
        continue
    bundle[rel.as_posix()] = base64.b64encode(path.read_bytes()).decode('ascii')
raw = json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
template = (root / 'tools/installer-template.cjs').read_text()
assert template.count('__PAYLOAD__') == 1 and template.count('__DIGEST__') == 1
packed = template.replace('__PAYLOAD__', base64.b64encode(gzip.compress(raw, mtime=0)).decode('ascii')).replace('__DIGEST__', hashlib.sha256(raw).hexdigest())
out.write_text(packed)
print(json.dumps({'path':str(out), 'version':version, 'files':len(bundle), 'bytes':out.stat().st_size, 'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
