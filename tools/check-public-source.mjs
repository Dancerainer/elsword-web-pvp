/** Check the tracked source of a public checkout without reading local settings or game inputs. */
import {execFileSync} from 'node:child_process';
import {lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const paths = execFileSync('git', ['ls-files', '-z'], {cwd: project, encoding: 'utf8'}).split('\0').filter(Boolean);
const violations = [];
const privateDirectory = /^(?:reports|runtime|asset_work|asset_sources|artifacts|node_modules|dist|\.cache)(?:\/|$)/;
const privateFile = /(?:^|\/)(?:\.env(?:\..+)?|server-config\.json|dev-account\.json|dev-accounts\.json)$|\.(?:pem|pfx|ppk|key)$/i;
const userDirectory = /\b[a-z]:[\\/]+Users[\\/]+[^\\/\s"']+|(?:^|["'\s])\/(?:home|Users)\/[^/\s]+\//im;
const privateKey = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;
const visibleSource = /^(?:apps|packages|config)\/|\.(?:md|txt|html)$/i;
const han = /\p{Script=Han}/u;
const visibleText = text => text.replace(/\\u([0-9a-f]{4})|\\u\{([0-9a-f]{1,6})\}/gi, (literal, short, long) => {
  const code = Number.parseInt(short ?? long, 16);
  return code <= 0x10ffff ? String.fromCodePoint(code) : literal;
});

for (const path of paths) {
  if (privateDirectory.test(path) || (privateFile.test(path) && !path.endsWith('.env.example'))) {
    violations.push(`${path} includes a private input, configuration file or generated output`);
    continue;
  }
  const file = join(project, path);
  const info = await lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info?.isFile()) {
    violations.push(`${path} must be a regular file present in the checkout`);
    continue;
  }
  if (/(?:^|\/)(?:NODE-)?LICENSE(?:\.txt)?$/i.test(path)) continue;
  const text = await readFile(file, 'utf8');
  if (userDirectory.test(text)) violations.push(`${path} contains an absolute home directory`);
  if (privateKey.test(text)) violations.push(`${path} contains a private key`);
  if (visibleSource.test(path) && han.test(visibleText(text))) violations.push(`${path} contains untranslated text`);
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${paths.length} tracked paths for private files, local home directories, keys and English display text.`);
}
