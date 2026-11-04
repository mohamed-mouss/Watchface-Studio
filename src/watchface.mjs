const HEADER_SIZE = 24;
const ITEM_SIZE = 24;
const COMPRESS_FORMAT = 0x02ff0100;
const ITEM_NAMES = {
  1: 'Hour hand',
  2: 'Minute hand',
  3: 'Second hand',
  4: 'Hour digits',
  5: 'Minute digits',
  6: 'Second digits',
  8: 'Battery indicator',
  9: 'Connection indicator',
  10: 'Preview image',
  11: 'Month',
  12: 'Month names',
  13: 'Day',
  14: 'Month separator',
  15: 'Weekday',
  16: 'AM / PM',
  17: 'Background',
  19: 'Heart rate',
  20: 'Weather icons',
  21: 'Temperature',
  22: 'Temperature icon',
  23: 'Heart icon',
  25: 'Steps',
  26: 'Steps icon',
  27: 'Year',
  28: 'Date separator',
  30: 'Calories',
  31: 'Calories icon',
  33: 'Battery text',
  34: 'Battery icon',
  47: 'Distance',
  48: 'Distance icon',
  49: 'Time separator',
};
const FORMATTED_ITEM_IDS = new Set([4, 5, 6, 11, 13, 19, 21, 25, 27, 30, 33, 47]);
const CHARACTER_IMAGE_INDEX = {
  '-': 0,
  '.': 1,
  '/': 2,
  '0': 3,
  '1': 4,
  '2': 5,
  '3': 6,
  '4': 7,
  '5': 8,
  '6': 9,
  '7': 10,
  '8': 11,
  '9': 12,
  ':': 13,
};
const blackTransparencyCache = new WeakMap();
const opaqueImageCache = new WeakMap();
export const ITEM_CATALOG = Object.entries(ITEM_NAMES).map(([id, name]) => ({
  id: Number(id),
  name,
  imgCount: ({
    1: 1, 2: 1, 3: 1, 4: 14, 5: 14, 6: 14, 8: 5, 9: 2, 10: 1, 11: 14,
    12: 24, 13: 14, 14: 1, 15: 14, 16: 4, 17: 1, 19: 14, 20: 16, 21: 14,
    22: 2, 23: 2, 25: 14, 26: 2, 27: 14, 28: 1, 30: 14, 31: 2, 33: 14,
    34: 1, 47: 14, 48: 2, 49: 1,
  })[id],
}));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function getWatchfaceItemText(id, date = new Date()) {
  if (id === 4) return String(date.getHours()).padStart(2, '0');
  if (id === 5) return String(date.getMinutes()).padStart(2, '0');
  if (id === 6) return String(date.getSeconds()).padStart(2, '0');
  if (id === 11) return String(date.getMonth() + 1).padStart(2, '0');
  if (id === 13) return String(date.getDate()).padStart(2, '0');
  if (id === 19) return '80';
  if (id === 21) return '20';
  if (id === 25) return '2345';
  if (id === 27) return String(date.getFullYear());
  if (id === 30) return '345';
  if (id === 33) return '100';
  if (id === 47) return (4320 / 1000).toFixed(2);
  return null;
}

export function getWatchfaceCharacterImageIndex(character) {
  return CHARACTER_IMAGE_INDEX[character] ?? 0;
}

export function getWatchfaceItemImageIndex(layer, date = new Date()) {
  if (!layer.imgCount) return -1;
  let index = 0;
  if (layer.id === 8) {
    index = Math.min(layer.imgCount - 1, Math.max(0, Math.floor((layer.imgCount * 105) / 100)));
  } else if (layer.id === 12) {
    index = 12;
  } else if (layer.id === 15) {
    const weekday = date.getDay();
    index = (weekday >= 7 || weekday < 0 ? 0 : weekday) + 7;
  } else if (layer.id === 20) {
    index = 5;
  } else if ([23, 26, 31].includes(layer.id)) {
    index = 1;
  } else if ([16, 48].includes(layer.id)) {
    index = layer.imgCount === 2 ? 0 : 2;
  }
  return index % layer.imgCount;
}

export function getWatchfaceHandTransform(layer, face, date = new Date()) {
  if (layer.id < 1 || layer.id > 3) return null;
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  const angle = layer.id === 1
    ? 360 * (seconds / 3600 / 12)
    : layer.id === 2
      ? 360 * (seconds / 3600)
      : 360 * seconds / 60;
  const info = layer.clockHandsInfo || [];
  const hasPivotInfo = [info[1], info[2], info[3]].some(Boolean);
  if (hasPivotInfo) {
    return {
      angle,
      pivotX: layer.x,
      pivotY: layer.y,
      offsetX: -(info[3] || 0) / 2,
      offsetY: -(info[2] || 0),
    };
  }
  return {
    angle,
    pivotX: face.width / 2,
    pivotY: face.height / 2,
    offsetX: -layer.width / 2,
    offsetY: -face.height / 2 + (layer.y ? layer.y - layer.height + layer.width / 2 : 0),
  };
}

export function getWatchfaceItemBounds(layer, face, date = new Date()) {
  if (layer.id === 10 || layer.id === 17) {
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }
  if (layer.id >= 1 && layer.id <= 3) {
    const transform = getWatchfaceHandTransform(layer, face, date);
    const radians = transform.angle * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const corners = [
      [0, 0],
      [layer.width, 0],
      [0, layer.height],
      [layer.width, layer.height],
    ].map(([x, y]) => {
      const localX = x + transform.offsetX;
      const localY = y + transform.offsetY;
      return [
        transform.pivotX + localX * cosine - localY * sine,
        transform.pivotY + localX * sine + localY * cosine,
      ];
    });
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }
  if (FORMATTED_ITEM_IDS.has(layer.id)) {
    const text = getWatchfaceItemText(layer.id, date);
    const textWidth = text.length * layer.width;
    const slotCount = [19, 21, 25, 30, 33, 47].includes(layer.id)
      ? ({ 19: 3, 21: 4, 25: 5, 30: 4, 33: 3, 47: 5 })[layer.id]
      : 0;
    const offsetX = slotCount ? (slotCount * layer.width - textWidth) * 0.5 : 0;
    return { x: layer.x + offsetX, y: layer.y, width: textWidth, height: layer.height };
  }
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

export function applyBlackTransparency(image, copyImage) {
  if (copyImage) {
    const cached = opaqueImageCache.get(image);
    if (cached) return cached;
    let output;
    for (let offset = 3; offset < image.length; offset += 4) {
      if (image[offset] === 255) continue;
      output ||= new Uint8ClampedArray(image);
      output[offset] = 255;
    }
    const opaqueImage = output || image;
    opaqueImageCache.set(image, opaqueImage);
    return opaqueImage;
  }
  const cached = blackTransparencyCache.get(image);
  if (cached) return cached;
  let output;
  for (let offset = 0; offset < image.length; offset += 4) {
    const isBlack565 = (image[offset] >>> 3) === 0
      && (image[offset + 1] >>> 3) === 0
      && (image[offset + 2] >>> 3) === 0;
    if (!isBlack565 || image[offset + 3] === 0) continue;
    output ||= new Uint8ClampedArray(image);
    output[offset + 3] = 0;
  }
  const transparentImage = output || image;
  blackTransparencyCache.set(image, transparentImage);
  return transparentImage;
}

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (~crc) >>> 0;
}

function decodePackedColor(packed, copyImage) {
  const red = ((packed >>> 11) & 0x1f) << 3;
  const green = ((packed >>> 6) & 0x1f) << 3;
  const blue = (packed & 0x1f) << 3;
  return [red, green, blue, copyImage || red + green + blue > 0 ? 255 : 0];
}

function decodeColor(bytes, offset, copyImage) {
  return decodePackedColor((bytes[offset] << 8) | bytes[offset + 1], copyImage);
}

function decodeCompressedImage(bytes, start, width, height) {
  assert(start + 4 <= bytes.length, 'Compressed image data is incomplete.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blockSize = readU32(view, start) + 4;
  assert(blockSize >= 4 + height * 4 && start + blockSize <= bytes.length, 'Compressed image data has invalid offsets.');

  const image = new Uint8ClampedArray(width * height * 4);
  const packedPixels = new Uint16Array(width * height);
  const tableStart = start + 4;
  for (let y = 0; y < height; y += 1) {
    const rowStart = tableStart + readU32(view, tableStart + y * 4);
    const rowEnd = y * width + width;
    let pixelIndex = y * width;
    let cursor = rowStart;
    while (pixelIndex < rowEnd) {
      assert(cursor + 2 <= start + blockSize, 'Compressed image row is truncated.');
      const colorCount = bytes[cursor];
      const repeatCount = bytes[cursor + 1];
      cursor += 2;
      assert(colorCount > 0 && repeatCount > 0, 'Compressed image contains an invalid run.');
      assert(cursor + colorCount * 2 <= start + blockSize, 'Compressed image color data is truncated.');
      for (let color = 0; color < colorCount; color += 1) {
        const rgba = decodeColor(bytes, cursor, true);
        const packed = (bytes[cursor] << 8) | bytes[cursor + 1];
        cursor += 2;
        for (let repeat = 0; repeat < repeatCount && pixelIndex < rowEnd; repeat += 1) {
          image.set(rgba, pixelIndex * 4);
          packedPixels[pixelIndex] = packed;
          pixelIndex += 1;
        }
      }
    }
  }
  return { image, packedPixels, blockSize };
}

function decodeItemImages(bytes, item, isCompressed) {
  const pixelCount = item.width * item.height;
  const imageCount = item.imgCount;
  assert(pixelCount > 0 && pixelCount * imageCount <= 16_000_000, `Item ${item.id} has an invalid image size.`);
  assert(imageCount > 0, `Item ${item.id} has no images.`);

  const images = [];
  const packedPixels = new Uint16Array(pixelCount * imageCount);
  let cursor = item.offset;
  if (isCompressed && (item.id >= 4 && item.id <= 42 || [47, 48, 71].includes(item.id))) {
    for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
      const decoded = decodeCompressedImage(bytes, cursor, item.width, item.height);
      images.push(decoded.image);
      packedPixels.set(decoded.packedPixels, imageIndex * pixelCount);
      cursor += decoded.blockSize;
    }
    return { images, packedPixels };
  }

  const requiredBytes = pixelCount * imageCount * 2;
  const truncatedBytes = Math.max(0, requiredBytes - Math.max(0, bytes.length - cursor));
  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    const image = new Uint8ClampedArray(pixelCount * 4);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const packed = cursor + 1 < bytes.length ? (bytes[cursor] << 8) | bytes[cursor + 1] : 0;
      image.set(decodePackedColor(packed, item.copyImage), pixel * 4);
      packedPixels[imageIndex * pixelCount + pixel] = packed;
      cursor += 2;
    }
    images.push(image);
  }
  return { images, packedPixels, truncatedBytes };
}

function isCompressedItem(id) {
  return (id >= 4 && id <= 42) || [47, 48, 71].includes(id);
}

function compressImageRow(pixels) {
  const output = [];
  let index = 0;
  while (index < pixels.length) {
    let runEnd = index + 1;
    while (runEnd < pixels.length && pixels[runEnd] === pixels[index] && runEnd - index < 255) runEnd += 1;
    if (runEnd - index >= 2) {
      output.push(1, runEnd - index, pixels[index] >>> 8, pixels[index] & 0xff);
      index = runEnd;
      continue;
    }

    const literalStart = index;
    index += 1;
    while (index < pixels.length && index - literalStart < 255) {
      let nextRunEnd = index + 1;
      while (nextRunEnd < pixels.length && pixels[nextRunEnd] === pixels[index] && nextRunEnd - index < 2) nextRunEnd += 1;
      if (nextRunEnd - index >= 2) break;
      index += 1;
    }
    const literalLength = index - literalStart;
    output.push(literalLength, 1);
    for (let pixel = literalStart; pixel < index; pixel += 1) {
      output.push(pixels[pixel] >>> 8, pixels[pixel] & 0xff);
    }
  }
  return Uint8Array.from(output);
}

function compressImage(pixels, width, height) {
  const rows = [];
  let compressedSize = 0;
  for (let y = 0; y < height; y += 1) {
    const row = compressImageRow(pixels.subarray(y * width, (y + 1) * width));
    rows.push(row);
    compressedSize += row.length;
  }

  const tableSize = height * 4;
  const block = new Uint8Array(4 + tableSize + compressedSize);
  const view = new DataView(block.buffer);
  view.setUint32(0, height * 4 + compressedSize, true);
  let rowOffset = tableSize;
  for (let y = 0; y < height; y += 1) {
    view.setUint32(4 + y * 4, rowOffset, true);
    block.set(rows[y], 4 + rowOffset);
    rowOffset += rows[y].length;
  }
  return block;
}

export function isClockFaceEditProject(project) {
  return Boolean(project && typeof project === 'object' && Object.values(project).some((item) => (
    item && typeof item === 'object'
    && Number.isInteger(item.Type)
    && Number.isInteger(item.ImageIndex)
    && Number.isInteger(item.ImagesCount)
  )));
}

export function clockFaceEditImageIndexes(project) {
  const indexes = new Set();
  let frameCount = 0;
  for (const item of Object.values(project || {})) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.Type)) continue;
    assert(Number.isInteger(item.ImageIndex) && item.ImageIndex >= 0 && item.ImageIndex <= 65535, 'ClockFaceEdit project has an invalid image index.');
    assert(Number.isInteger(item.ImagesCount) && item.ImagesCount > 0 && item.ImagesCount <= 255, `ClockFaceEdit item ${item.Type} has an invalid image count.`);
    frameCount += item.ImagesCount;
    assert(frameCount <= 512, 'ClockFaceEdit project references too many image frames.');
    for (let frame = 0; frame < item.ImagesCount; frame += 1) indexes.add(item.ImageIndex + frame);
  }
  assert(indexes.size > 0, 'This JSON does not contain any ClockFaceEdit watch-face items.');
  return [...indexes].sort((left, right) => left - right);
}

export function importClockFaceEditProject(project, imageAssets) {
  clockFaceEditImageIndexes(project);
  const seenIds = new Set();
  let totalPixels = 0;
  const layers = Object.entries(project).filter(([, item]) => item && typeof item === 'object' && Number.isInteger(item.Type)).map(([name, item]) => {
    const id = item.Type;
    assert(id > 0 && id <= 65535 && !seenIds.has(id), `ClockFaceEdit project has an invalid or duplicate item type ${id}.`);
    seenIds.add(id);
    assert(Number.isInteger(item.X) && item.X >= 0 && item.X <= 65535, `ClockFaceEdit item ${id} has an invalid X position.`);
    assert(Number.isInteger(item.Y) && item.Y >= 0 && item.Y <= 65535, `ClockFaceEdit item ${id} has an invalid Y position.`);

    const images = [];
    let width;
    let height;
    for (let frame = 0; frame < item.ImagesCount; frame += 1) {
      const imageIndex = item.ImageIndex + frame;
      const asset = imageAssets.get(imageIndex);
      assert(asset, `ClockFaceEdit image ${imageIndex}.png is missing.`);
      assert(Number.isInteger(asset.width) && Number.isInteger(asset.height) && asset.width > 0 && asset.height > 0, `ClockFaceEdit image ${imageIndex}.png has invalid dimensions.`);
      assert(asset.width <= 4096 && asset.height <= 4096, `ClockFaceEdit image ${imageIndex}.png is too large.`);
      assert(asset.pixels instanceof Uint8ClampedArray && asset.pixels.length === asset.width * asset.height * 4, `ClockFaceEdit image ${imageIndex}.png could not be decoded.`);
      if (width === undefined) {
        width = asset.width;
        height = asset.height;
      }
      assert(asset.width === width && asset.height === height, `ClockFaceEdit item ${id} uses images with inconsistent dimensions.`);
      images.push(asset.pixels);
    }

    totalPixels += width * height * images.length;
    assert(totalPixels <= 32_000_000, 'ClockFaceEdit project contains too many image pixels.');
    const info = item.ArrowInfo || {};
    const clockHandsInfo = [
      0,
      info.ArrowFullLength || 0,
      info.ArrowLengthToCenter || 0,
      info.ArrowWidth || 0,
    ];
    assert(clockHandsInfo.every((value) => Number.isInteger(value) && value >= 0 && value <= 255), `ClockFaceEdit item ${id} has invalid hand metadata.`);
    const copyImage = id === 17 ? true : item.BlackIsTransparent === false;
    const clockFaceProperties = structuredClone(item);
    if (id === 17) clockFaceProperties.BlackIsTransparent = false;
    return {
      id,
      name,
      width,
      height,
      imgCount: images.length,
      x: item.X,
      y: item.Y,
      copyImage,
      blackIsTransparent: id === 17 ? false : !copyImage,
      clockHandsInfo,
      animationSpeed: Number.isFinite(item.AnimationSpeed) ? item.AnimationSpeed : 0,
      clockFaceProperties,
      images,
      packedPixels: rgbaToPackedPixels(images, width, height, copyImage),
      modified: true,
      visible: true,
      locked: false,
    };
  });

  const displayImage = layers.find((item) => item.id === 17) || layers.find((item) => item.id === 10);
  assert(displayImage, 'ClockFaceEdit project must contain a background or preview image to determine watch dimensions.');
  const { width, height } = displayImage;
  const bytes = new Uint8Array(HEADER_SIZE + 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4e49422e, true);
  view.setUint32(4, 2, true);
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  const checksum = crc32(bytes.subarray(HEADER_SIZE));
  view.setUint32(8, checksum, true);
  const document = parseWatchface(bytes);
  return { document, layers, width, height };
}

export function parseWatchface(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  assert(bytes.length >= HEADER_SIZE, 'This file is too small to be a watch-face BIN.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = readU32(view, 4);
  const expectedCrc = readU32(view, 8);
  const width = readU16(view, 12);
  const height = readU16(view, 14);
  const compressed = (readU32(view, 16) & 0xffffff00) === COMPRESS_FORMAT;
  assert(width > 0 && height > 0 && width <= 4096 && height <= 4096, 'The BIN has invalid watch-face dimensions.');
  assert(dataSize <= bytes.length - HEADER_SIZE, 'The BIN header declares data beyond the end of the file.');
  const bodyEnd = HEADER_SIZE + dataSize;

  const items = [];
  const itemIds = new Set();
  let totalPixels = 0;
  let tableOffset = HEADER_SIZE;
  let foundTerminator = false;
  while (tableOffset + 2 <= bodyEnd && items.length < 512) {
    const id = readU16(view, tableOffset);
    if (id === 0) {
      foundTerminator = true;
      break;
    }
    assert(!itemIds.has(id), `The BIN contains duplicate item ${id} entries.`);
    itemIds.add(id);
    assert(tableOffset + ITEM_SIZE <= bodyEnd, 'The BIN item table is incomplete or missing its terminator.');
    const item = {
      id,
      name: ITEM_NAMES[id] || `Item ${id}`,
      width: readU16(view, tableOffset + 2),
      offset: readU32(view, tableOffset + 4),
      height: readU16(view, tableOffset + 8),
      x: readU16(view, tableOffset + 10),
      y: readU16(view, tableOffset + 12),
      imgCount: bytes[tableOffset + 16],
      copyImage: bytes[tableOffset + 17] !== 0,
      clockHandsInfo: [...bytes.subarray(tableOffset + 20, tableOffset + 24)],
      tableOffset,
      visible: true,
      locked: false,
    };
    assert(item.width > 0 && item.height > 0, `Item ${id} has invalid dimensions.`);
    totalPixels += item.width * item.height * item.imgCount;
    assert(totalPixels <= 32_000_000, 'The BIN contains too many image pixels to open safely.');
    items.push(item);
    tableOffset += ITEM_SIZE;
  }
  assert(foundTerminator, 'The BIN item table is incomplete or missing its terminator.');

  const imageDataStart = tableOffset + 2;
  const bodyBytes = bytes.subarray(0, bodyEnd);
  items.forEach((item) => {
    assert(item.offset >= imageDataStart && item.offset < bodyEnd, `Image data for ${item.name} points outside the BIN image area.`);
    const decoded = decodeItemImages(bodyBytes, item, compressed);
    item.images = decoded.images;
    item.packedPixels = decoded.packedPixels;
    item.truncatedBytes = decoded.truncatedBytes || 0;
  });

  const actualCrc = crc32(bytes.subarray(HEADER_SIZE, HEADER_SIZE + dataSize));
  return {
    width,
    height,
    items,
    bytes: bytes.slice(),
    compressed,
    truncatedItems: items.filter((item) => item.truncatedBytes > 0).map(({ id, name, truncatedBytes }) => ({ id, name, truncatedBytes })),
    checksumValid: actualCrc === expectedCrc,
    checksum: expectedCrc,
    tableEnd: tableOffset,
  };
}

export function writeWatchface(document, layers) {
  assert(document?.bytes instanceof Uint8Array, 'Open a watch-face BIN before exporting a BIN file.');
  const exportLayers = layers.map((layer) => (
    layer.blackIsTransparent == null
      ? layer
      : { ...layer, copyImage: !layer.blackIsTransparent }
  ));
  assert(new Set(exportLayers.map((layer) => layer.id)).size === exportLayers.length, 'BIN files cannot contain duplicate element types. Remove imported duplicates before exporting.');
  for (const layer of exportLayers) {
    assert(Number.isInteger(layer.x) && layer.x >= 0 && layer.x <= 65535, `${layer.name} X position must be between 0 and 65535.`);
    assert(Number.isInteger(layer.y) && layer.y >= 0 && layer.y <= 65535, `${layer.name} Y position must be between 0 and 65535.`);
    assert(Number.isInteger(layer.width) && layer.width > 0 && layer.width <= 4096, `${layer.name} width must be between 1 and 4096.`);
    assert(Number.isInteger(layer.height) && layer.height > 0 && layer.height <= 4096, `${layer.name} height must be between 1 and 4096.`);
    assert(Number.isInteger(layer.imgCount) && layer.imgCount > 0 && layer.imgCount <= 255, `${layer.name} must have between 1 and 255 image frames.`);
    assert(layer.width * layer.height * layer.imgCount <= 16_000_000, `${layer.name} has too many image pixels to export safely.`);
  }

  const sourceItems = new Map(document.items.map((item) => [item.id, item]));
  const unchangedItemSet = exportLayers.length === document.items.length && exportLayers.every((layer) => {
    const source = sourceItems.get(layer.id);
    return source
      && !layer.modified
      && layer.width === source.width
      && layer.height === source.height
      && layer.imgCount === source.imgCount
      && layer.copyImage === source.copyImage
      && layer.clockHandsInfo?.every((value, index) => value === source.clockHandsInfo[index])
      && !source.truncatedBytes;
  });
  if (unchangedItemSet) {
    const bytes = document.bytes.slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    exportLayers.forEach((layer) => {
      const item = sourceItems.get(layer.id);
      view.setUint16(item.tableOffset + 10, layer.x, true);
      view.setUint16(item.tableOffset + 12, layer.y, true);
    });
    const dataSize = readU32(view, 4);
    view.setUint32(8, crc32(bytes.subarray(HEADER_SIZE, HEADER_SIZE + dataSize)), true);
    return bytes;
  }

  const orderedLayers = [...exportLayers].sort((left, right) => left.id - right.id);
  const tableSize = orderedLayers.length * ITEM_SIZE + 2;
  const dataStart = HEADER_SIZE + tableSize;
  const payloads = orderedLayers.map((layer) => {
    const pixelCount = layer.width * layer.height * layer.imgCount;
    const packedPixels = layer.packedPixels;
    if (!(packedPixels instanceof Uint16Array) || packedPixels.length !== pixelCount) {
      throw new Error(`Image data for ${layer.name} does not match its dimensions.`);
    }
    if (document.compressed && isCompressedItem(layer.id)) {
      const imageSize = layer.width * layer.height;
      const frames = [];
      let payloadSize = 0;
      for (let image = 0; image < layer.imgCount; image += 1) {
        const frameOffset = image * imageSize;
        const frame = compressImage(
          packedPixels.subarray(frameOffset, frameOffset + imageSize),
          layer.width,
          layer.height,
        );
        frames.push(frame);
        payloadSize += frame.length;
      }
      const payload = new Uint8Array(payloadSize);
      let payloadOffset = 0;
      for (const frame of frames) {
        payload.set(frame, payloadOffset);
        payloadOffset += frame.length;
      }
      return payload;
    }

    const payload = new Uint8Array(pixelCount * 2);
    packedPixels.forEach((packed, pixel) => {
      payload[pixel * 2] = packed >>> 8;
      payload[pixel * 2 + 1] = packed & 0xff;
    });
    return payload;
  });
  const payloadSize = payloads.reduce((total, payload) => total + payload.length, 0);
  const bytes = new Uint8Array(dataStart + payloadSize);
  bytes.set(document.bytes.subarray(0, HEADER_SIZE));
  const view = new DataView(bytes.buffer);
  if (document.compressed) {
    view.setUint32(16, COMPRESS_FORMAT, true);
    view.setUint32(20, 0xffffff15, true);
  } else {
    view.setUint32(16, 0, true);
    view.setUint32(20, 0, true);
  }
  let dataOffset = dataStart;

  orderedLayers.forEach((layer, index) => {
    const original = sourceItems.get(layer.id);
    const recordOffset = HEADER_SIZE + index * ITEM_SIZE;
    if (original) bytes.set(document.bytes.subarray(original.tableOffset, original.tableOffset + ITEM_SIZE), recordOffset);
    view.setUint16(recordOffset, layer.id, true);
    view.setUint16(recordOffset + 2, layer.width, true);
    view.setUint32(recordOffset + 4, dataOffset, true);
    view.setUint16(recordOffset + 8, layer.height, true);
    view.setUint16(recordOffset + 10, layer.x, true);
    view.setUint16(recordOffset + 12, layer.y, true);
    bytes[recordOffset + 16] = layer.imgCount;
    bytes[recordOffset + 17] = layer.copyImage ? 1 : 0;
    if (layer.clockHandsInfo) bytes.set(layer.clockHandsInfo, recordOffset + 20);

    bytes.set(payloads[index], dataOffset);
    dataOffset += payloads[index].length;
  });

  view.setUint32(4, bytes.length - HEADER_SIZE, true);
  view.setUint32(8, crc32(bytes.subarray(HEADER_SIZE)), true);
  return bytes;
}

export function createProjectFile({ title, width, height, shape, sourceBytes, sourceFormat, layers }) {
  return {
    format: 'wfeditormk66-project',
    version: 1,
    title,
    width,
    height,
    shape,
    sourceBin: sourceBytes ? bytesToBase64(sourceBytes) : null,
    ...(sourceFormat ? { sourceFormat } : {}),
    layers: layers.map((layer) => ({
      ...(layer.uid ? { uid: layer.uid } : {}),
      id: layer.id,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      visible: layer.visible,
      locked: layer.locked,
      type: layer.type,
      text: layer.text,
      imgCount: layer.imgCount,
      copyImage: layer.copyImage,
      blackIsTransparent: layer.blackIsTransparent,
      clockHandsInfo: layer.clockHandsInfo,
      animationSpeed: layer.animationSpeed,
      clockFaceProperties: layer.clockFaceProperties,
      modified: layer.modified,
      images: layer.images && (layer.modified || typeof layer.id === 'string') ? layer.images.map(bytesToBase64) : undefined,
    })),
  };
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function rgbaToPackedPixels(images, width, height, copyImage = false) {
  const packed = new Uint16Array(width * height * images.length);
  images.forEach((image, imageIndex) => {
    if (image.length !== width * height * 4) throw new Error('Imported image dimensions do not match the watch-face frame.');
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const alpha = image[offset + 3];
      const red = !copyImage && alpha < 128 ? 0 : image[offset];
      const green = !copyImage && alpha < 128 ? 0 : image[offset + 1];
      const blue = !copyImage && alpha < 128 ? 0 : image[offset + 2];
      packed[imageIndex * width * height + pixel] = ((red >>> 3) << 11) | ((green >>> 3) << 6) | (blue >>> 3);
    }
  });
  return packed;
}

export function makeDemoProject() {
  return {
    title: 'Aurora No. 04',
    width: 240,
    height: 280,
    shape: 'rounded',
    layers: [
      { id: 'demo-background', name: 'Night dial', type: 'background', x: 0, y: 0, width: 240, height: 280, visible: true, locked: true },
      { id: 'demo-mark', name: 'Model mark', type: 'mark', x: 22, y: 28, width: 196, height: 24, visible: true, locked: false },
      { id: 'demo-time', name: 'Digital time', type: 'time', x: 20, y: 84, width: 200, height: 58, visible: true, locked: false },
      { id: 'demo-date', name: 'Date window', type: 'date', x: 22, y: 151, width: 196, height: 24, visible: true, locked: false },
      { id: 'demo-activity', name: 'Activity rings', type: 'activity', x: 28, y: 204, width: 184, height: 40, visible: true, locked: false },
    ],
  };
}

export function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}
