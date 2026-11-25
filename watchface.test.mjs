import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyBlackTransparency,
  base64ToBytes,
  clockFaceEditImageIndexes,
  createProjectFile,
  getWatchfaceHandTransform,
  getWatchfaceItemBounds,
  getWatchfaceItemImageIndex,
  getWatchfaceItemText,
  importClockFaceEditProject,
  parseWatchface,
  rgbaToPackedPixels,
  writeWatchface,
} from '../src/watchface.mjs';

function makeBin() {
  const itemOffset = 50;
  const data = new Uint8Array(itemOffset + 8);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x12345678, true);
  view.setUint32(4, data.length - 24, true);
  view.setUint16(12, 240, true);
  view.setUint16(14, 280, true);
  view.setUint16(24, 17, true);
  view.setUint16(26, 2, true);
  view.setUint32(28, itemOffset, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 12, true);
  view.setUint16(36, 24, true);
  data[40] = 1;
  data.set([0, 0], 48);
  data.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], itemOffset);

  let crc = 0xffffffff;
  for (const value of data.subarray(24)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(8, (~crc) >>> 0, true);
  return data;
}

function makeCompressedBin() {
  const itemOffset = 50;
  const data = new Uint8Array(itemOffset + 12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x12345678, true);
  view.setUint32(4, data.length - 24, true);
  view.setUint16(12, 240, true);
  view.setUint16(14, 280, true);
  view.setUint32(16, 0x02ff0100, true);
  view.setUint16(24, 4, true);
  view.setUint16(26, 2, true);
  view.setUint32(28, itemOffset, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 10, true);
  view.setUint16(36, 20, true);
  data[40] = 1;
  data.set([0, 0], 48);
  view.setUint32(itemOffset, 8, true);
  view.setUint32(itemOffset + 4, 4, true);
  data.set([1, 2, 0xff, 0xff], itemOffset + 8);
  let crc = 0xffffffff;
  for (const value of data.subarray(24)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(8, (~crc) >>> 0, true);
  return data;
}

function makeLz4LiteralBin() {
  const items = [
    {
      id: 4,
      width: 2,
      height: 1,
      x: 10,
      y: 20,
      copyImage: 1,
      frames: [
        { format: 0x301, pixels: [0xff, 0xff, 0xff, 0x00, 0x00, 0x00] },
        { format: 0x301, pixels: [0x00, 0xf8, 0x80, 0xc0, 0x07, 0xff] },
      ],
    },
    {
      id: 17,
      width: 1,
      height: 1,
      x: 0,
      y: 0,
      copyImage: 0,
      frames: [{ format: 0x200, pixels: [0x00, 0xf8] }],
    },
  ];
  const tableEnd = 24 + items.length * 24 + 2;
  const blocks = items.map((item) => item.frames.map((frame) => {
    const literalLength = frame.pixels.length;
    const extensionLength = Math.max(0, literalLength - 15);
    const extensionBytes = literalLength < 15 ? 0 : Math.floor(extensionLength / 255) + 1;
    const compressed = new Uint8Array(1 + extensionBytes + literalLength);
    compressed[0] = Math.min(literalLength, 15) << 4;
    let cursor = 1;
    if (literalLength >= 15) {
      let remaining = extensionLength;
      while (remaining >= 255) {
        compressed[cursor] = 255;
        cursor += 1;
        remaining -= 255;
      }
      compressed[cursor] = remaining;
      cursor += 1;
    }
    compressed.set(frame.pixels, cursor);
    const block = new Uint8Array(20 + compressed.length);
    const view = new DataView(block.buffer);
    view.setUint16(4, item.width, true);
    view.setUint16(6, item.height, true);
    view.setUint32(8, frame.format, true);
    view.setUint32(12, compressed.length, true);
    view.setUint32(16, 0xcccc0102, true);
    block.set(compressed, 20);
    return block;
  }));
  const totalSize = blocks.flat().reduce((total, block) => total + block.length, tableEnd);
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x4e49422e, true);
  view.setUint16(12, 240, true);
  view.setUint16(14, 280, true);
  view.setUint32(16, 0x03ff0101, true);
  view.setUint32(20, 0xffffff0e, true);
  let dataOffset = tableEnd;

  items.forEach((item, index) => {
    const tableOffset = 24 + index * 24;
    view.setUint16(tableOffset, item.id, true);
    view.setUint16(tableOffset + 2, item.width, true);
    view.setUint32(tableOffset + 4, dataOffset, true);
    view.setUint16(tableOffset + 8, item.height, true);
    view.setUint16(tableOffset + 10, item.x, true);
    view.setUint16(tableOffset + 12, item.y, true);
    data[tableOffset + 16] = item.frames.length;
    data[tableOffset + 17] = item.copyImage;

    item.frames.forEach((frame, frameIndex) => {
      const block = blocks[index][frameIndex];
      view.setUint32(dataOffset, dataOffset, true);
      data.set(block.subarray(4), dataOffset + 4);
      dataOffset += block.length;
    });
  });
  updateChecksum(data);
  return data;
}

function updateChecksum(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint32(4, data.length - 24, true);
  let crc = 0xffffffff;
  for (const value of data.subarray(24)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(8, (~crc) >>> 0, true);
}

test('applies black-key transparency on initial preview without mutating source pixels', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    1, 1, 7, 255,
    0, 4, 0, 255,
    0, 0, 0, 0,
    32, 64, 96, 255,
  ]);
  const transparent = applyBlackTransparency(pixels, false);
  assert.deepEqual([...transparent], [
    0, 0, 0, 0,
    1, 1, 7, 0,
    0, 4, 0, 0,
    0, 0, 0, 0,
    32, 64, 96, 255,
  ]);
  assert.equal(pixels[3], 255);
  const opaque = applyBlackTransparency(pixels, true);
  assert.deepEqual([...opaque].filter((_, index) => index % 4 === 3), [255, 255, 255, 255, 255]);
  assert.notEqual(opaque, pixels);
  assert.equal(pixels[15], 0);
});

test('parses BIN item metadata and bitmap pixels', () => {
  const parsed = parseWatchface(makeBin());
  assert.equal(parsed.width, 240);
  assert.equal(parsed.height, 280);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].name, 'Background');
  assert.equal(parsed.items[0].x, 12);
  assert.equal(parsed.items[0].images[0].length, 16);
  assert.equal(parsed.checksumValid, true);
});

test('decodes compressed C++ watch-face sprite rows', () => {
  const parsed = parseWatchface(makeCompressedBin());
  assert.equal(parsed.compressed, true);
  assert.equal(parsed.items[0].images[0].length, 8);
  assert.deepEqual([...parsed.items[0].packedPixels], [0xffff, 0xffff]);
  assert.equal(parsed.checksumValid, true);
});

test('decodes and edits v3 LZ4 frames with RGB555 and per-pixel alpha', () => {
  const original = makeLz4LiteralBin();
  const parsed = parseWatchface(original);
  assert.equal(parsed.compressed, true);
  assert.equal(parsed.compressionFormat, 'lz4');
  assert.deepEqual(parsed.compressionFlags, [0x03ff0101, 0xffffff0e]);
  assert.equal(parsed.checksumValid, true);

  const digits = parsed.items.find((item) => item.id === 4);
  assert.deepEqual(digits.frameFormats, [0x301, 0x301]);
  assert.deepEqual([...digits.packedPixels], [0xffff, 0, 0xf800, 0x07c0]);
  assert.deepEqual([...digits.images[0]], [248, 248, 248, 255, 0, 0, 0, 0]);
  assert.deepEqual([...digits.images[1]], [248, 0, 0, 128, 0, 248, 0, 255]);

  const moved = writeWatchface(parsed, parsed.items.map((item) => (
    item.id === 4 ? { ...item, x: item.x + 1 } : item
  )));
  const movedParsed = parseWatchface(moved);
  assert.equal(movedParsed.compressionFormat, 'lz4');
  assert.deepEqual(moved.subarray(digits.offset), original.subarray(digits.offset));
  assert.equal(movedParsed.items.find((item) => item.id === 4).x, digits.x + 1);
  assert.equal(movedParsed.checksumValid, true);

  const replacement = {
    ...digits,
    modified: true,
    packedPixels: new Uint16Array([0x001f, 0xffff, 0x07c0, 0]),
    images: [
      new Uint8ClampedArray([0, 0, 248, 255, 248, 248, 248, 128]),
      new Uint8ClampedArray([0, 248, 0, 255, 0, 0, 0, 0]),
    ],
  };
  const edited = parseWatchface(writeWatchface(parsed, [
    replacement,
    parsed.items.find((item) => item.id === 17),
  ]));
  const reopenedDigits = edited.items.find((item) => item.id === 4);
  assert.equal(edited.compressionFormat, 'lz4');
  assert.deepEqual([...reopenedDigits.packedPixels], [...replacement.packedPixels]);
  assert.deepEqual([...reopenedDigits.images[0]], [...replacement.images[0]]);
  assert.deepEqual(reopenedDigits.frameFormats, [0x301, 0x301]);
  assert.equal(edited.checksumValid, true);

  const expandedPixels = new Uint16Array(100);
  const expandedImage = new Uint8ClampedArray(100 * 4);
  for (let pixel = 0; pixel < 100; pixel += 1) {
    const packed = (pixel * 197 + 17) & 0x7fff;
    expandedPixels[pixel] = packed;
    expandedImage.set([
      ((packed >>> 11) & 0x1f) << 3,
      ((packed >>> 6) & 0x1f) << 3,
      (packed & 0x1f) << 3,
      (pixel * 73 + 19) & 0xff,
    ], pixel * 4);
  }
  const expanded = parseWatchface(writeWatchface(parsed, [
    { ...digits, width: 100, height: 1, imgCount: 1, modified: true, packedPixels: expandedPixels, images: [expandedImage] },
    parsed.items.find((item) => item.id === 17),
  ]));
  assert.deepEqual([...expanded.items.find((item) => item.id === 4).packedPixels], [...expandedPixels]);

  const exactLength = parseWatchface(writeWatchface(parsed, [
    { ...digits, width: 5, height: 1, imgCount: 1, modified: true, packedPixels: expandedPixels.slice(0, 5), images: [expandedImage.slice(0, 20)] },
    parsed.items.find((item) => item.id === 17),
  ]));
  assert.deepEqual([...exactLength.items.find((item) => item.id === 4).packedPixels], [...expandedPixels.slice(0, 5)]);
});

test('positions clock hands around the ClockFaceEdit pivot and rotates their selection bounds', () => {
  const face = { width: 466, height: 466 };
  const hand = {
    id: 1,
    x: 233,
    y: 233,
    width: 24,
    height: 162,
    clockHandsInfo: [0, 162, 156, 24],
  };
  const midnight = new Date(2024, 0, 1, 0, 0, 0);
  const initial = getWatchfaceHandTransform(hand, face, midnight);
  assert.equal(initial.pivotX, 233);
  assert.equal(initial.pivotY, 233);
  assert.equal(initial.offsetX, -12);
  assert.equal(initial.offsetY, -156);
  assert.deepEqual(getWatchfaceItemBounds(hand, face, midnight), {
    x: 221,
    y: 77,
    width: 24,
    height: 162,
  });

  const threeOClock = new Date(2024, 0, 1, 3, 0, 0);
  assert.equal(getWatchfaceHandTransform(hand, face, threeOClock).angle, 90);
  const rotated = getWatchfaceItemBounds(hand, face, threeOClock);
  assert.ok(Math.abs(rotated.x - 227) < 1e-9);
  assert.ok(Math.abs(rotated.y - 221) < 1e-9);
  assert.ok(Math.abs(rotated.width - 162) < 1e-9);
  assert.ok(Math.abs(rotated.height - 24) < 1e-9);

  const legacyHand = { ...hand, y: 200, clockHandsInfo: [0, 0, 0, 0] };
  assert.deepEqual(getWatchfaceHandTransform(legacyHand, face, midnight), {
    angle: 0,
    pivotX: 233,
    pivotY: 233,
    offsetX: -12,
    offsetY: -183,
  });
});

test('uses ClockFaceEdit date text, formatted widths, and image-frame defaults', () => {
  const date = new Date(2024, 6, 4, 3, 5, 9);
  assert.equal(getWatchfaceItemText(4, date), '03');
  assert.equal(getWatchfaceItemText(5, date), '05');
  assert.equal(getWatchfaceItemText(6, date), '09');
  assert.equal(getWatchfaceItemText(11, date), '07');
  assert.equal(getWatchfaceItemText(13, date), '04');
  assert.equal(getWatchfaceItemText(27, date), '2024');
  assert.equal(getWatchfaceItemText(47, date), '4.32');
  assert.deepEqual(getWatchfaceItemBounds({
    id: 25,
    x: 189,
    y: 144,
    width: 19,
    height: 30,
    imgCount: 14,
  }, { width: 466, height: 466 }, date), {
    x: 198.5,
    y: 144,
    width: 76,
    height: 30,
  });
  assert.equal(getWatchfaceItemImageIndex({ id: 15, imgCount: 14 }, date), 11);
  assert.equal(getWatchfaceItemImageIndex({ id: 8, imgCount: 5 }, date), 4);
});

test('uses the BIN fixed-width character advance for punctuation', () => {
  const layer = {
    id: 47,
    x: 20,
    y: 20,
    width: 20,
    height: 12,
    characterWidths: Array(14).fill(20),
  };
  layer.characterWidths[1] = 4;
  layer.characterWidths[13] = 6;
  assert.deepEqual(getWatchfaceItemBounds(layer, { width: 240, height: 280 }, new Date(2024, 0, 1)), {
    x: 30,
    y: 20,
    width: 80,
    height: 12,
  });
});

test('exports moved BIN items with a valid checksum and unchanged image data', () => {
  const original = makeBin();
  const parsed = parseWatchface(original);
  const exported = writeWatchface(parsed, [{ ...parsed.items[0], x: 31, y: 42 }]);
  const reopened = parseWatchface(exported);
  assert.equal(reopened.items[0].x, 31);
  assert.equal(reopened.items[0].y, 42);
  assert.equal(reopened.checksumValid, true);
  assert.deepEqual(exported.subarray(50), original.subarray(50));
});

test('preserves compressed payloads for position-only edits', () => {
  const original = makeCompressedBin();
  const parsed = parseWatchface(original);
  const exported = writeWatchface(parsed, [{ ...parsed.items[0], x: 51, y: 64 }]);
  const reopened = parseWatchface(exported);
  assert.equal(reopened.compressed, true);
  assert.equal(reopened.items[0].x, 51);
  assert.equal(reopened.items[0].y, 64);
  assert.deepEqual(exported.subarray(50), original.subarray(50));
  assert.equal(reopened.checksumValid, true);
});

test('keeps image edits compressed and round-trips compressed sprite frames', () => {
  const parsed = parseWatchface(makeCompressedBin());
  const layer = {
    ...parsed.items[0],
    width: 100,
    height: 100,
    imgCount: 1,
    modified: true,
    packedPixels: new Uint16Array(10_000).fill(0x1234),
  };
  const exported = writeWatchface(parsed, [layer]);
  const reopened = parseWatchface(exported);
  assert.equal(reopened.compressed, true);
  assert.equal(reopened.items[0].width, 100);
  assert.equal(reopened.items[0].height, 100);
  assert.ok(exported.length < 100 + 10_000 * 2);
  assert.deepEqual([...reopened.items[0].packedPixels], Array(10_000).fill(0x1234));
  assert.equal(reopened.checksumValid, true);
});

test('preserves the supplied compressed BIN and its source flags on position-only edits', () => {
  const original = new Uint8Array(readFileSync(new URL('../test/dial_RH303AL_466x466_121480_100022v4.bin', import.meta.url)));
  const parsed = parseWatchface(original);
  assert.equal(parsed.compressed, true);
  const background = parsed.items.find((item) => item.id === 17);
  assert.ok(background);
  assert.equal(background.copyImage, false);

  const exported = writeWatchface(parsed, parsed.items.map((item) => (
    item.id === background.id ? { ...item, x: item.x + 1 } : item
  )));
  const reopened = parseWatchface(exported);
  assert.equal(reopened.compressed, true);
  assert.equal(reopened.items.find((item) => item.id === background.id).copyImage, background.copyImage);
  assert.deepEqual(exported.subarray(background.offset), original.subarray(background.offset));
  assert.equal(reopened.checksumValid, true);
});

test('rejects truncated files and invalid positions', () => {
  assert.throws(() => parseWatchface(new Uint8Array(16)), /too small/);
  const parsed = parseWatchface(makeBin());
  assert.throws(() => writeWatchface(parsed, [{ id: 17, x: -1, y: 0 }]), /between 0 and 65535/);
  assert.throws(() => writeWatchface(parsed, [parsed.items[0], { ...parsed.items[0], x: 40 }]), /duplicate element types/);
});

test('recovers incomplete raw sprite data and rebuilds a complete BIN on export', () => {
  const truncated = makeBin().slice(0, -2);
  updateChecksum(truncated);
  const parsed = parseWatchface(truncated);

  assert.deepEqual(parsed.truncatedItems, [{ id: 17, name: 'Background', truncatedBytes: 2 }]);
  assert.deepEqual([...parsed.items[0].packedPixels], [0xffff, 0xffff, 0xffff, 0]);

  const repaired = parseWatchface(writeWatchface(parsed, parsed.items));
  assert.deepEqual(repaired.truncatedItems, []);
  assert.equal(repaired.checksumValid, true);
  assert.equal(repaired.items[0].packedPixels.length, 4);
});

test('rebuilds a BIN when a bitmap changes and supports deleting items', () => {
  const parsed = parseWatchface(makeBin());
  const updated = writeWatchface(parsed, [{
    ...parsed.items[0],
    modified: true,
    packedPixels: new Uint16Array([0x1234, 0x5678, 0x9abc, 0xdef0]),
  }]);
  const reopened = parseWatchface(updated);
  assert.equal(reopened.compressed, false);
  assert.equal(reopened.items[0].x, 12);
  assert.deepEqual([...reopened.items[0].packedPixels], [0x1234, 0x5678, 0x9abc, 0xdef0]);
  assert.equal(reopened.checksumValid, true);

  const withoutItems = parseWatchface(writeWatchface(parsed, []));
  assert.equal(withoutItems.items.length, 0);
  assert.equal(withoutItems.checksumValid, true);
});

test('exports the BlackIsTransparent setting in the BIN item flag', () => {
  const parsed = parseWatchface(makeBin());
  const layer = {
    ...parsed.items[0],
    blackIsTransparent: true,
    copyImage: true,
    packedPixels: new Uint16Array(4),
    modified: true,
  };
  const exported = parseWatchface(writeWatchface(parsed, [layer]));
  assert.equal(exported.items[0].copyImage, false);
  assert.equal(exported.items[0].images[0][3], 0);
});

test('imports ClockFaceEdit JSON metadata and image assets into an exportable BIN', () => {
  const project = {
    HoursHand: {
      X: 1,
      Y: 2,
      ImageIndex: 0,
      ImagesCount: 1,
      Type: 1,
      BlackIsTransparent: true,
      ArrowInfo: { ArrowFullLength: 3, ArrowLengthToCenter: 2, ArrowWidth: 1 },
    },
    Background: {
      X: 0,
      Y: 0,
      ImageIndex: 1,
      ImagesCount: 1,
      Type: 17,
      BlackIsTransparent: true,
    },
  };
  const imageAssets = new Map([
    [0, { width: 1, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255]) }],
    [1, { width: 2, height: 2, pixels: new Uint8ClampedArray(16).fill(255) }],
  ]);

  assert.deepEqual(clockFaceEditImageIndexes(project), [0, 1]);
  const imported = importClockFaceEditProject(project, imageAssets);
  assert.equal(imported.width, 2);
  assert.equal(imported.height, 2);
  assert.equal(imported.layers.find((layer) => layer.id === 17).copyImage, true);
  assert.equal(imported.layers.find((layer) => layer.id === 17).blackIsTransparent, false);
  assert.equal(imported.layers.find((layer) => layer.id === 17).clockFaceProperties.BlackIsTransparent, false);
  const reopened = parseWatchface(writeWatchface(imported.document, imported.layers));
  assert.deepEqual(reopened.items.map((item) => item.id), [1, 17]);
  assert.deepEqual(reopened.items[0].clockHandsInfo, [0, 3, 2, 1]);
  assert.equal(reopened.checksumValid, true);
  const savedProject = createProjectFile({
    title: 'ClockFaceEdit import',
    width: imported.width,
    height: imported.height,
    shape: 'circle',
    sourceBytes: imported.document.bytes,
    layers: imported.layers,
  });
  assert.deepEqual(savedProject.layers[0].clockHandsInfo, [0, 3, 2, 1]);
  assert.equal(savedProject.layers[0].images.length, 1);
});

test('adds BIN elements and packs PNG colors using the format color encoding', () => {
  const parsed = parseWatchface(makeBin());
  const added = {
    id: 1,
    name: 'Hour hand',
    width: 1,
    height: 1,
    imgCount: 1,
    x: 100,
    y: 120,
    copyImage: false,
    packedPixels: new Uint16Array([0xf800]),
  };
  const reopened = parseWatchface(writeWatchface(parsed, [...parsed.items, added]));
  assert.deepEqual(reopened.items.map((item) => item.id), [1, 17]);
  assert.deepEqual([...reopened.items[0].packedPixels], [0xf800]);
  assert.equal(reopened.checksumValid, true);
  assert.deepEqual([...rgbaToPackedPixels([new Uint8ClampedArray([255, 0, 0, 255])], 1, 1)], [0xf800]);
  assert.deepEqual([...rgbaToPackedPixels([new Uint8ClampedArray([200, 90, 20, 0])], 1, 1)], [0]);
});

test('round-trips the source BIN and layer state in a project file', () => {
  const source = makeBin();
  const project = createProjectFile({
    title: 'Fixture',
    width: 240,
    height: 280,
    shape: 'rounded',
    sourceBytes: source,
    layers: [{ id: 17, uid: 'imported-background-1', name: 'Background', x: 33, y: 44, width: 2, height: 2, visible: false, locked: true, blackIsTransparent: false }],
  });

  const opened = JSON.parse(JSON.stringify(project));
  assert.equal(opened.format, 'wfeditormk66-project');
  assert.equal(opened.shape, 'rounded');
  assert.deepEqual(base64ToBytes(opened.sourceBin), source);
  assert.deepEqual(opened.layers[0], {
    id: 17,
    uid: 'imported-background-1',
    name: 'Background',
    x: 33,
    y: 44,
    width: 2,
    height: 2,
    visible: false,
    locked: true,
    blackIsTransparent: false,
  });
});

test('default new-watch-face template uses the Kieslect 466 by 466 screen', () => {
  const template = new Uint8Array(readFileSync('Default/Default screen.bin'));
  const parsed = parseWatchface(template);
  assert.equal(parsed.width, 466);
  assert.equal(parsed.height, 466);
  assert.equal(parsed.compressed, true);
  assert.ok(parsed.items.some((item) => item.id === 17));
});
