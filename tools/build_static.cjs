const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') {
  throw new Error(`Refusing to replace unexpected path: ${dist}`);
}
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
for (const directory of ['assets', 'src']) {
  fs.cpSync(path.join(root, directory), path.join(dist, directory), {
    recursive: true,
  });
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '', 'utf8');

const forbidden = [
  { pattern: /\/api(?:\/|["'`])/i, label: 'backend route' },
  { pattern: /localhost/i, label: 'local host name' },
  { pattern: /127\.0\.0\.1/i, label: 'loopback address' },
  { pattern: /\bFlask\b/i, label: 'Python web framework' },
  { pattern: /\bWerkzeug\b/i, label: 'Python web runtime' },
  { pattern: /\bWaitress\b/i, label: 'Python web runtime' },
];
const productionFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else productionFiles.push(full);
  }
}
walk(dist);
for (const file of productionFiles) {
  if (!/\.(?:html|css|js|json|md|txt)$/i.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const item of forbidden) {
    if (item.pattern.test(text)) {
      throw new Error(`${path.relative(dist, file)} contains forbidden ${item.label}`);
    }
  }
}
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (/(?:src|href)=["']\/(?!\/)/i.test(html)) {
  throw new Error('index.html contains a root-relative asset URL');
}
console.log(`R3.2 static build: ${productionFiles.length} files -> ${dist}`);
