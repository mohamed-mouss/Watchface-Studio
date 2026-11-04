const HEADER_SIZE = 1900;
const FACE_DATA_OFFSET = 5;
const FACE_DATA_SIZE = 10;
const FACE_DATA_LIMIT = 39;
const BLOB_OFFSET_TABLE = 400;
const BLOB_SIZE_TABLE = 1400;
const BLOB_LIMIT = 250;
const RLE_MARKER = 0x2108;
const MAX_PIXELS = 32_000_000;

const TYPE_DEFINITIONS = {
  0x00: ['Background strips', 10],
  0x01: ['Background', 1],
  0x10: ['Month names', 12],
  0x11: ['Month digits', 10],
  0x12: ['Year digits', 10],
  0x30: ['Day digits', 10],
  0x40: ['Hour tens', 10],
  0x41: ['Hour ones', 10],
  0x43: ['Minute tens', 10],
  0x44: ['Minute ones', 10],
  0x45: ['AM indicator', 1],
  0x46: ['PM indicator', 1],
  0x47: ['Time digits (alternate)', 10],
  0x48: ['Time digits (alternate)', 10],
  0x60: ['Weekday', 7],
  0x61: ['Weekday (alternate)', 7],
  0x62: ['Steps digits', 10],
  0x63: ['Steps digits (center)', 10],
  0x64: ['Steps digits (right)', 10],
  0x65: ['Heart-rate digits', 10],
  0x66: ['Heart-rate digits (center)', 10],
  0x67: ['Heart-rate digits (right)', 10],
  0x68: ['Calories digits', 10],
  0x6b: ['Month digits (alternate)', 10],
  0x6c: ['Day digits (alternate)', 10],
  0x70: ['Steps progress', 11],
  0x71: ['Steps icon', 1],
  0x72: ['Steps digits (alternate)', 10],
  0x73: ['Steps digits (center, alternate)', 10],
  0x74: ['Steps digits (right, alternate)', 10],
  0x76: ['Step goal digits', 10],
  0x80: ['Heart-rate progress', 11],
  0x81: ['Heart-rate icon', 1],
  0x82: ['Heart-rate digits (alternate)', 10],
  0x83: ['Heart-rate digits (center, alternate)', 10],
  0x84: ['Heart-rate digits (right, alternate)', 10],
  0x90: ['Calories progress', 11],
  0x91: ['Calories icon', 1],
  0x92: ['Calories digits (alternate)', 10],
  0x93: ['Calories digits (center, alternate)', 10],
  0x94: ['Calories digits (right, alternate)', 10],
  0xa0: ['Distance progress', 11],
  0xa1: ['Distance icon', 1],
  0xa2: ['Distance digits', 10],
  0xa3: ['Distance digits (center)', 10],
  0xa4: ['Distance digits (right)', 10],
  0xa5: ['Kilometer unit', 1],
  0xa6: ['Mile unit', 1],
  0xc0: ['Bluetooth connected', 1],
  0xc1: ['Bluetooth disconnected', 1],
  0xce: ['Battery image', 1],
  0xd0: ['Battery image (alternate)', 1],
  0xd1: ['Battery image (alternate)', 1],
  0xd2: ['Battery digits', 10],
  0xd3: ['Battery digits (center)', 10],
  0xd4: ['Battery digits (right)', 10],
  0xd6: ['Temperature icon', 1],
  0xd7: ['Temperature digits', 13],
  0xd8: ['Temperature digits (center)', 13],
  0xd9: ['Temperature digits (right)', 13],
  0xda: ['Battery image (alternate)', 1],
  0xf0: ['Separator', 1],
  0xf1: ['Hour hand', 1],
  0xf2: ['Minute hand', 1],
  0xf3: ['Second hand', 1],
  0xf4: ['Upper hand pin', 1],
  0xf5: ['Lower hand pin', 1],
};

const DIGIT_TYPES = new Set([
  0x11, 0x12, 0x30, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x6b, 0x6c, 0x72, 0x73, 0x74, 0x76, 0x82, 0x83, 0x84,
  0x92, 0x93, 0x94, 0xa2, 0xa3, 0xa4, 0xd2, 0xd3, 0xd4,
  0xd7, 0xd8, 0xd9,
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

function getBlobCount(type, animationFrames) {
  if (type >= 0xf6 && type <= 0xf8) return animationFrames || 1;
  return TYPE_DEFINITIONS[type]?.[1] ?? 1;
}

function decodeRleBlob(blob, width, height, label) {
  assert(blob.length >= 2 && readU16(new DataView(blob.buffer, blob.byteOffset, blob.byteLength), 0) === RLE_MARKER, `${label} has an unknown compressed image encoding.`);
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const rowDataStart = 2 + height * 2;
  assert(rowDataStart <= blob.length, `${label} has a truncated RLE row table.`);
  const pixels = new Uint16Array(width * height);
  let cursor = rowDataStart;
  let previousEnd = rowDataStart;

  for (let y = 0; y < height; y += 1) {
    const rowEnd = readU16(view, 2 + y * 2);
    assert(rowEnd >= previousEnd && rowEnd <= blob.length, `${label} has an invalid RLE row offset.`);
    let x = 0;
    while (cursor < rowEnd) {
      assert(cursor + 3 <= rowEnd, `${label} has an incomplete RLE run.`);
      const packed = (blob[cursor] << 8) | blob[cursor + 1];
      const count = blob[cursor + 2];
      assert(count > 0 && x + count <= width, `${label} has an invalid RLE pixel run.`);
      pixels.fill(packed, y * width + x, y * width + x + count);
      x += count;
      cursor += 3;
    }
    assert(x === width, `${label} RLE row ${y + 1} has ${x} pixels; expected ${width}.`);
    previousEnd = rowEnd;
  }
  assert(cursor === previousEnd, `${label} contains trailing or unreferenced compressed data.`);
  return pixels;
}

function decodeBlob(blob, width, height, label) {
  const pixelCount = width * height;
  assert(pixelCount > 0 && pixelCount <= MAX_PIXELS, `${label} has invalid image dimensions.`);
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const rle = blob.length >= 2 && readU16(view, 0) === RLE_MARKER;
  let packedPixels;
  if (rle) {
    packedPixels = decodeRleBlob(blob, width, height, label);
  } else {
    assert(blob.length >= pixelCount * 2, `${label} raw RGB565 data is incomplete.`);
    packedPixels = new Uint16Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) packedPixels[pixel] = readU16(view, pixel * 2);
  }
  const image = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const packed = packedPixels[pixel];
    const offset = pixel * 4;
    image[offset] = ((packed >>> 11) & 0x1f) << 3;
    image[offset + 1] = ((packed >>> 5) & 0x3f) << 2;
    image[offset + 2] = (packed & 0x1f) << 3;
    image[offset + 3] = 255;
  }
  return { image, packedPixels, rle };
}

function encodeRleBlob(pixels, width, height) {
  const rows = [];
  const rowEnds = [];
  let cursor = 2 + height * 2;
  for (let y = 0; y < height; y += 1) {
    const row = [];
    let x = 0;
    while (x < width) {
      const color = pixels[y * width + x];
      let count = 1;
      while (x + count < width && count < 255 && pixels[y * width + x + count] === color) count += 1;
      row.push((color >>> 8) & 0xff, color & 0xff, count);
      x += count;
    }
    rows.push(Uint8Array.from(row));
    cursor += row.length;
    assert(cursor <= 0xffff, 'This compressed image is too large for the Type C row-offset table.');
    rowEnds.push(cursor);
  }
  const blob = new Uint8Array(cursor);
  const view = new DataView(blob.buffer);
  view.setUint16(0, RLE_MARKER, true);
  let rowOffset = 2 + height * 2;
  for (let y = 0; y < height; y += 1) {
    view.setUint16(2 + y * 2, rowEnds[y], true);
    blob.set(rows[y], rowOffset);
    rowOffset += rows[y].length;
  }
  return blob;
}

function encodeBlob(pixels, width, height, useRle) {
  if (useRle) return encodeRleBlob(pixels, width, height);
  const bytes = new Uint8Array(pixels.length * 2);
  pixels.forEach((pixel, index) => {
    bytes[index * 2] = pixel & 0xff;
    bytes[index * 2 + 1] = pixel >>> 8;
  });
  return bytes;
}

function isLayerRecordValid(bytes, index, layerCount, blobCount) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = FACE_DATA_OFFSET + index * FACE_DATA_SIZE;
  const type = bytes[offset];
  const blobIndex = bytes[offset + 1];
  const width = readU16(view, offset + 6);
  const height = readU16(view, offset + 8);
  const count = getBlobCount(type, readU16(view, BLOB_SIZE_TABLE));
  return width > 0 && height > 0 && width <= 4096 && height <= 4096
    && blobIndex + count <= blobCount
    && index < layerCount;
}

export function isDafitTypeC(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_SIZE || ![0x81, 0x84].includes(bytes[0])) return false;
  const layerCount = bytes[1];
  const blobCount = bytes[2];
  if (layerCount < 1 || layerCount > FACE_DATA_LIMIT || blobCount < 1 || blobCount > BLOB_LIMIT) return false;
  if (!Array.from({ length: layerCount }, (_, index) => isLayerRecordValid(bytes, index, layerCount, blobCount)).every(Boolean)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets = Array.from({ length: blobCount }, (_, index) => readU32(view, BLOB_OFFSET_TABLE + index * 4));
  const payloadSize = bytes.length - HEADER_SIZE;
  return offsets[0] === 0
    && offsets.every((offset, index) => offset < payloadSize && (!index || offset >= offsets[index - 1]));
}

export function parseDafitTypeC(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  assert(isDafitTypeC(bytes), 'This is not a supported Da Fit Type C watch-face BIN.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const layerCount = bytes[1];
  const blobCount = bytes[2];
  const declaredAnimationFrames = readU16(view, BLOB_SIZE_TABLE);
  const animationFrames = declaredAnimationFrames > 0 && declaredAnimationFrames <= BLOB_LIMIT ? declaredAnimationFrames : 1;
  const offsets = Array.from({ length: blobCount }, (_, index) => readU32(view, BLOB_OFFSET_TABLE + index * 4));
  const blobs = offsets.map((offset, index) => {
    let end = bytes.length - HEADER_SIZE;
    for (let nextIndex = index + 1; nextIndex < offsets.length; nextIndex += 1) {
      if (offsets[nextIndex] > offset) {
        end = offsets[nextIndex];
        break;
      }
    }
    assert(end > offset, `Da Fit image blob ${index} has an invalid offset range.`);
    return bytes.slice(HEADER_SIZE + offset, HEADER_SIZE + end);
  });

  const layers = [];
  let totalPixels = 0;
  for (let index = 0; index < layerCount; index += 1) {
    const recordOffset = FACE_DATA_OFFSET + index * FACE_DATA_SIZE;
    const id = bytes[recordOffset];
    const blobIndex = bytes[recordOffset + 1];
    const width = readU16(view, recordOffset + 6);
    const height = readU16(view, recordOffset + 8);
    const imgCount = getBlobCount(id, animationFrames);
    assert(blobIndex + imgCount <= blobCount, `Da Fit element ${index + 1} references missing image blobs.`);
    totalPixels += width * height * imgCount;
    assert(totalPixels <= MAX_PIXELS, 'Da Fit face contains too many image pixels.');
    const decoded = Array.from({ length: imgCount }, (_, frame) => decodeBlob(
      blobs[blobIndex + frame],
      width,
      height,
      `Da Fit element ${index + 1}, frame ${frame + 1}`,
    ));
    const packedPixels = new Uint16Array(width * height * imgCount);
    decoded.forEach((image, frame) => packedPixels.set(image.packedPixels, frame * width * height));
    layers.push({
      uid: `dafit-${index}`,
      sourceRecordIndex: index,
      id,
      type: 'dafit',
      name: TYPE_DEFINITIONS[id]?.[0] || `Type 0x${id.toString(16).padStart(2, '0')}`,
      blobIndex,
      sourceBlobCompression: decoded.map((image) => image.rle),
      x: readU16(view, recordOffset + 2),
      y: readU16(view, recordOffset + 4),
      width,
      height,
      imgCount,
      copyImage: true,
      blackIsTransparent: false,
      visible: true,
      locked: false,
      images: decoded.map((image) => image.image),
      packedPixels,
      modified: false,
    });
  }

  const background = layers.find((layer) => layer.id === 0x01) || layers.find((layer) => layer.id === 0x00);
  const width = background?.width || 240;
  const height = background ? background.height * (background.id === 0x00 ? 10 : 1) : 240;
  return {
    format: 'dafit-c',
    bytes: bytes.slice(),
    layers,
    blobs,
    blobOffsets: offsets,
    width,
    height,
    fileId: bytes[0],
    dataCount: layerCount,
    blobCount,
    faceNumber: readU16(view, 3),
    animationFrames,
  };
}

export function writeDafitTypeC(document, layers) {
  assert(document?.format === 'dafit-c' && document.bytes instanceof Uint8Array, 'Open a Da Fit Type C BIN before exporting.');
  assert(layers.length > 0, 'A Da Fit Type C BIN must contain at least one layer.');
  assert(layers.length <= FACE_DATA_LIMIT, `Da Fit Type C files support at most ${FACE_DATA_LIMIT} layer records.`);
  const outputBlobs = document.blobs.map((blob) => blob.slice());
  const records = layers.map((layer, layerIndex) => {
    assert(Number.isInteger(layer.id) && layer.id >= 0 && layer.id <= 255, `${layer.name} has an invalid Da Fit type code.`);
    assert(Number.isInteger(layer.x) && layer.x >= 0 && layer.x <= 65535, `${layer.name} X position must be between 0 and 65535.`);
    assert(Number.isInteger(layer.y) && layer.y >= 0 && layer.y <= 65535, `${layer.name} Y position must be between 0 and 65535.`);
    assert(Number.isInteger(layer.width) && layer.width > 0 && layer.width <= 4096, `${layer.name} width must be between 1 and 4096.`);
    assert(Number.isInteger(layer.height) && layer.height > 0 && layer.height <= 4096, `${layer.name} height must be between 1 and 4096.`);
    const count = layer.imgCount;
    assert(Number.isInteger(count) && count > 0 && count <= 255 && layer.images?.length === count, `${layer.name} has an invalid image collection.`);
    assert(count === getBlobCount(layer.id, document.animationFrames), `${layer.name} needs ${getBlobCount(layer.id, document.animationFrames)} image frame(s) for its Da Fit type.`);
    const packedPixels = layer.modified
      ? packDafitImages(layer.images, layer.width, layer.height)
      : layer.packedPixels;
    assert(packedPixels instanceof Uint16Array && packedPixels.length === layer.width * layer.height * count, `${layer.name} image data does not match its dimensions.`);
    let blobIndex = layer.blobIndex;
    const original = document.layers.find((source) => source.sourceRecordIndex === layer.sourceRecordIndex);
    const unchanged = original
      && !layer.modified
      && layer.width === original.width
      && layer.height === original.height
      && count === original.imgCount
      && blobIndex === original.blobIndex;
    if (!unchanged) {
      assert(layer.type === 'dafit', `Only Da Fit Type C elements can be added to this BIN.`);
      blobIndex = outputBlobs.length;
      assert(blobIndex + count <= BLOB_LIMIT, `Adding ${layer.name} would exceed the Type C blob-index limit.`);
      const imageSize = layer.width * layer.height;
      for (let frame = 0; frame < count; frame += 1) {
        const pixels = packedPixels.subarray(frame * imageSize, (frame + 1) * imageSize);
        const sourceCompression = layer.sourceBlobCompression?.[frame]
          ?? layer.sourceBlobCompression?.[0]
          ?? (pixels.length >= 128);
        outputBlobs.push(encodeBlob(pixels, layer.width, layer.height, sourceCompression));
      }
    }
    return { layer, layerIndex, blobIndex };
  });

  assert(outputBlobs.length <= BLOB_LIMIT, 'Da Fit Type C files support at most 250 image blobs.');
  const header = document.bytes.slice(0, HEADER_SIZE);
  header[0] = document.fileId;
  header[1] = records.length;
  header[2] = outputBlobs.length;
  header.fill(0, FACE_DATA_OFFSET, BLOB_OFFSET_TABLE);
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  for (const { layer, layerIndex, blobIndex } of records) {
    const offset = FACE_DATA_OFFSET + layerIndex * FACE_DATA_SIZE;
    header[offset] = layer.id;
    header[offset + 1] = blobIndex;
    headerView.setUint16(offset + 2, layer.x, true);
    headerView.setUint16(offset + 4, layer.y, true);
    headerView.setUint16(offset + 6, layer.width, true);
    headerView.setUint16(offset + 8, layer.height, true);
  }
  let payloadSize = 0;
  const payloadBlobs = [];
  const sharedOffsets = new Map();
  outputBlobs.forEach((blob, index) => {
    const sourceOffset = index < document.blobs.length ? document.blobOffsets[index] : null;
    const sharedOffset = sourceOffset == null ? undefined : sharedOffsets.get(sourceOffset);
    const blobOffset = sharedOffset ?? payloadSize;
    headerView.setUint32(BLOB_OFFSET_TABLE + index * 4, blobOffset, true);
    if (index >= document.blobs.length) {
      headerView.setUint16(BLOB_SIZE_TABLE + index * 2, Math.min(blob.length, 0xffff), true);
    }
    if (sharedOffset === undefined) {
      if (sourceOffset != null) sharedOffsets.set(sourceOffset, blobOffset);
      payloadBlobs.push(blob);
      payloadSize += blob.length;
    }
  });
  assert(payloadSize <= 0xffffffff - HEADER_SIZE, 'Da Fit Type C export exceeds the maximum file size.');
  const bytes = new Uint8Array(HEADER_SIZE + payloadSize);
  bytes.set(header);
  let cursor = HEADER_SIZE;
  for (const blob of payloadBlobs) {
    bytes.set(blob, cursor);
    cursor += blob.length;
  }
  return bytes;
}

export function packDafitImages(images, width, height) {
  const packed = new Uint16Array(width * height * images.length);
  images.forEach((image, frame) => {
    assert(image.length === width * height * 4, 'Imported image dimensions do not match the Da Fit frame.');
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const alpha = image[offset + 3];
      const red = alpha < 128 ? 0 : image[offset];
      const green = alpha < 128 ? 0 : image[offset + 1];
      const blue = alpha < 128 ? 0 : image[offset + 2];
      packed[frame * width * height + pixel] = ((red >>> 3) << 11)
        | ((green >>> 2) << 5)
        | (blue >>> 3);
    }
  });
  return packed;
}

export function dafitFrameIndex(layer, date = new Date()) {
  const type = layer.id;
  if (type === 0x40) return Math.floor(date.getHours() / 10);
  if (type === 0x41) return date.getHours() % 10;
  if (type === 0x43) return Math.floor(date.getMinutes() / 10);
  if (type === 0x44) return date.getMinutes() % 10;
  if (type === 0x11 || type === 0x6b) return (date.getMonth() + 1) % 10;
  if (type === 0x12) return date.getFullYear() % 10;
  if (type === 0x30 || type === 0x6c) return date.getDate() % 10;
  if ([0x60, 0x61].includes(type)) return date.getDay() % layer.imgCount;
  if (DIGIT_TYPES.has(type)) return 0;
  return Math.min(layer.imgCount - 1, Math.max(0, getDafitProgressFrame(type)));
}

function getDafitProgressFrame(type) {
  if ([0x70, 0x80, 0x90, 0xa0].includes(type)) return 6;
  return 0;
}
