import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isDafitTypeC, parseDafitTypeC, writeDafitTypeC } from '../src/dafit.mjs';
import { base64ToBytes, createProjectFile } from '../src/watchface.mjs';

const fixtures = [
  '2abd23d1a15fec2a87dbd4dfec5a8b2b.bin',
  '9c289d2e70eb6131d8e47446bcba436e.bin',
  'b15661ec530356d9fd2dd9a0c8ebfc10.bin',
  'de35605df9a4c980706d1124f9d522e9.bin',
];
const fixturesAvailable = [
  ...fixtures,
  'dial_RH303AL_466x466_121480_100022.bin',
].every((name) => existsSync(path.join('bin-dafit', name)));

function readFixture(name) {
  return new Uint8Array(readFileSync(path.join('bin-dafit', name)));
}

test('detects and parses each supplied Da Fit Type C BIN', { skip: !fixturesAvailable && 'Optional bin-dafit sample files are not present.' }, () => {
  for (const name of fixtures) {
    const bytes = readFixture(name);
    assert.equal(isDafitTypeC(bytes), true, name);
    const parsed = parseDafitTypeC(bytes);
    assert.equal(parsed.width, 240, name);
    assert.equal(parsed.height, 240, name);
    assert.equal(parsed.layers.length, bytes[1], name);
    assert.equal(parsed.blobCount, bytes[2], name);
    assert.ok(parsed.layers.every((layer) => layer.images.length === layer.imgCount), name);
  }

  assert.equal(isDafitTypeC(readFixture('dial_RH303AL_466x466_121480_100022.bin')), false);
});

test('position-only Type C export preserves image blobs and compression', { skip: !fixturesAvailable && 'Optional bin-dafit sample files are not present.' }, () => {
  for (const name of fixtures) {
    const originalBytes = readFixture(name);
    const original = parseDafitTypeC(originalBytes);
    const layers = original.layers.map((layer, index) => (
      index === 0 ? { ...layer, x: layer.x + 1, y: layer.y + 1 } : layer
    ));
    const exported = parseDafitTypeC(writeDafitTypeC(original, layers));
    assert.equal(exported.layers[0].x, layers[0].x, name);
    assert.equal(exported.layers[0].y, layers[0].y, name);
    assert.equal(exported.blobs.length, original.blobs.length, name);
    assert.deepEqual(
      exported.bytes.subarray(1400, 1900),
      originalBytes.subarray(1400, 1900),
      `${name}, preserved Type C size table`,
    );
    for (let index = 0; index < original.blobs.length; index += 1) {
      assert.deepEqual(exported.blobs[index], original.blobs[index], `${name}, blob ${index}`);
    }
    assert.deepEqual(
      exported.layers.map((layer) => layer.sourceBlobCompression),
      original.layers.map((layer) => layer.sourceBlobCompression),
      name,
    );
  }
});

test('edited RLE and raw image frames round-trip as RGB565', { skip: !fixturesAvailable && 'Optional bin-dafit sample files are not present.' }, () => {
  const original = parseDafitTypeC(readFixture(fixtures[1]));
  for (const useRle of [true, false]) {
    const source = original.layers.find((layer) => layer.sourceBlobCompression[0] === useRle);
    assert.ok(source);
    const images = source.images.map((image) => new Uint8ClampedArray(image));
    images[0].set([255, 0, 0, 255], 0);
    const changed = { ...source, images, modified: true };
    const outputLayers = original.layers.map((layer) => layer.uid === source.uid ? changed : layer);
    const exported = parseDafitTypeC(writeDafitTypeC(original, outputLayers));
    const reparsed = exported.layers.find((layer) => layer.uid === source.uid);
    assert.equal(reparsed.packedPixels[0], 0xf800);
    assert.deepEqual(reparsed.sourceBlobCompression, source.sourceBlobCompression);
  }
});

test('saves the Type C source format in editable project files', { skip: !fixturesAvailable && 'Optional bin-dafit sample files are not present.' }, () => {
  const bytes = readFixture(fixtures[0]);
  const document = parseDafitTypeC(bytes);
  const project = createProjectFile({
    title: 'Da Fit sample',
    width: document.width,
    height: document.height,
    shape: 'circle',
    sourceBytes: document.bytes,
    sourceFormat: document.format,
    layers: document.layers,
  });
  assert.equal(project.sourceFormat, 'dafit-c');
  assert.deepEqual(base64ToBytes(project.sourceBin), bytes);
});
