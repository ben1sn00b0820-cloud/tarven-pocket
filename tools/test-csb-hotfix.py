"""Offline filesystem tests; run with generated installer path as argv[1]."""
from pathlib import Path
import base64
import gzip
import json
import os
import re
import subprocess
import sys
import tempfile

installer = Path(sys.argv[1]).resolve()
source = installer.read_text()
bundle = json.loads(gzip.decompress(base64.b64decode(re.search(r"const PAYLOAD='([^']+)';", source).group(1))))
payload = {name: base64.b64decode(value) for name, value in bundle.items()}
checks = []


def host(base):
    root = base / 'SillyTavern'
    (root / 'public/scripts/extensions/third-party').mkdir(parents=True)
    (root / 'package.json').write_text('{"name":"sillytavern","version":"1.19.0"}')
    (root / 'server.js').write_text('// host')
    (root / 'config.yaml').write_text('port: 8000\n')
    return root


def csb(folder, version='1.2.0'):
    (folder / 'src').mkdir(parents=True)
    (folder / 'manifest.json').write_text(json.dumps({'version': version, 'generate_interceptor': 'csbCharacterStateIntercept'}))
    for name in ['index.js', 'src/scan.js', 'src/controller.js', 'src/schema.js', 'src/ui.js', 'src/bridge.js']:
        (folder / name).write_text('// old ' + name)
    return folder


def phone(folder, version='1.2.0'):
    folder.mkdir(parents=True)
    (folder / 'manifest.json').write_text('{"version":"0.12.0","generate_interceptor":"stIphonieInterceptor"}')
    (folder / '.git').mkdir()
    (folder / '.git/HEAD').write_text('ref: refs/heads/main\n')
    return csb(folder / 'companions/csb-character-state', version)


def snapshot(folder):
    return {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob('*') if p.is_file() and 'csb-hotfix-backups' not in p.parts}


def run(root, *, explicit=True, preload=None, env_more=None):
    env = os.environ.copy()
    for key in ('SERVER_DIR', 'TAVERN_SERVER_DIR', 'APP_DATA_ROOT', 'TAVERN_DATA_ROOT'):
        env.pop(key, None)
    env.update(env_more or {})
    command = ['node'] + (['-r', str(preload)] if preload else []) + [str(installer)] + ([str(root)] if explicit else [])
    return subprocess.run(command, cwd=root, env=env, text=True, capture_output=True)


def check_payload(target):
    for name, expected in payload.items():
        assert (target / name).read_bytes() == expected, name


with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary)
    root = host(base / 'dual')
    parent = root / 'public/scripts/extensions/third-party'
    bundled = phone(parent / 'renamed-phone')
    standalone = csb(parent / 'renamed-character-state')
    user = csb(root / 'data/person-one/extensions/csb-user')
    chat = root / 'data/person-one/chats/story.jsonl'
    chat.parent.mkdir(parents=True)
    chat.write_text('chat sentinel')
    before = snapshot(root)
    result = run(root, explicit=False)
    assert result.returncode == 0, result.stderr
    for target in [bundled, standalone, user]:
        check_payload(target)
    changed = {str((target / name).relative_to(root)) for target in [bundled, standalone, user] for name in payload}
    after = snapshot(root)
    for name, content in before.items():
        if name not in changed:
            assert after[name] == content, name
    backups = list((root / 'csb-hotfix-backups').iterdir())
    assert len(backups) == 1
    records = json.loads((backups[0] / 'restore-map.json').read_text())
    assert len(records) == 15
    assert sum(not item['existed'] for item in records) == 3
    for item in records:
        if item['existed']:
            assert (backups[0] / item['backup']).read_bytes() == before[str(Path(item['target']).relative_to(root))]
    assert '主插件版本號保持原值' in result.stdout
    checks.append('bundled, standalone, custom names and per-user installs patched together; exact backups and unrelated files preserved')
    again = run(root)
    assert again.returncode == 0, again.stderr
    checks.append('1.2.1 reinstall is accepted without creating duplicate plugins')

    root = host(base / 'missing')
    before = snapshot(root)
    result = run(root)
    assert result.returncode != 0 and '沒有找到' in result.stderr
    assert before == snapshot(root)
    assert not (root / 'csb-hotfix-backups').exists()
    checks.append('no installed CSB refuses without writing')

    root = host(base / 'newer')
    parent = root / 'public/scripts/extensions/third-party'
    phone(parent / 'tarven-pocket')
    csb(parent / 'newer-csb', '1.3.0')
    before = snapshot(root)
    result = run(root)
    assert result.returncode != 0 and '1.3.0' in result.stderr
    assert before == snapshot(root)
    checks.append('newer CSB anywhere aborts before patching other candidates')

    root = host(base / 'rollback')
    parent = root / 'public/scripts/extensions/third-party'
    phone(parent / 'tavern-pocket')
    csb(parent / 'csb')
    before = snapshot(root)
    fault = base / 'fail-once.cjs'
    fault.write_text("const fs=require('node:fs');const original=fs.renameSync;let n=0;fs.renameSync=function(a,b){if(String(a).includes('.csb-fix-')&&++n===7)throw Error('injected write failure');return original.apply(this,arguments);};")
    result = run(root, preload=fault)
    assert result.returncode != 0 and '原檔已還原' in result.stderr, result.stderr
    assert before == snapshot(root)
    assert not list(root.rglob('*.csb-fix-*'))
    assert not (root / '.csb-hotfix.lock').exists()
    checks.append('mid-update failure restores all installations and absent files and removes temporary files/lock')

    app = base / 'droid/android-tavern'
    root = app / 'bootstrap/server'
    (root / 'public/scripts/extensions').mkdir(parents=True)
    (root / 'package.json').write_text('{"name":"sillytavern","version":"1.19.0"}')
    (root / 'server.js').write_text('// host')
    persistent = app / 'data/server'
    parent = persistent / 'extensions'
    target = phone(parent / 'tarven-pocket')
    (root / 'public/scripts/extensions/third-party').symlink_to(parent, target_is_directory=True)
    result = run(root, explicit=False, env_more={'SERVER_DIR': str(root), 'APP_DATA_ROOT': str(persistent)})
    assert result.returncode == 0, result.stderr
    check_payload(target)
    assert (root / 'public/scripts/extensions/third-party').is_symlink()
    assert (persistent / 'csb-hotfix-backups').exists()
    checks.append('SillyDroid managed link patched in persistent storage and left intact')

    root = host(base / 'symlink')
    parent = root / 'public/scripts/extensions/third-party'
    target = csb(parent / 'csb')
    outside = base / 'outside.js'
    outside.write_text('// untouched outside')
    (target / 'src/scan.js').unlink()
    (target / 'src/scan.js').symlink_to(outside)
    before = snapshot(root)
    result = run(root)
    assert result.returncode != 0 and '符號連結' in result.stderr
    assert before == snapshot(root)
    assert outside.read_text() == '// untouched outside'
    checks.append('selected file symlink refuses without changing its external target')

print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False, indent=2))
