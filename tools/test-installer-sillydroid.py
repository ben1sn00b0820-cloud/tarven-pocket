"""Exercise the offline installer against disposable SillyDroid layouts.

This tests local filesystem fixtures, not a running Android device. Usage:
    python3 tools/test-installer-sillydroid.py /absolute/path/to/installer.cjs
"""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile


installer = Path(sys.argv[1]).resolve()
source = installer.read_text()
payload = re.search(r"const PAYLOAD='([^']+)';", source).group(1)
bundle = json.loads(gzip.decompress(base64.b64decode(payload)))
checks = []


def snapshot(base):
    """Capture bytes and symlink destinations without traversing symlinks."""
    result = {}

    def visit(folder):
        for entry in sorted(os.scandir(folder), key=lambda item: item.name):
            relative = str(Path(entry.path).relative_to(base))
            if entry.is_symlink():
                result[relative] = ('link', os.readlink(entry.path))
            elif entry.is_dir(follow_symlinks=False):
                result[relative] = ('directory',)
                visit(entry.path)
            else:
                result[relative] = ('file', hashlib.sha256(Path(entry.path).read_bytes()).hexdigest())

    visit(base)
    return result


class Fixture:
    def __init__(self, base):
        self.base = base
        self.root = base / 'android-tavern/bootstrap/server'
        self.persistent = base / 'android-tavern/data/server'
        self.parent = self.persistent / 'extensions'
        self.target = self.parent / 'tavern-pocket'
        self.third_party = self.root / 'public/scripts/extensions/third-party'
        self.home = self.persistent / '.sillydroid-terminal-home'
        self.target.mkdir(parents=True)
        self.third_party.parent.mkdir(parents=True)
        self.third_party.symlink_to(self.parent, target_is_directory=True)
        self.home.mkdir()
        (self.root / 'package.json').write_text('{"name":"sillytavern","version":"1.19.0"}')
        (self.root / 'server.js').write_text('// disposable fixture only\n')
        # SillyDroid passes --dataRoot independently of this config setting.
        self.config = self.root / 'config.yaml'
        self.config.write_text('port: 8000\ndataRoot: ./decoy-data\n')
        (self.target / 'previous.txt').write_text('keep old extension backup\n')
        self.chat = self.persistent / 'data/default-user/chats/untouched.jsonl'
        self.chat.parent.mkdir(parents=True)
        self.chat.write_text('chat sentinel\n')
        self.unrelated = self.parent / 'unrelated-extension'
        self.unrelated.mkdir()
        (self.unrelated / 'manifest.json').write_text('{"display_name":"Unrelated extension"}')
        (self.unrelated / 'index.js').write_text('// do not edit\n')
        self.script = base / 'installer.cjs'
        shutil.copyfile(installer, self.script)
        self.env = os.environ.copy()
        for key in ('SERVER_DIR', 'APP_DATA_ROOT', 'TAVERN_SERVER_DIR', 'TAVERN_DATA_ROOT'):
            self.env.pop(key, None)
        self.env.update(HOME=str(self.home), SERVER_DIR=str(self.root), APP_DATA_ROOT=str(self.persistent))

    def run(self, cwd=None):
        # The user is already at SillyDroid's "sillyTavern >" prompt.
        return subprocess.run(['node', str(self.script)], cwd=cwd or self.root,
                              env=self.env, capture_output=True, text=True)

    def verify_payload(self, folder=None):
        folder = folder or self.target
        for name, encoded in bundle.items():
            assert (folder / name).read_bytes() == base64.b64decode(encoded), name
        actual = {str(item.relative_to(folder)) for item in folder.rglob('*') if item.is_file()}
        assert actual == set(bundle), actual.symmetric_difference(bundle)

    def verify_stable(self, stable):
        assert self.third_party.is_symlink()
        assert os.readlink(self.third_party) == str(self.parent)
        assert self.config.read_bytes() == stable['config']
        assert self.chat.read_bytes() == stable['chat']
        assert snapshot(self.unrelated) == stable['unrelated']
        for folder in (self.root, self.persistent):
            assert not (folder / '.tavern-pocket-install.lock').exists()
            assert not list(folder.glob('.tavern-pocket-stage-*'))
        assert not (self.root / 'tavern-pocket-backups').exists()

    def reject_unchanged(self, contains=None):
        before = snapshot(self.base)
        run = self.run()
        assert run.returncode != 0, run.stdout
        if contains:
            assert contains in run.stderr, run.stderr
        assert snapshot(self.base) == before, run.stderr


with tempfile.TemporaryDirectory(prefix='pocket-sillydroid-test-') as temp:
    base = Path(temp)

    fixture = Fixture(base / 'upgrade')
    fixture.env.update(TAVERN_SERVER_DIR=str(fixture.root), TAVERN_DATA_ROOT=str(fixture.persistent))
    stable = {'config': fixture.config.read_bytes(), 'chat': fixture.chat.read_bytes(),
              'unrelated': snapshot(fixture.unrelated)}
    run = fixture.run()
    assert run.returncode == 0, run.stderr
    assert 'v0.9.0' in run.stdout
    fixture.verify_payload()
    fixture.verify_stable(stable)
    backups = fixture.persistent / 'tavern-pocket-backups'
    previous = list(backups.glob('previous-*/tavern-pocket/previous.txt'))
    assert len(previous) == 1 and previous[0].read_text() == 'keep old extension backup\n'
    assert (fixture.base / 'TavernPocket_Regex_v0.9.0.json').exists()
    assert (fixture.base / 'TavernPocket_Worldbook_v0.9.0.json').exists()
    checks.append('cwd install preserves host symlink, chat, config and unrelated extension; all bundle bytes verified')

    run = fixture.run()
    assert run.returncode == 0, run.stderr
    fixture.verify_payload()
    fixture.verify_stable(stable)
    all_backups = list(backups.glob('previous-*/tavern-pocket'))
    assert len(all_backups) == 2
    prior_payload = [folder for folder in all_backups if not (folder / 'previous.txt').exists()]
    assert len(prior_payload) == 1
    fixture.verify_payload(prior_payload[0])
    checks.append('repeat install backs up complete previous version under persistent data root')

    fixture = Fixture(base / 'env-root-detection')
    run = fixture.run(cwd=fixture.home)
    assert run.returncode == 0, run.stderr
    fixture.verify_payload()
    assert fixture.third_party.is_symlink()
    assert os.readlink(fixture.third_party) == str(fixture.parent)
    checks.append('SERVER_DIR locates host when cwd is the private terminal home')

    fixture = Fixture(base / 'persistent-lock')
    (fixture.persistent / '.tavern-pocket-install.lock').write_text('external installation\n')
    fixture.reject_unchanged('安裝鎖')
    checks.append('persistent installation lock prevents writes')

    fixture = Fixture(base / 'personal-iphonie')
    duplicate = fixture.persistent / 'data/default-user/extensions/ST-iPhonie'
    duplicate.mkdir(parents=True)
    (duplicate / 'manifest.json').write_text('{"display_name":"ST-iPhonie","generate_interceptor":"stIphonieInterceptor"}')
    fixture.reject_unchanged('另一份 ST-iPhonie')
    checks.append('personal ST-iPhonie is detected in runtime data root despite different config dataRoot')

    fixture = Fixture(base / 'symlinked-personal-iphonie')
    linked_user = fixture.base / 'linked-user-data'
    duplicate = linked_user / 'extensions/ST-iPhonie'
    duplicate.mkdir(parents=True)
    (duplicate / 'manifest.json').write_text('{"display_name":"ST-iPhonie","generate_interceptor":"stIphonieInterceptor"}')
    (fixture.persistent / 'data/linked-user').symlink_to(linked_user, target_is_directory=True)
    fixture.reject_unchanged('另一份 ST-iPhonie')
    checks.append('personal ST-iPhonie in a symlinked user directory refuses without changes')

    fixture = Fixture(base / 'personal-pocket')
    duplicate = fixture.persistent / 'data/default-user/extensions/tavern-pocket'
    duplicate.mkdir(parents=True)
    (duplicate / 'manifest.json').write_text('{"display_name":"Tavern Pocket"}')
    fixture.reject_unchanged('個人版插件')
    checks.append('personal Tavern Pocket prevents duplicate global installation')

    fixture = Fixture(base / 'wrong-host-link')
    foreign = fixture.base / 'foreign-extensions'
    foreign.mkdir()
    (foreign / 'sentinel.txt').write_text('must not change\n')
    fixture.third_party.unlink()
    fixture.third_party.symlink_to(foreign, target_is_directory=True)
    fixture.reject_unchanged()
    checks.append('unexpected third-party symlink destination refuses without changes')

    fixture = Fixture(base / 'plugin-symlink')
    foreign = fixture.base / 'foreign-pocket'
    fixture.target.rename(foreign)
    fixture.target.symlink_to(foreign, target_is_directory=True)
    fixture.reject_unchanged()
    checks.append('plugin folder symlink refuses without changing its target')

    fixture = Fixture(base / 'wrong-app-data-env')
    foreign = fixture.base / 'foreign-data'
    foreign.mkdir()
    fixture.env['APP_DATA_ROOT'] = str(foreign)
    fixture.reject_unchanged()
    checks.append('mismatched APP_DATA_ROOT refuses without changes')

    fixture = Fixture(base / 'wrong-tavern-data-env')
    foreign = fixture.base / 'foreign-tavern-data'
    foreign.mkdir()
    fixture.env.update(TAVERN_SERVER_DIR=str(fixture.root), TAVERN_DATA_ROOT=str(foreign))
    fixture.reject_unchanged()
    checks.append('mismatched optional TAVERN_DATA_ROOT refuses without changes')

print(json.dumps({'passed': len(checks), 'checks': checks, 'files': len(bundle)}))
