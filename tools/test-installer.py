"""Exercise the offline installer against a disposable ST directory only."""
from pathlib import Path
import base64, gzip, json, re, shutil, subprocess, sys, tempfile

installer = Path(sys.argv[1]).resolve()
source = installer.read_text()
payload = re.search(r"const PAYLOAD='([^']+)';", source).group(1)
bundle = json.loads(gzip.decompress(base64.b64decode(payload)))
manifest = json.loads(base64.b64decode(bundle['manifest.json']))
version = manifest['version']
preset_names = [f'TavernPocket_{kind}_v{version}.json' for kind in ('Regex', 'Worldbook')]
with tempfile.TemporaryDirectory(prefix='pocket-install-test-') as temp:
    base = Path(temp)
    test_script = base / 'installer.cjs'
    shutil.copyfile(installer, test_script)
    root = base / 'SillyTavern'
    ext = root / 'public/scripts/extensions/third-party/tavern-pocket'
    ext.mkdir(parents=True)
    (root / 'package.json').write_text('{"name":"sillytavern","version":"1.19.0"}')
    (root / 'server.js').write_text('// fixture only')
    (ext / 'previous.txt').write_text('keep old extension backup')
    data = root / 'data/default-user/chats'
    data.mkdir(parents=True)
    (data / 'untouched.jsonl').write_text('chat sentinel')
    (root / 'config.yaml').write_text('port: 8000\n')
    run = subprocess.run(['node', str(test_script), str(root)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert f'v{version}' in run.stdout
    for name, encoded in bundle.items():
        assert (ext / name).read_bytes() == base64.b64decode(encoded), name
    old = list((root / 'tavern-pocket-backups').glob('previous-*/tavern-pocket/previous.txt'))
    assert len(old) == 1 and old[0].read_text() == 'keep old extension backup'
    assert (data / 'untouched.jsonl').read_text() == 'chat sentinel'
    assert (root / 'config.yaml').read_text() == 'port: 8000\n'
    for name in preset_names:
        assert (base / name).read_bytes() == base64.b64decode(bundle[f'presets/{name}']), name
    assert not (root / '.tavern-pocket-install.lock').exists()
    (root / 'package.json').write_text('{"name":"sillytavern","version":"1.18.0"}')
    run = subprocess.run(['node', str(test_script), str(root)], capture_output=True, text=True)
    assert run.returncode != 0 and len(list((root / 'tavern-pocket-backups').iterdir())) == 1
    (root / 'package.json').write_text('{"name":"sillytavern","version":"1.19.0"}')
    duplicate = root / 'public/scripts/extensions/third-party/ST-iPhonie'
    duplicate.mkdir()
    (duplicate / 'manifest.json').write_text('{"display_name":"ST-iPhonie","generate_interceptor":"stIphonieInterceptor"}')
    run = subprocess.run(['node', str(test_script), str(root)], capture_output=True, text=True)
    assert run.returncode != 0 and '另一份 ST-iPhonie' in run.stderr
    assert len(list((root / 'tavern-pocket-backups').iterdir())) == 1
    broken = base / 'broken.cjs'
    broken.write_text(source.replace("const EXPECTED_DIGEST='", "const EXPECTED_DIGEST='bad", 1))
    run = subprocess.run(['node', str(broken), str(root)], capture_output=True, text=True)
    assert run.returncode != 0 and '校驗失敗' in run.stderr
print(json.dumps({'passed':4,'checks':['upgrade with byte verification, old extension backup and unchanged chat/config','unsupported host refuses before replacing','corrupted payload refuses before replacing','duplicate ST-iPhonie refuses without changes'],'version':version,'files':len(bundle)}))
