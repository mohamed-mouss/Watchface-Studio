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
