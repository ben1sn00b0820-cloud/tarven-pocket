"""Exercise offline installation and in-place GitHub upgrades in disposable hosts."""
from pathlib import Path
import base64, gzip, hashlib, json, os, re, shutil, subprocess, sys, tempfile

installer = Path(sys.argv[1]).resolve()
source = installer.read_text()
payload = re.search(r"const PAYLOAD='([^']+)';", source).group(1)
bundle = json.loads(gzip.decompress(base64.b64decode(payload)))
manifest = json.loads(base64.b64decode(bundle['manifest.json']))
version = manifest['version']
preset_names = [f'TavernPocket_{kind}_v{version}.json' for kind in ('Regex', 'Worldbook')]
checks = []


def snapshot(folder):
    out = {}
    if not folder.exists():
        return out
    for item in sorted(folder.rglob('*')):
        key = item.relative_to(folder).as_posix()
        if item.is_symlink():
            out[key] = ('link', os.readlink(item))
        elif item.is_file():
            out[key] = ('file', hashlib.sha256(item.read_bytes()).hexdigest())
    return out


class Fixture:
    def __init__(self, base, name='tarven-pocket', install=True):
        self.base = base
        self.root = base / 'SillyTavern'
        self.parent = self.root / 'public/scripts/extensions/third-party'
        self.target = self.parent / name
        self.parent.mkdir(parents=True)
        (self.root / 'package.json').write_text('{"name":"sillytavern","version":"1.19.0"}')
        (self.root / 'server.js').write_text('// fixture only')
        (self.root / 'config.yaml').write_text('port: 8000\n')
        self.data = self.root / 'data/default-user/chats'
        self.data.mkdir(parents=True)
        (self.data / 'untouched.jsonl').write_text('chat sentinel')
        self.script = base / 'installer.cjs'
        shutil.copyfile(installer, self.script)
        self.env = os.environ.copy()
        self.env.pop('NODE_OPTIONS', None)
        self.env['HOME'] = str(base / 'home')
        Path(self.env['HOME']).mkdir()
        if install:
            self.target.mkdir()
            (self.target / 'manifest.json').write_text('{"display_name":"傳音玉符","version":"0.0.0","generate_interceptor":"stIphonieInterceptor"}')
            (self.target / 'index.js').write_text('// old source')
            (self.target / 'custom.txt').write_text('custom sentinel')
            (self.target / '.git').mkdir()
            (self.target / '.git/config').write_text('[remote "origin"]\nurl = https://github.com/example/tarven-pocket\n')
            (self.target / '.git/HEAD').write_text('ref: refs/heads/main\n')

    def run(self, script=None):
        return subprocess.run(['node', str(script or self.script), str(self.root)], env=self.env, capture_output=True, text=True)

    def payload_matches(self, folder=None):
        folder = folder or self.target
        for name, encoded in bundle.items():
            assert (folder / name).read_bytes() == base64.b64decode(encoded), name

    def reject_unchanged(self, message):
        before = snapshot(self.root)
        result = self.run()
        assert result.returncode != 0 and message in result.stderr, result.stderr
        assert snapshot(self.root) == before, result.stderr

    def clean_temp(self):
        assert not (self.root / '.tavern-pocket-install.lock').exists()
        assert not list(self.root.glob('.tavern-pocket-stage-*'))


with tempfile.TemporaryDirectory(prefix='pocket-install-test-') as temp:
    base = Path(temp)
    for name in ['tarven-pocket', 'tavern-pocket', 'my-phone']:
        f = Fixture(base / name, name)
        old = snapshot(f.target)
        run = f.run()
        assert run.returncode == 0, run.stderr
        assert f'v{version}' in run.stdout and '正文卡片' not in run.stdout
        f.payload_matches()
        assert (f.target / 'custom.txt').read_text() == 'custom sentinel'
        assert snapshot(f.target / '.git') == {key.removeprefix('.git/'): value for key, value in old.items() if key.startswith('.git/')}
        backups = list((f.root / 'tavern-pocket-backups').glob('previous-*/*'))
        assert len(backups) == 1 and snapshot(backups[0]) == old
        assert len([item for item in f.parent.iterdir() if item.is_dir()]) == 1
        assert (f.data / 'untouched.jsonl').read_text() == 'chat sentinel'
        assert (f.root / 'config.yaml').read_text() == 'port: 8000\n'
        for preset in preset_names:
            assert (f.base / preset).read_bytes() == base64.b64decode(bundle[f'presets/{preset}'])
        f.clean_temp()
        checks.append(f'{name} upgraded in place with full payload, exact backup, Git/custom data and chat preserved')

    f = Fixture(base / 'fresh', install=False)
    result = f.run()
    assert result.returncode == 0, result.stderr
    f.payload_matches(f.parent / 'tavern-pocket')
    checks.append('fresh installation uses one default folder')

    f = Fixture(base / 'unsupported')
    (f.root / 'package.json').write_text('{"name":"sillytavern","version":"1.18.0"}')
    f.reject_unchanged('支援門檻是 1.19.0')
    checks.append('minimum supported version unchanged; older host rejected without changes')

    f = Fixture(base / 'duplicate')
    duplicate = f.parent / 'ST-iPhonie'
    duplicate.mkdir()
    (duplicate / 'manifest.json').write_text('{"display_name":"ST-iPhonie","generate_interceptor":"stIphonieInterceptor"}')
    f.reject_unchanged('另一份 ST-iPhonie')
    checks.append('multiple phone copies rejected without choosing or overwriting one')

    f = Fixture(base / 'personal-only', install=False)
    personal = f.root / 'data/default-user/extensions/tarven-pocket'
    personal.mkdir(parents=True)
    (personal / 'manifest.json').write_text('{"generate_interceptor":"stIphonieInterceptor"}')
    f.reject_unchanged('個人版插件')
    assert not (f.parent / 'tavern-pocket').exists()
    checks.append('personal-only installation reports account scope and creates no global duplicate')

    f = Fixture(base / 'unknown')
    (f.target / 'manifest.json').unlink()
    f.reject_unchanged('無法識別版本')
    checks.append('unidentified folder is never overwritten')

    f = Fixture(base / 'corrupt')
    f.script.write_text(source.replace("const EXPECTED_DIGEST='", "const EXPECTED_DIGEST='bad", 1))
    f.reject_unchanged('校驗失敗')
    checks.append('corrupted payload rejected before any mutation')

    f = Fixture(base / 'rollback')
    before = snapshot(f.target)
    hook = f.base / 'fail-stage-rename.cjs'
    hook.write_text("const fs=require('node:fs'),path=require('node:path'),rename=fs.renameSync;let failed=false;fs.renameSync=function(from,to){if(!failed&&path.basename(from).startsWith('.tavern-pocket-stage-')){failed=true;throw Object.assign(Error('SIMULATED_INSTALL_RENAME_FAILURE'),{code:'EACCES'});}return rename.apply(this,arguments);};")
    f.env['NODE_OPTIONS'] = '--require=' + str(hook)
    result = f.run()
    assert result.returncode != 0 and 'SIMULATED_INSTALL_RENAME_FAILURE' in result.stderr, result.stderr
    assert snapshot(f.target) == before
    assert not (f.parent / 'tavern-pocket').exists()
    f.clean_temp()
    checks.append('failure during atomic replacement restores exact prior folder including Git/custom files')

    f = Fixture(base / 'payload-symlink')
    foreign = f.base / 'external-index.js'
    foreign.write_text('outside sentinel')
    (f.target / 'index.js').unlink()
    (f.target / 'index.js').symlink_to(foreign)
    before = snapshot(f.target)
    result = f.run()
    assert result.returncode != 0 and '符號連結' in result.stderr, result.stderr
    assert snapshot(f.target) == before and foreign.read_text() == 'outside sentinel'
    f.clean_temp()
    checks.append('staging never follows a bundled-path symlink to overwrite external files')

print(json.dumps({'passed':len(checks),'checks':checks,'version':version,'files':len(bundle)}, ensure_ascii=False))
