"""Build the offline CSB-only repair script from current companion source."""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
companion = root / 'companions/csb-character-state'
files = ['index.js', 'manifest.json', 'src/generation.js', 'src/scan.js', 'src/ui.js']
bundle = {name: base64.b64encode((companion / name).read_bytes()).decode() for name in files}
raw = json.dumps(bundle, separators=(',', ':')).encode()
template = (root / 'tools/csb-hotfix-template.cjs').read_text()
assert template.count('__PAYLOAD__') == template.count('__DIGEST__') == 1
script = template.replace('__PAYLOAD__', base64.b64encode(gzip.compress(raw, mtime=0)).decode()).replace('__DIGEST__', hashlib.sha256(raw).hexdigest())
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / 'CSB_Fix_1.2.1.cjs'
out.write_text(script)
print(json.dumps({'file': str(out), 'bytes': out.stat().st_size, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}))
