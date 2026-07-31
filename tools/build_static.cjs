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

const deviceRoot = path.join(root, 'src', 'devices', 'TMS320F28034');
const deviceBundle = {
  device: 'TMS320F28034',
  deviceInfo: JSON.parse(fs.readFileSync(path.join(deviceRoot, 'device.json'), 'utf8')),
  pinmux: JSON.parse(fs.readFileSync(path.join(deviceRoot, 'pinmux.json'), 'utf8')),
  golden: JSON.parse(fs.readFileSync(path.join(deviceRoot, 'pinmux_golden.json'), 'utf8')),
  family: JSON.parse(fs.readFileSync(path.join(deviceRoot, 'family.json'), 'utf8')),
  constraints: JSON.parse(fs.readFileSync(path.join(deviceRoot, 'constraints.json'), 'utf8')),
  wizards: JSON.parse(fs.readFileSync(path.join(deviceRoot, 'wizard_schema.json'), 'utf8')),
  peripheralInstances: JSON.parse(fs.readFileSync(
    path.join(deviceRoot, 'peripheral_instances.json'), 'utf8')),
  signalGroups: JSON.parse(fs.readFileSync(
    path.join(deviceRoot, 'signal_groups.json'), 'utf8')),
  internalRoutes: JSON.parse(fs.readFileSync(
    path.join(deviceRoot, 'internal_routes.json'), 'utf8')),
  packageData: JSON.parse(fs.readFileSync(
    path.join(deviceRoot, 'packages', 'pnt80.json'), 'utf8')),
};
const bundleRelative = 'src/devices/TMS320F28034/device_bundle.js';
fs.writeFileSync(
  path.join(dist, ...bundleRelative.split('/')),
  `window.__F28034_DEVICE_BUNDLE__=${JSON.stringify(deviceBundle)};\n`,
  'utf8',
);
const distIndex = path.join(dist, 'index.html');
const indexText = fs.readFileSync(distIndex, 'utf8');
fs.writeFileSync(
  distIndex,
  indexText.replace(
    '<script src="./src/core/device_loader.js"></script>',
    `<script src="./${bundleRelative}"></script>\n` +
      '<script src="./src/core/device_loader.js"></script>',
  ),
  'utf8',
);

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
console.log(`R3.3 peripheral graph static build: ${productionFiles.length} files -> ${dist}`);
