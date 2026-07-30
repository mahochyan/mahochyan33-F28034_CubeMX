/* Dependency-free deterministic ZIP writer (stored entries, fixed timestamp). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ZipExporter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const encoder = new TextEncoder();
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(value) {
    return Uint8Array.of(value & 0xFF, (value >>> 8) & 0xFF);
  }

  function u32(value) {
    return Uint8Array.of(
      value & 0xFF,
      (value >>> 8) & 0xFF,
      (value >>> 16) & 0xFF,
      (value >>> 24) & 0xFF,
    );
  }

  function concat(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    chunks.forEach(chunk => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  function createProjectZipBytes(files) {
    const locals = [];
    const centrals = [];
    let localOffset = 0;
    const names = Object.keys(files || {}).sort();
    for (const name of names) {
      const nameBytes = encoder.encode(name.replaceAll('\\', '/'));
      const data = encoder.encode(String(files[name]));
      const crc = crc32(data);
      const local = concat([
        u32(0x04034B50),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0x0021),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
        data,
      ]);
      locals.push(local);
      centrals.push(concat([
        u32(0x02014B50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0x0021),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(localOffset),
        nameBytes,
      ]));
      localOffset += local.length;
    }
    const central = concat(centrals);
    const eocd = concat([
      u32(0x06054B50),
      u16(0),
      u16(0),
      u16(names.length),
      u16(names.length),
      u32(central.length),
      u32(localOffset),
      u16(0),
    ]);
    return concat([...locals, central, eocd]);
  }

  function createProjectZip(files) {
    return new Blob([createProjectZipBytes(files)], { type: 'application/zip' });
  }

  function downloadProjectZip(files, filename = 'F28034_ConfigStudio_R3_2.zip') {
    const blob = createProjectZip(files);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return blob;
  }

  return { crc32, createProjectZipBytes, createProjectZip, downloadProjectZip };
});
