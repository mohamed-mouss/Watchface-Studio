import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  base64ToBytes,
  applyBlackTransparency,
  clockFaceEditImageIndexes,
  createProjectFile,
  formatFileSize,
  getWatchfaceCharacterImageIndex,
  getWatchfaceHandTransform,
  getWatchfaceItemBounds,
  getWatchfaceItemImageIndex,
  getWatchfaceItemText,
  importClockFaceEditProject,
  ITEM_CATALOG,
  isClockFaceEditProject,
  makeDemoProject,
  parseWatchface,
  rgbaToPackedPixels,
  writeWatchface,
} from './watchface.mjs';
import { dafitFrameIndex, isDafitTypeC, packDafitImages, parseDafitTypeC, writeDafitTypeC } from './dafit.mjs';
import { DEVICE_PROFILES, matchDeviceProfile } from './deviceProfiles.mjs';
import defaultWatchfaceUrl from '../Default/Default screen.bin?inline';
import './app.css';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const WATCH_PICKER_PREVIEW_ITEM_ID = 10;

function centerImageFrame(image, sourceWidth, sourceHeight, width, height) {
  const frame = new Uint8ClampedArray(width * height * 4);
  const offsetX = Math.floor((width - sourceWidth) / 2);
  const offsetY = Math.floor((height - sourceHeight) / 2);
  for (let row = 0; row < sourceHeight; row += 1) {
    const sourceOffset = row * sourceWidth * 4;
    const targetOffset = ((row + offsetY) * width + offsetX) * 4;
    frame.set(image.subarray(sourceOffset, sourceOffset + sourceWidth * 4), targetOffset);
  }
  return frame;
}

const icons = {
  brand: <><path d="M12 2.8 21 8v8l-9 5.2L3 16V8l9-5.2Z" /><path d="M12 7v10M7.7 9.5l8.6 5M16.3 9.5l-8.6 5" /></>,
  open: <><path d="M3.5 7.5h6l2 2h9v8.8a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V7.5Z" /><path d="M3.8 10h16.4" /></>,
  save: <><path d="M5 3.5h12l3.5 3.6v13.4H3.5v-17H5Z" /><path d="M7 3.8v5h9v-5M7 20v-7h10v7" /></>,
  export: <><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" /><path d="M4 13v6.5h16V13" /></>,
  undo: <><path d="M9 8 4.5 12 9 16" /><path d="M5 12h8a6 6 0 0 1 6 6" /></>,
  redo: <><path d="m15 8 4.5 4-4.5 4" /><path d="M19 12h-8a6 6 0 0 0-6 6" /></>,
  grid: <><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  eye: <><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  eyeOff: <><path d="m3 3 18 18M10.6 6.2a9.8 9.8 0 0 1 1.4-.1c6.2 0 9.5 5.9 9.5 5.9a15 15 0 0 1-3.1 3.7M6.2 6.3C3.8 7.7 2.5 12 2.5 12s3.3 6 9.5 6c.9 0 1.7-.1 2.5-.4" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>,
  delete: <><path d="M4 7h16M9 7V4h6v3M7 7l.8 13h8.4L17 7M10 11v5M14 11v5" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  watch: <><rect x="7" y="6" width="10" height="12" rx="4" /><path d="m9 6-.8-3h7.6L15 6M9 18l-.8 3h7.6l-.8-3M12 9v3l2 1" /></>,
  crosshair: <><circle cx="12" cy="12" r="7.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  alert: <><path d="m12 3 9 16H3l9-16Z" /><path d="M12 9v4M12 16h.01" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

function Icon({ name, size = 16, className = '' }) {
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
}

function watchfaceName(layer) {
  return layer.name || `Item ${layer.id}`;
}

function layerKey(layer) {
  return layer.uid ?? layer.id;
}

function getLayerBounds(layer, face, date) {
  if (layer.type === 'dafit') {
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height * (layer.id === 0 ? 10 : 1) };
  }
  return getWatchfaceItemBounds(layer, face, date);
}

function nextAvailableItemType(layers) {
  return ITEM_CATALOG.find((item) => !layers.some((layer) => layer.id === item.id))?.id ?? ITEM_CATALOG[0]?.id ?? 1;
}

function isFixedStackItem(layer) {
  return layer.type !== 'dafit' && (layer.id === 17 || (layer.id >= 1 && layer.id <= 3));
}

function pointOnCanvas(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function hitTest(layers, point, face, date) {
  return [...layers]
    .sort((left, right) => {
      const zIndex = (layer) => layer.type !== 'dafit' && layer.id === 17 ? -1 : layer.type !== 'dafit' && layer.id >= 1 && layer.id <= 3 ? 1000 + layer.id : layers.indexOf(layer);
      return zIndex(left) - zIndex(right);
    })
    .reverse()
    .find((layer) => {
      if (layer.visible === false || (layer.type !== 'dafit' && layer.id === WATCH_PICKER_PREVIEW_ITEM_ID)) return false;
      const bounds = getLayerBounds(layer, face, date);
      return point.x >= bounds.x
        && point.x <= bounds.x + bounds.width
        && point.y >= bounds.y
        && point.y <= bounds.y + bounds.height;
    });
}

function getLayerPositionLimits(layer, face, date) {
  if (layer.type !== 'dafit' && layer.id >= 1 && layer.id <= 3) {
    return { minX: 0, maxX: face.width, minY: 0, maxY: face.height };
  }
  const bounds = getLayerBounds(layer, face, date);
  const offsetX = bounds.x - layer.x;
  const offsetY = bounds.y - layer.y;
  return {
    minX: Math.ceil(Math.max(0, -offsetX)),
    maxX: Math.floor(Math.max(0, face.width - offsetX - bounds.width)),
    minY: Math.ceil(Math.max(0, -offsetY)),
    maxY: Math.floor(Math.max(0, face.height - offsetY - bounds.height)),
  };
}

function getSmartSnappedPosition(layer, currentLayers, proposed, face, date) {
  const position = { ...proposed };
  const positionedLayer = { ...layer, ...position };
  const movingBounds = getLayerBounds(positionedLayer, face, date);
  const targets = [
    { x: 0, y: 0, width: face.width, height: face.height },
    ...currentLayers
      .filter((candidate) => layerKey(candidate) !== layerKey(layer) && candidate.visible !== false)
      .map((candidate) => getLayerBounds(candidate, face, date)),
  ];
  const guideMatches = (start, size, targetStart, targetSize) => {
    const movingPoints = [start, start + size / 2, start + size];
    const targetPoints = [targetStart, targetStart + targetSize / 2, targetStart + targetSize];
    return movingPoints.flatMap((movingPoint) => targetPoints.map((targetPoint) => ({
      adjustment: targetPoint - movingPoint,
      coordinate: targetPoint,
    }))).filter((match) => Math.abs(match.adjustment) <= 6)
      .sort((left, right) => Math.abs(left.adjustment) - Math.abs(right.adjustment))[0];
  };
  const vertical = targets.map((target) => guideMatches(movingBounds.x, movingBounds.width, target.x, target.width))
    .filter(Boolean).sort((left, right) => Math.abs(left.adjustment) - Math.abs(right.adjustment))[0];
  const horizontal = targets.map((target) => guideMatches(movingBounds.y, movingBounds.height, target.y, target.height))
    .filter(Boolean).sort((left, right) => Math.abs(left.adjustment) - Math.abs(right.adjustment))[0];
  if (vertical) position.x += vertical.adjustment;
  if (horizontal) position.y += horizontal.adjustment;
  const limits = getLayerPositionLimits(layer, face, date);
  position.x = clamp(Math.round(position.x), limits.minX, limits.maxX);
  position.y = clamp(Math.round(position.y), limits.minY, limits.maxY);
  const finalBounds = getLayerBounds({ ...layer, ...position }, face, date);
  const isAligned = (start, size, coordinate) => (
    Math.abs(start - coordinate) < 0.01
    || Math.abs(start + size / 2 - coordinate) < 0.01
    || Math.abs(start + size - coordinate) < 0.01
  );
  return {
    position,
    guides: {
      vertical: vertical && isAligned(finalBounds.x, finalBounds.width, vertical.coordinate) ? [vertical.coordinate] : [],
      horizontal: horizontal && isAligned(finalBounds.y, finalBounds.height, horizontal.coordinate) ? [horizontal.coordinate] : [],
    },
  };
}

function paintDemoLayer(context, layer) {
  const { x, y, width, height } = layer;
  if (layer.images?.length) {
    paintBitmap(context, layer, 0);
    return;
  }
  context.save();
  if (layer.type === 'background') {
    const gradient = context.createLinearGradient(0, 0, 240, 280);
    gradient.addColorStop(0, '#132c30');
    gradient.addColorStop(0.58, '#101b20');
    gradient.addColorStop(1, '#0d1318');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 240, 280);
    context.strokeStyle = 'rgba(161, 192, 172, .12)';
    context.lineWidth = 1;
    for (let ring = 0; ring < 5; ring += 1) {
      context.beginPath();
      context.arc(120, 140, 46 + ring * 17, -2.3, 1.4);
      context.stroke();
    }
    context.restore();
    return;
  }
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  if (layer.type === 'mark') {
    context.fillStyle = '#9eaf9e';
    context.font = '600 8px system-ui, sans-serif';
    context.letterSpacing = '2px';
    context.fillText('N O R T H   /   0 4', x + 3, y + 12);
    context.strokeStyle = 'rgba(198, 178, 125, .76)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + 3, y + 20);
    context.lineTo(x + width - 3, y + 20);
    context.stroke();
  } else if (layer.type === 'time') {
    context.fillStyle = '#eef0e8';
    context.font = '300 47px system-ui, sans-serif';
    context.letterSpacing = '-2px';
    context.fillText('10:08', x + 1, y + 49);
  } else if (layer.type === 'date') {
    context.fillStyle = '#c3c9bc';
    context.font = '500 10px system-ui, sans-serif';
    context.fillText('MONDAY, OCTOBER 24', x + 3, y + 14);
  } else if (layer.type === 'activity') {
    const rings = [
      { cx: x + 14, color: '#d4b575', label: 'MOVE', value: '428' },
      { cx: x + 80, color: '#81ab9a', label: 'STEPS', value: '6,248' },
      { cx: x + 146, color: '#758eaa', label: 'SLEEP', value: '7.8h' },
    ];
    rings.forEach((ring) => {
      context.beginPath();
      context.arc(ring.cx + 9, y + 15, 8, 0, Math.PI * 2);
      context.strokeStyle = `${ring.color}66`;
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.arc(ring.cx + 9, y + 15, 8, -Math.PI / 2, Math.PI * 0.82);
      context.strokeStyle = ring.color;
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = '#dce0d8';
      context.font = '600 8px system-ui, sans-serif';
      context.fillText(ring.label, ring.cx + 22, y + 13);
      context.fillStyle = '#899792';
      context.font = '9px ui-monospace, monospace';
      context.fillText(ring.value, ring.cx + 22, y + 26);
    });
  } else if (layer.type === 'label') {
    context.fillStyle = '#e5e8dd';
    context.font = '500 11px system-ui, sans-serif';
    context.fillText(layer.text || 'NEW LABEL', x + 2, y + 14);
  } else if (layer.type === 'image') {
    context.strokeStyle = 'rgba(206, 183, 128, .72)';
    context.setLineDash([3, 3]);
    context.strokeRect(x + 1, y + 1, width - 2, height - 2);
    context.fillStyle = '#cbb783';
    context.font = '9px system-ui, sans-serif';
    context.fillText('IMAGE ASSET', x + 4, y + 13);
  } else if (layer.type === 'icon') {
    context.fillStyle = '#d5b777';
    context.font = '22px system-ui, sans-serif';
    context.fillText('☼', x + 2, y + Math.min(height - 2, 23));
  }
  context.restore();
}

function drawFace(canvas, face, layers, selectedId, showGuides, preview, date, smartGuides) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const { width, height } = face;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0c1418';
  context.fillRect(0, 0, width, height);

  if (face.mode === 'demo') {
    layers.filter((layer) => layer.visible !== false).forEach((layer) => paintDemoLayer(context, layer));
  } else if (face.bin?.format === 'dafit-c') {
    layers.filter((layer) => layer.visible !== false && layer.images?.length).forEach((layer) => {
      if (layer.id === 0) {
        for (let frame = 0; frame < layer.imgCount; frame += 1) {
          paintBitmap(context, layer, frame, layer.x, layer.y + frame * layer.height);
        }
      } else {
        paintBitmap(context, layer, dafitFrameIndex(layer, date));
      }
    });
  } else {
    const background = layers.find((layer) => layer.id === 17 && layer.visible !== false);
    if (background) paintBitmap(context, background, 0);
    layers.forEach((layer) => {
      if (layer.visible === false || layer.id === 17 || layer.id === WATCH_PICKER_PREVIEW_ITEM_ID || (layer.id >= 1 && layer.id <= 3) || !layer.images?.length) return;
      const text = getWatchfaceItemText(layer.id, date);
      if (text) {
        const bounds = getWatchfaceItemBounds(layer, face, date);
        [...text].forEach((character, index) => {
          const imageIndex = getWatchfaceCharacterImageIndex(character);
          if (imageIndex < layer.images.length) paintBitmap(context, layer, imageIndex, bounds.x + index * layer.width, layer.y);
        });
      } else {
        const imageIndex = getWatchfaceItemImageIndex(layer, date);
        if (imageIndex >= 0) paintBitmap(context, layer, imageIndex);
      }
    });
    layers.filter((layer) => layer.visible !== false && layer.id >= 1 && layer.id <= 3 && layer.images?.length)
      .sort((left, right) => left.id - right.id)
      .forEach((layer) => {
        const transform = getWatchfaceHandTransform(layer, face, date);
        context.save();
        context.translate(transform.pivotX, transform.pivotY);
        context.rotate(transform.angle * Math.PI / 180);
        paintBitmap(context, layer, 0, transform.offsetX, transform.offsetY);
        context.restore();
      });
  }

  if (showGuides && !preview) {
    context.save();
    context.strokeStyle = 'rgba(194, 185, 152, .18)';
    context.lineWidth = 0.6;
    context.setLineDash([2, 4]);
    for (let x = 8; x < width; x += 8) {
      context.globalAlpha = x % 40 === 0 ? 0.44 : 0.22;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 8; y < height; y += 8) {
      context.globalAlpha = y % 40 === 0 ? 0.44 : 0.22;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.restore();
  }

  if (!preview && smartGuides) {
    context.save();
    context.strokeStyle = '#ff4fa3';
    context.lineWidth = Math.max(1, width / 360);
    context.setLineDash([]);
    smartGuides.vertical.forEach((x) => {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    });
    smartGuides.horizontal.forEach((y) => {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    });
    context.restore();
  }

  if (!preview) {
    const selected = layers.find((layer) => layerKey(layer) === selectedId && layer.visible !== false);
    if (selected) {
      context.save();
      context.strokeStyle = '#a7c8b7';
      context.lineWidth = Math.max(1, width / 260);
      context.setLineDash([3, 2]);
      const bounds = getLayerBounds(selected, face, date);
      context.strokeRect(bounds.x + 0.5, bounds.y + 0.5, Math.max(1, bounds.width - 1), Math.max(1, bounds.height - 1));
      context.setLineDash([]);
      context.fillStyle = '#d3e0d4';
      const handleSize = Math.max(2.5, width / 85);
      [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]
        .forEach(([x, y]) => context.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize));
      context.restore();
    }
  }
}

function paintBitmap(context, layer, imageIndex, x = layer.x, y = layer.y) {
  const image = layer.images?.[imageIndex];
  if (!image) return;
  const blackIsTransparent = layer.blackIsTransparent ?? !layer.copyImage;
  const bitmap = new ImageData(applyBlackTransparency(image, !blackIsTransparent), layer.width, layer.height);
  const offscreen = document.createElement('canvas');
  offscreen.width = layer.width;
  offscreen.height = layer.height;
  offscreen.getContext('2d').putImageData(bitmap, 0, 0);
  context.drawImage(offscreen, x, y);
}

function initialLayers() {
  return makeDemoProject().layers;
}

function initialFileState() {
  const sample = makeDemoProject();
  return { title: sample.title, width: sample.width, height: sample.height, shape: sample.shape, mode: 'demo', bin: null };
}

function defaultFaceShape(width, height) {
  return width === height ? 'circle' : 'rounded';
}

async function decodeProjectPng(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not read a ClockFaceEdit PNG image.');
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close();
  }
}

function fromBinary(parsed, fileName) {
  const layers = parsed.items.map((item) => ({
    ...item,
    blackIsTransparent: item.id === 17 ? false : !item.copyImage,
    width: item.width,
    height: item.height,
    name: item.name,
  }));
  return {
    file: {
      title: fileName.replace(/\.[^.]+$/, ''),
      width: parsed.width,
      height: parsed.height,
      shape: defaultFaceShape(parsed.width, parsed.height),
      mode: 'bin',
      bin: parsed,
    },
    layers,
  };
}

function fromDafitBinary(parsed, fileName) {
  return {
    file: {
      title: fileName.replace(/\.[^.]+$/, ''),
      width: parsed.width,
      height: parsed.height,
      shape: 'circle',
      mode: 'bin',
      bin: parsed,
    },
    layers: parsed.layers,
  };
}

function applyProject(project) {
  if (!project || project.format !== 'wfeditormk66-project' || project.version !== 1 || !Array.isArray(project.layers)) {
    throw new Error('This JSON is not a Watchface Studio project. Expected format "wfeditormk66-project", version 1, and a layers array.');
  }
  if (project.sourceBin && project.sourceFormat === 'dafit-c') {
    const parsed = parseDafitTypeC(base64ToBytes(project.sourceBin));
    const parsedLayers = new Map(parsed.layers.map((layer) => [layer.uid, layer]));
    const layers = project.layers.map((saved, index) => {
      const item = saved.uid ? parsedLayers.get(saved.uid) : parsed.layers.find((layer) => layer.id === saved.id);
      const images = Array.isArray(saved.images)
        ? saved.images.map((image) => new Uint8ClampedArray(base64ToBytes(image)))
        : item?.images;
      const width = Number(saved.width) || item?.width;
      const height = Number(saved.height) || item?.height;
      const imgCount = Number.isInteger(saved.imgCount) ? saved.imgCount : item?.imgCount;
      if (!images || !width || !height || !Number.isInteger(imgCount) || imgCount !== images.length) {
        throw new Error(`Da Fit element ${saved.id} is missing its image data.`);
      }
      return {
        ...(item || {}),
        ...saved,
        uid: saved.uid || item?.uid || `dafit-project-${index}`,
        type: 'dafit',
        width,
        height,
        imgCount,
        images,
        packedPixels: packDafitImages(images, width, height),
        sourceRecordIndex: item?.sourceRecordIndex,
        blobIndex: item?.blobIndex,
        sourceBlobCompression: item?.sourceBlobCompression,
        copyImage: true,
        blackIsTransparent: false,
        modified: Boolean(saved.modified),
      };
    });
    return {
      file: {
        title: project.title || 'Imported Da Fit watch face',
        width: parsed.width,
        height: parsed.height,
        shape: project.shape === 'rounded' ? 'rounded' : 'circle',
        mode: 'bin',
        bin: parsed,
      },
      layers,
    };
  }
  if (project.sourceBin) {
    const parsed = parseWatchface(base64ToBytes(project.sourceBin));
    const parsedItems = new Map(parsed.items.map((item) => [item.id, item]));
    const layers = project.layers.filter((saved) => parsedItems.has(saved.id)).map((saved) => {
      const item = parsedItems.get(saved.id);
      const images = Array.isArray(saved?.images) ? saved.images.map((image) => new Uint8ClampedArray(base64ToBytes(image))) : item.images;
      const imgCount = Number.isInteger(saved?.imgCount) ? saved.imgCount : item.imgCount;
      const width = Number(saved?.width) || item.width;
      const height = Number(saved?.height) || item.height;
      const copyImage = saved?.copyImage ?? item.copyImage;
      const blackIsTransparent = saved?.blackIsTransparent ?? (item.id === 17 && !saved?.modified ? false : !copyImage);
      const sourceCopyImage = saved?.blackIsTransparent == null && item.id === 17 && !saved?.modified
        ? item.copyImage
        : copyImage;
      return {
        ...item,
        uid: saved?.uid,
        clockHandsInfo: saved?.clockHandsInfo || item.clockHandsInfo,
        animationSpeed: Number.isFinite(saved?.animationSpeed) ? saved.animationSpeed : item.animationSpeed,
        clockFaceProperties: saved?.clockFaceProperties || item.clockFaceProperties,
        name: saved?.name || item.name,
        x: Number.isInteger(saved?.x) ? saved.x : item.x,
        y: Number.isInteger(saved?.y) ? saved.y : item.y,
        visible: saved?.visible !== false,
        locked: Boolean(saved?.locked),
        width,
        height,
        imgCount,
        copyImage: sourceCopyImage,
        blackIsTransparent,
        images,
        packedPixels: saved?.modified ? rgbaToPackedPixels(images, width, height, copyImage) : item.packedPixels,
        modified: Boolean(saved?.modified),
      };
    });
    const parsedIds = new Set(parsed.items.map((item) => item.id));
    const addedLayers = project.layers.filter((layer) => !parsedIds.has(layer.id)).map((saved) => {
      const catalog = ITEM_CATALOG.find((entry) => entry.id === saved.id);
      const width = Number(saved.width);
      const height = Number(saved.height);
      const imgCount = Number(saved.imgCount);
      const images = saved.images?.map((image) => new Uint8ClampedArray(base64ToBytes(image)));
      if (!Number.isInteger(saved.id) || !Array.isArray(images) || !width || !height || !Number.isInteger(imgCount) || imgCount !== images.length) {
        throw new Error(`Added item ${saved.id} is missing its image data.`);
      }
      const getPosition = (value, faceSize, itemSize) => {
        const position = Number(value);
        if (!Number.isFinite(position)) return clamp(Math.round((faceSize - itemSize) / 2), 0, 65535);
        return clamp(Math.round(position), 0, 65535);
      };
      return {
        ...saved,
        uid: saved.uid,
        id: saved.id,
        x: getPosition(saved.x, parsed.width, width),
        y: getPosition(saved.y, parsed.height, height),
        name: saved.name || catalog?.name || `Item ${saved.id}`,
        width,
        height,
        imgCount,
        blackIsTransparent: saved.blackIsTransparent ?? (saved.id === 17 ? false : !saved.copyImage),
        images,
        packedPixels: rgbaToPackedPixels(images, width, height, Boolean(saved.copyImage)),
        modified: true,
      };
    });
    const allLayersById = new Map([...layers, ...addedLayers].map((layer) => [layer.id, layer]));
    return {
      file: {
        title: project.title || 'Imported watch face',
        width: parsed.width,
        height: parsed.height,
        shape: project.shape === 'circle' || project.shape === 'rounded' ? project.shape : defaultFaceShape(parsed.width, parsed.height),
        mode: 'bin',
        bin: parsed,
      },
      layers: project.layers.map((saved) => allLayersById.get(saved.id)).filter(Boolean),
    };
  }
  const width = clamp(Number(project.width) || 240, 32, 4096);
  const height = clamp(Number(project.height) || 280, 32, 4096);
  return {
    file: {
      title: project.title || 'Untitled project',
      width,
      height,
      shape: project.shape === 'circle' || project.shape === 'rounded' ? project.shape : defaultFaceShape(width, height),
      mode: 'demo',
      bin: null,
    },
    layers: project.layers.map((layer) => ({
      ...layer,
      x: Number(layer.x) || 0,
      y: Number(layer.y) || 0,
      width: Number(layer.width) || 60,
      height: Number(layer.height) || 20,
      visible: layer.visible !== false,
      locked: Boolean(layer.locked),
      blackIsTransparent: layer.blackIsTransparent ?? (layer.id === 17 ? false : !layer.copyImage),
      images: layer.images?.map((image) => new Uint8ClampedArray(base64ToBytes(image))),
    })),
  };
}

async function loadWatchfacePayload({ name, bytes, assets }) {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'wfproj' || extension === 'json') {
    let project;
    try {
      project = JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`Could not read project JSON: ${error.message}`);
    }
    if (isClockFaceEditProject(project)) {
      const imageAssets = new Map();
      for (const imageIndex of clockFaceEditImageIndexes(project)) {
        const imageBytes = assets?.[imageIndex];
        if (!imageBytes) throw new Error(`ClockFaceEdit image ${imageIndex}.png is missing. Select the JSON and its numbered PNGs together.`);
        imageAssets.set(imageIndex, await decodeProjectPng(new Uint8Array(imageBytes)));
      }
      const imported = importClockFaceEditProject(project, imageAssets);
      const title = name.replace(/\.[^.]+$/, '').replace(/^_+/, '') || 'ClockFaceEdit project';
      return {
        sourceType: 'clockface',
        file: {
          title,
          width: imported.width,
          height: imported.height,
          shape: defaultFaceShape(imported.width, imported.height),
          mode: 'bin',
          bin: imported.document,
        },
        layers: imported.layers,
      };
    }
    return { ...applyProject(project), sourceType: 'project' };
  }
  if (extension !== 'bin') throw new Error('Choose a .bin watch face or a .wfproj/.json project.');
  if (isDafitTypeC(bytes)) return { ...fromDafitBinary(parseDafitTypeC(bytes), name), sourceType: 'dafit-bin' };
  return { ...fromBinary(parseWatchface(bytes), name), sourceType: 'bin' };
}

function App() {
  const canvasRef = useRef(null);
  const importPreviewCanvasRef = useRef(null);
  const expandedStageRef = useRef(null);
  const projectPanelRef = useRef(null);
  const layersPanelRef = useRef(null);
  const inspectorPanelRef = useRef(null);
  const assetPanelRef = useRef(null);
  const panelResizeRef = useRef(null);
  const inputRef = useRef(null);
  const importInputRef = useRef(null);
  const assetInputRef = useRef(null);
  const dragRef = useRef(null);
  const assetTargetRef = useRef(null);
  const layersRef = useRef([]);
  const defaultWatchfaceLoadedRef = useRef(false);
  const [file, setFile] = useState(initialFileState);
  const [layers, setLayers] = useState(initialLayers);
  const [selectedId, setSelectedId] = useState('demo-time');
  const [dropTargetId, setDropTargetId] = useState(null);
  const [smartGuides, setSmartGuides] = useState(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [copyImageSourceId, setCopyImageSourceId] = useState('');
  const [importSource, setImportSource] = useState(null);
  const [importSelection, setImportSelection] = useState([]);
  const [importPreviewId, setImportPreviewId] = useState(null);
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [bulkDeleteIds, setBulkDeleteIds] = useState([]);
  const [customProfile, setCustomProfile] = useState(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState('auto');
  const [profileDraft, setProfileDraft] = useState({ name: '', width: 466, height: 466 });
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [showGuides, setShowGuides] = useState(true);
  const [snap, setSnap] = useState(true);
  const [preview, setPreview] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [previewDate, setPreviewDate] = useState(() => new Date());
  const [expandedStageSize, setExpandedStageSize] = useState({ width: 0, height: 0 });
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [panelWidths, setPanelWidths] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState({ text: 'Loading default watch face…', kind: 'info' });
  const [workspaceMode, setWorkspaceMode] = useState('Design');
  const [newItemType, setNewItemType] = useState(ITEM_CATALOG[0]?.id ?? 1);

  layersRef.current = layers;
  const selected = layers.find((layer) => layerKey(layer) === selectedId);
  const deviceProfile = activeProfileId === 'auto'
    ? customProfile?.width === file.width && customProfile?.height === file.height ? customProfile : matchDeviceProfile(file.width, file.height)
    : customProfile?.id === activeProfileId ? customProfile : DEVICE_PROFILES.find((profile) => profile.id === activeProfileId);
  const selectedImages = selected?.images || [];
  const visibleCount = layers.filter((layer) => layer.visible !== false).length;
  const hasDuplicateTypes = new Set(layers.map((layer) => layer.id)).size !== layers.length;
  const hasUnexportableDuplicates = hasDuplicateTypes && file.bin?.format !== 'dafit-c';
  const canExportBin = file.mode === 'bin' && Boolean(file.bin) && !hasUnexportableDuplicates
    && layers.every((layer) => layer.imgCount > 0 && layer.imgCount <= 255
      && layer.width * layer.height * layer.imgCount <= 16_000_000
      && layer.packedPixels?.length === layer.width * layer.height * layer.imgCount);
  const availableItemTypes = ITEM_CATALOG.filter((item) => !layers.some((layer) => layer.id === item.id));

  const announce = useCallback((text, kind = 'success') => {
    setNotice({ text, kind });
  }, []);

  const commitLayers = useCallback((nextLayers, { previous = layersRef.current, changed = true } = {}) => {
    if (changed) {
      setUndoStack((stack) => [...stack.slice(-79), previous]);
      setRedoStack([]);
      setDirty(true);
    }
    setLayers(nextLayers);
  }, []);

  const updateLayer = useCallback((id, changes) => {
    const current = layersRef.current;
    const next = current.map((layer) => {
      if (layerKey(layer) !== id) return layer;
      const updated = { ...layer, ...changes };
      if (Object.hasOwn(changes, 'copyImage') && !Object.hasOwn(changes, 'images') && layer.packedPixels && layer.type !== 'dafit') {
        const pixelCount = layer.width * layer.height;
        updated.images = Array.from({ length: layer.imgCount }, (_, frame) => {
          const image = new Uint8ClampedArray(pixelCount * 4);
          for (let pixel = 0; pixel < pixelCount; pixel += 1) {
            const packed = layer.packedPixels[frame * pixelCount + pixel];
            const offset = pixel * 4;
            const red = ((packed >>> 11) & 0x1f) << 3;
            const green = ((packed >>> 6) & 0x1f) << 3;
            const blue = (packed & 0x1f) << 3;
            image[offset] = red;
            image[offset + 1] = green;
            image[offset + 2] = blue;
            image[offset + 3] = updated.copyImage || red + green + blue > 0 ? 255 : 0;
          }
          return image;
        });
      }
      return updated;
    });
    if (next.some((layer, index) => layer !== current[index])) commitLayers(next);
  }, [commitLayers]);

  const openPayload = useCallback(async ({ name, bytes, assets }) => {
    const result = await loadWatchfacePayload({ name, bytes, assets });
    setFile(result.file);
    setActiveProfileId(matchDeviceProfile(result.file.width, result.file.height)?.id || 'auto');
    setLayers(result.layers);
    setNewItemType(nextAvailableItemType(result.layers));
    setSelectedId(layerKey(result.layers.find((layer) => layer.id === 17) ?? result.layers[0] ?? { id: null }));
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    if (result.sourceType === 'clockface') {
      announce(`Imported ClockFaceEdit project · ${result.layers.length} elements`);
      return;
    }
    if (result.sourceType === 'project') {
      announce(`Opened project · ${name}`);
      return;
    }
    if (result.sourceType === 'dafit-bin') {
      announce(`Opened Da Fit Type C face · ${result.layers.length} elements · 240 × 240 round preview`);
      return;
    }
    const warnings = [];
    if (!result.file.bin.checksumValid) warnings.push('checksum will be repaired on export');
    if (result.file.bin.truncatedItems.length) {
      warnings.push(`incomplete sprite data recovered with blank pixels (${result.file.bin.truncatedItems.map((item) => `${item.name}: ${item.truncatedBytes} bytes missing`).join(', ')})`);
    }
    announce(`Opened ${name} · ${formatFileSize(bytes.length)}${warnings.length ? ` · ${warnings.join(' · ')}` : ''}`, warnings.length ? 'warning' : 'success');
  }, [announce]);

  const openFile = useCallback(async () => {
    if (window.electronAPI?.openFile) {
      try {
        const result = await window.electronAPI.openFile();
        if (result) await openPayload({ name: result.name, bytes: new Uint8Array(result.bytes), assets: result.assets });
      } catch (error) {
        announce(error.message || 'Could not open this file.', 'error');
      }
      return;
    }
    inputRef.current?.click();
  }, [announce, openPayload]);

  const openElementImport = () => {
    setImportSource(null);
    setImportSelection([]);
    setImportPreviewId(null);
    importInputRef.current?.click();
  };

  const handleElementImportFile = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    const sourceFile = selectedFiles.find((candidate) => !candidate.name.toLowerCase().endsWith('.png'));
    if (!sourceFile) {
      announce('Select a BIN or watch-face project file to import elements from.', 'warning');
      return;
    }
    try {
      const assets = {};
      await Promise.all(selectedFiles.map(async (candidate) => {
        const match = candidate.name.match(/^(\d+)\.png$/i);
        if (match) assets[Number(match[1])] = new Uint8Array(await candidate.arrayBuffer());
      }));
      const source = await loadWatchfacePayload({
        name: sourceFile.name,
        bytes: new Uint8Array(await sourceFile.arrayBuffer()),
        assets,
      });
      const candidates = source.layers.filter((layer) => layer.images?.length && layer.packedPixels?.length);
      if (!candidates.length) throw new Error('This project has no image-backed watch elements to import.');
      setImportSource({ ...source, name: sourceFile.name, layers: candidates });
      setImportSelection([]);
      setImportPreviewId(layerKey(candidates[0]));
    } catch (error) {
      announce(error.message || 'Could not load elements from this file.', 'error');
    }
  };

  const importSelectedElements = () => {
    if (!importSource || !importSelection.length) return;
    const chosen = importSource.layers.filter((layer) => importSelection.includes(String(layerKey(layer))));
    if (!chosen.length) return;
    if (file.bin?.format === 'dafit-c' && chosen.some((layer) => layer.type !== 'dafit')) {
      announce('Da Fit Type C BINs can only import elements from another Da Fit Type C BIN or project.', 'warning');
      return;
    }
    const previous = layersRef.current;
    const added = chosen.map((source, index) => {
      const uid = `import-${Date.now()}-${Math.random().toString(36).slice(2)}-${index}`;
      const duplicate = previous.some((layer) => layer.id === source.id)
        || chosen.slice(0, index).some((layer) => layer.id === source.id);
      const copied = {
        ...source,
        uid,
        ...(source.type === 'dafit' ? { sourceRecordIndex: undefined, blobIndex: undefined } : {}),
        name: duplicate ? `${watchfaceName(source)} (imported)` : watchfaceName(source),
        x: source.type !== 'dafit' && source.id >= 1 && source.id <= 3
          ? clamp(Math.round(Number(source.x) || 0), 0, file.width)
          : clamp(Math.round(Number(source.x) || 0), 0, Math.max(0, file.width - source.width)),
        y: source.type !== 'dafit' && source.id >= 1 && source.id <= 3
          ? clamp(Math.round(Number(source.y) || 0), 0, file.height)
          : clamp(Math.round(Number(source.y) || 0), 0, Math.max(0, file.height - source.height)),
        images: source.images.map((image) => new Uint8ClampedArray(image)),
        packedPixels: new Uint16Array(source.packedPixels),
        modified: true,
        visible: true,
        locked: false,
      };
      return copied;
    });
    const totalPixels = [...previous, ...added].reduce((total, layer) => total + layer.width * layer.height * (layer.imgCount || 0), 0);
    if (totalPixels > 32_000_000) {
      announce('These elements would exceed the BIN pixel-data safety limit.', 'error');
      return;
    }
    commitLayers([...previous, ...added], { previous });
    setSelectedId(layerKey(added[added.length - 1]));
    setImportSource(null);
    setImportSelection([]);
    const duplicateCount = added.filter((layer, index) => (
      previous.some((existing) => existing.id === layer.id)
      || added.slice(0, index).some((prior) => prior.id === layer.id)
    )).length;
    const duplicateNote = file.bin?.format === 'dafit-c'
      ? ' · duplicate type records are preserved'
      : ' · duplicates are editor-only and prevent BIN export';
    announce(
      duplicateCount
        ? `Imported ${added.length} elements, including ${duplicateCount} duplicate type${duplicateCount === 1 ? '' : 's'}${duplicateNote}`
        : `Imported ${added.length} element${added.length === 1 ? '' : 's'} from ${importSource.name}`,
      duplicateCount && file.bin?.format !== 'dafit-c' ? 'warning' : 'success',
    );
  };

  const saveProject = useCallback(async () => {
    try {
      const project = createProjectFile({
        title: file.title,
        width: file.width,
        height: file.height,
        shape: file.shape,
        sourceBytes: file.bin?.bytes,
        sourceFormat: file.bin?.format,
        layers,
      });
      const data = JSON.stringify(project, null, 2);
      if (window.electronAPI?.saveFile) {
        const result = await window.electronAPI.saveFile({ kind: 'project', data, defaultName: `${file.title}.wfproj` });
        if (!result) return;
      } else {
        downloadFile(new TextEncoder().encode(data), `${file.title}.wfproj`, 'application/json');
      }
      setDirty(false);
      announce('Project saved');
    } catch (error) {
      announce(error.message || 'Could not save the project.', 'error');
    }
  }, [announce, file, layers]);

  const exportBin = useCallback(async () => {
    if (!file.bin) {
      announce('Open a watch-face BIN before exporting a BIN.', 'warning');
      return;
    }
    if (!canExportBin) {
      announce('Add at least one image frame to each empty watch element before exporting.', 'warning');
      return;
    }
    try {
      const exportLayers = layers.map((layer) => ({
        ...layer,
        ...(Number.isFinite(Number(layer.x)) && Number(layer.x) >= 0 && Number(layer.x) <= 65535
          ? { x: Math.round(Number(layer.x)) }
          : {}),
        ...(Number.isFinite(Number(layer.y)) && Number(layer.y) >= 0 && Number(layer.y) <= 65535
          ? { y: Math.round(Number(layer.y)) }
          : {}),
      }));
      const bytes = file.bin.format === 'dafit-c'
        ? writeDafitTypeC(file.bin, exportLayers)
        : writeWatchface(file.bin, exportLayers);
      if (window.electronAPI?.saveFile) {
        const result = await window.electronAPI.saveFile({ kind: 'bin', bytes, defaultName: `${file.title}-edited.bin` });
        if (!result) return;
      } else {
        downloadFile(bytes, `${file.title}-edited.bin`, 'application/octet-stream');
      }
      setDirty(false);
      announce('Watch-face BIN exported');
    } catch (error) {
      announce(error.message || 'Could not export the BIN file.', 'error');
    }
  }, [announce, canExportBin, file, layers]);

  const newProject = useCallback(async () => {
    try {
      const response = await fetch(defaultWatchfaceUrl);
      if (!response.ok) throw new Error(`Could not load the default watch-face BIN template (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const result = fromBinary(parseWatchface(bytes), 'New Watch Face.bin');
      setFile({ ...result.file, title: 'New Watch Face' });
      setActiveProfileId(matchDeviceProfile(result.file.width, result.file.height)?.id || 'auto');
      setLayers(result.layers);
      setNewItemType(nextAvailableItemType(result.layers));
      setSelectedId(layerKey(result.layers.find((layer) => layer.id === 17) || result.layers[0]));
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setPreview(false);
      setSmartGuides(null);
      announce(`New watch face from default BIN · ${result.file.width} × ${result.file.height}`);
    } catch (error) {
      announce(error.message || 'Could not create a new watch-face project.', 'error');
    }
  }, [announce]);

  useEffect(() => {
    if (defaultWatchfaceLoadedRef.current) return;
    defaultWatchfaceLoadedRef.current = true;
    newProject();
  }, [newProject]);

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack, layersRef.current]);
    setLayers(undoStack[undoStack.length - 1]);
    setDirty(true);
  }, [redoStack, undoStack]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack, layersRef.current]);
    setLayers(redoStack[redoStack.length - 1]);
    setDirty(true);
  }, [redoStack, undoStack]);

  const addLayer = useCallback((type) => {
    if (file.mode === 'bin') {
      announce('BIN layers need a source image asset. Reposition existing BIN items, or add elements to a project.', 'warning');
      return;
    }
    const defaults = {
      label: { name: 'New label', width: 104, height: 22, text: 'NEW LABEL' },
      image: { name: 'Image frame', width: 48, height: 48 },
      icon: { name: 'Weather icon', width: 32, height: 32 },
    };
    const preset = defaults[type];
    const id = `demo-${type}-${Date.now()}`;
    const layer = {
      id, type, ...preset,
      x: Math.round((file.width - preset.width) / 2),
      y: type === 'label' ? Math.max(0, Math.round(file.height * 0.64)) : Math.round((file.height - preset.height) / 2),
      visible: true,
      locked: false,
    };
    commitLayers([...layersRef.current, layer]);
    setSelectedId(id);
    announce(`${preset.name} added`);
  }, [announce, commitLayers, file]);

  const addEmptyBinaryItem = useCallback(() => {
    if (file.mode !== 'bin') {
      addLayer('label');
      return;
    }
    const item = ITEM_CATALOG.find((candidate) => candidate.id === newItemType);
    if (!item) {
      announce('Choose an available watch element type first.', 'warning');
      return;
    }
    if (layersRef.current.some((layer) => layer.id === item.id)) {
      setNewItemType(nextAvailableItemType(layersRef.current));
      announce('That watch element already exists. Choose another available type.', 'warning');
      return;
    }
    const layer = {
      id: item.id,
      name: item.name,
      width: 1,
      height: 1,
      x: Math.round(file.width / 2),
      y: Math.round(file.height / 2),
      imgCount: 0,
      copyImage: item.id === 17,
      blackIsTransparent: item.id === 17 ? false : true,
      clockHandsInfo: [0, 0, 0, 0],
      images: [],
      packedPixels: new Uint16Array(),
      modified: true,
      visible: true,
      locked: false,
    };
    commitLayers([...layersRef.current, layer]);
    setSelectedId(layer.id);
    setSelectedImageIndex(0);
    setNewItemType(nextAvailableItemType([...layersRef.current, layer]));
    announce(`${item.name} added. Select Add images to assign one or more PNG frames.`);
  }, [addLayer, announce, commitLayers, file, newItemType]);

  const reorderLayer = (sourceId, targetId, placeAbove = true) => {
    if (String(sourceId) === String(targetId)) return;
    const previous = layersRef.current;
    const sourceIndex = previous.findIndex((layer) => String(layerKey(layer)) === String(sourceId));
    const targetIndex = previous.findIndex((layer) => String(layerKey(layer)) === String(targetId));
    if (sourceIndex < 0 || targetIndex < 0) return;
    if (isFixedStackItem(previous[sourceIndex]) || isFixedStackItem(previous[targetIndex])) {
      announce('Backgrounds and clock hands keep their device-defined draw order.', 'warning');
      return;
    }
    const next = [...previous];
    const [moved] = next.splice(sourceIndex, 1);
    const adjustedTargetIndex = targetIndex + (sourceIndex < targetIndex ? -1 : 0);
    next.splice(adjustedTargetIndex + (placeAbove ? 1 : 0), 0, moved);
    if (next.every((layer, index) => layer === previous[index])) return;
    commitLayers(next, { previous });
    announce(`Moved ${watchfaceName(moved)} ${placeAbove ? 'above' : 'below'} ${watchfaceName(previous[targetIndex])}. BIN devices may use a fixed draw order.`);
  };

  const removeSelectedFrame = useCallback(() => {
    if (!selected || selectedImageIndex >= selectedImages.length) return;
    const images = selectedImages.filter((_, index) => index !== selectedImageIndex);
    updateLayer(layerKey(selected), {
      imgCount: images.length,
      images,
      packedPixels: rgbaToPackedPixels(images, selected.width, selected.height, Boolean(selected.copyImage)),
      modified: true,
    });
    setSelectedImageIndex(Math.max(0, selectedImageIndex - 1));
    announce(images.length ? 'Image removed' : 'All images removed; add a frame before exporting this block');
  }, [announce, selected, selectedImageIndex, selectedImages, updateLayer]);

  const removeAllFrames = useCallback(() => {
    if (!selected || !selectedImages.length) return;
    if (!window.confirm(`Delete all ${selectedImages.length} images from ${watchfaceName(selected)}? The block will need images before BIN export.`)) return;
    updateLayer(layerKey(selected), { imgCount: 0, images: [], packedPixels: new Uint16Array(), modified: true });
    setSelectedImageIndex(0);
    announce('All block images removed', 'warning');
  }, [announce, selected, selectedImages.length, updateLayer]);

  const moveSelectedFrame = useCallback((direction) => {
    if (!selected || selectedImageIndex + direction < 0 || selectedImageIndex + direction >= selectedImages.length) return;
    const images = [...selectedImages];
    [images[selectedImageIndex], images[selectedImageIndex + direction]] = [images[selectedImageIndex + direction], images[selectedImageIndex]];
    updateLayer(layerKey(selected), {
      images,
      packedPixels: rgbaToPackedPixels(images, selected.width, selected.height, Boolean(selected.copyImage)),
      modified: true,
    });
    setSelectedImageIndex(selectedImageIndex + direction);
    announce(`Image moved ${direction < 0 ? 'left' : 'right'}`);
  }, [announce, selected, selectedImageIndex, selectedImages, updateLayer]);

  const copyImagesFromBlock = useCallback((sourceId) => {
    const source = layers.find((layer) => String(layerKey(layer)) === sourceId);
    if (!selected || !source || layerKey(source) === layerKey(selected)) return;
    const images = source.images.map((image) => new Uint8ClampedArray(image));
    if (selected.type === 'dafit' && images.length !== selected.imgCount) {
      announce(`This Da Fit element requires exactly ${selected.imgCount} image frames.`, 'warning');
      return;
    }
    if (images.length > 255) {
      announce('A block cannot contain more than 255 image frames.', 'error');
      return;
    }
    if (source.width * source.height * images.length > 16_000_000) {
      announce('This image collection contains too many pixels to export safely.', 'error');
      return;
    }
    updateLayer(layerKey(selected), {
      width: source.width,
      height: source.height,
      imgCount: images.length,
      copyImage: !(source.blackIsTransparent ?? !source.copyImage),
      blackIsTransparent: source.blackIsTransparent ?? !source.copyImage,
      images,
      packedPixels: rgbaToPackedPixels(images, source.width, source.height, !(source.blackIsTransparent ?? !source.copyImage)),
      modified: true,
    });
    setSelectedImageIndex(0);
    announce(`Copied ${images.length} image${images.length === 1 ? '' : 's'} from ${watchfaceName(source)} · ${source.width} × ${source.height} px`);
  }, [announce, layers, selected, updateLayer]);

  const startAssetImport = (target) => {
    assetTargetRef.current = target;
    if (assetInputRef.current) assetInputRef.current.multiple = ['add-images', 'new-bin'].includes(target.kind);
    assetInputRef.current?.click();
  };

  const handleAssetFile = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selectedFiles.length) return;
    const target = assetTargetRef.current;
    assetTargetRef.current = null;
    if (!target) return;

    try {
      if (target.kind === 'add-images') {
        const existing = layersRef.current.find((layer) => layerKey(layer) === target.id);
        if (!existing) throw new Error('Select a block before adding images.');
        const currentImages = existing.images || [];
        let frameWidth = currentImages.length ? existing.width : 0;
        let frameHeight = currentImages.length ? existing.height : 0;
        const addedFrames = [];
        for (const selectedFile of selectedFiles) {
          const bitmap = await createImageBitmap(selectedFile);
          try {
            if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('PNG frames must be no larger than 4096 × 4096 pixels.');
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Could not read this image.');
            context.drawImage(bitmap, 0, 0);
            addedFrames.push({
              width: bitmap.width,
              height: bitmap.height,
              pixels: new Uint8ClampedArray(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
            });
            frameWidth = Math.max(frameWidth, bitmap.width);
            frameHeight = Math.max(frameHeight, bitmap.height);
          } finally {
            bitmap.close();
          }
        }
        if (currentImages.length + addedFrames.length > 255) throw new Error('A block cannot contain more than 255 image frames.');
        const width = frameWidth;
        const height = frameHeight;
        const images = [
          ...currentImages.map((image) => centerImageFrame(image, existing.width, existing.height, width, height)),
          ...addedFrames.map((frame) => centerImageFrame(frame.pixels, frame.width, frame.height, width, height)),
        ];
        if (width * height * images.length > 16_000_000) throw new Error('This block would contain too many image pixels to export safely.');
        const expandedLayer = { ...existing, width, height };
        const limits = getLayerPositionLimits(expandedLayer, file, previewDate);
        const needsDimensions = !currentImages.length;
        const offsetX = currentImages.length ? Math.floor((width - existing.width) / 2) : 0;
        const offsetY = currentImages.length ? Math.floor((height - existing.height) / 2) : 0;
        updateLayer(layerKey(existing), {
          width,
          height,
          x: needsDimensions
            ? clamp(Math.round((file.width - width) / 2), limits.minX, limits.maxX)
            : clamp(existing.x - offsetX, limits.minX, limits.maxX),
          y: needsDimensions
            ? clamp(Math.round((file.height - height) / 2), limits.minY, limits.maxY)
            : clamp(existing.y - offsetY, limits.minY, limits.maxY),
          imgCount: images.length,
          images,
          packedPixels: rgbaToPackedPixels(images, width, height, Boolean(existing.copyImage)),
          modified: true,
        });
        setSelectedImageIndex(currentImages.length);
        announce(`${addedFrames.length} image${addedFrames.length === 1 ? '' : 's'} added to ${watchfaceName(existing)}`);
        return;
      }

      const existing = layersRef.current.find((layer) => layerKey(layer) === target.id);
      const catalogItem = ITEM_CATALOG.find((item) => item.id === target.id);
      const isNewBinaryItem = target.kind === 'new-bin';
      const isNewProjectImage = target.kind === 'new-project-image';
      const frames = [];
      let bitmapWidth = 0;
      let frameHeight = 0;
      let imageCount = 0;
      if (isNewBinaryItem && selectedFiles.length > 1) {
        const importedFrames = [];
        for (const selectedFile of selectedFiles) {
          const bitmap = await createImageBitmap(selectedFile);
          try {
            if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('PNG frames must be no larger than 4096 × 4096 pixels.');
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Could not read this image.');
            context.drawImage(bitmap, 0, 0);
            importedFrames.push({
              width: bitmap.width,
              height: bitmap.height,
              pixels: new Uint8ClampedArray(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
            });
            bitmapWidth = Math.max(bitmapWidth, bitmap.width);
            frameHeight = Math.max(frameHeight, bitmap.height);
          } finally {
            bitmap.close();
          }
        }
        frames.push(...importedFrames.map((frame) => (
          centerImageFrame(frame.pixels, frame.width, frame.height, bitmapWidth, frameHeight)
        )));
        imageCount = frames.length;
      } else {
        const bitmap = await createImageBitmap(selectedFiles[0]);
        try {
          bitmapWidth = bitmap.width;
          const expectedCount = existing?.imgCount || target.imgCount || 1;
          const isExistingFrame = Boolean(existing && bitmap.height === existing.height);
          const isSpriteSheet = !isExistingFrame && expectedCount > 1 && bitmap.height % expectedCount === 0;
          imageCount = isExistingFrame ? expectedCount : isSpriteSheet ? expectedCount : 1;
          frameHeight = isSpriteSheet ? bitmap.height / expectedCount : bitmap.height;
          if (bitmapWidth > 4096 || frameHeight > 4096) throw new Error('PNG frames must be no larger than 4096 × 4096 pixels.');
          const canvas = document.createElement('canvas');
          canvas.width = bitmapWidth;
          canvas.height = frameHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Could not read this image.');
          for (let frame = 0; frame < imageCount; frame += 1) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            const sourceY = isExistingFrame || !isSpriteSheet ? 0 : frame * frameHeight;
            context.drawImage(bitmap, 0, sourceY, bitmapWidth, frameHeight, 0, 0, bitmapWidth, frameHeight);
            frames.push(new Uint8ClampedArray(context.getImageData(0, 0, bitmapWidth, frameHeight).data));
          }
        } finally {
          bitmap.close();
        }
      }
      if (imageCount > 255) throw new Error('A block cannot contain more than 255 image frames.');
      if (bitmapWidth * frameHeight * imageCount > 16_000_000) throw new Error('This block would contain too many image pixels to export safely.');

      const base = existing || {
        id: target.id,
        name: isNewBinaryItem ? catalogItem?.name : isNewProjectImage ? 'Logo / image' : 'Image frame',
        type: isNewProjectImage ? 'image' : undefined,
        width: bitmapWidth,
        height: frameHeight,
        x: clamp(Math.round((file.width - bitmapWidth) / 2), 0, file.width),
        y: clamp(Math.round((file.height - frameHeight) / 2), 0, file.height),
        imgCount: imageCount,
        copyImage: isNewBinaryItem && target.id === 17,
        blackIsTransparent: isNewBinaryItem && target.id === 17 ? false : true,
        visible: true,
        locked: false,
      };

      const copyImage = !(base.blackIsTransparent ?? !base.copyImage);
      const updated = {
        ...base,
        width: bitmapWidth,
        height: frameHeight,
        imgCount: imageCount,
        copyImage,
        images: frames,
        packedPixels: rgbaToPackedPixels(frames, bitmapWidth, frameHeight, copyImage),
        modified: true,
      };
      const previous = layersRef.current;
      const next = existing
        ? previous.map((layer) => layerKey(layer) === layerKey(existing) ? updated : layer)
        : [...previous, updated];
      commitLayers(next, { previous });
      const nextItemType = ITEM_CATALOG.find((item) => !next.some((layer) => layer.id === item.id));
      if (nextItemType) setNewItemType(nextItemType.id);
      setSelectedId(layerKey(updated));
      announce(`${isNewBinaryItem ? 'BIN item added' : isNewProjectImage ? 'Logo / image added' : existing ? 'Image replaced' : 'Image added'} · ${bitmapWidth} × ${frameHeight} px · ${imageCount} frame${imageCount === 1 ? '' : 's'}`);
    } catch (error) {
      announce(error.message || 'Could not read this PNG.', 'error');
    }
  };

  const removeSelected = useCallback(() => {
    if (!selected || selected.locked) return;
    const previous = layersRef.current;
    const next = previous.filter((layer) => layerKey(layer) !== layerKey(selected));
    commitLayers(next, { previous });
    setSelectedId(next.length ? layerKey(next[next.length - 1]) : null);
    announce(`${watchfaceName(selected)} removed`);
  }, [announce, commitLayers, selected]);

  const removeBulkSelected = useCallback(() => {
    const removing = layers.filter((layer) => bulkDeleteIds.includes(layerKey(layer)) && !layer.locked);
    if (!removing.length) {
      announce('Select one or more unlocked blocks to delete.', 'warning');
      return;
    }
    if (!window.confirm(`Delete ${removing.length} selected block${removing.length === 1 ? '' : 's'}?`)) return;
    const removedIds = new Set(removing.map(layerKey));
    const next = layers.filter((layer) => !removedIds.has(layerKey(layer)));
    commitLayers(next);
    if (removedIds.has(selectedId)) setSelectedId(next.length ? layerKey(next[next.length - 1]) : null);
    setBulkDeleteIds([]);
    setBulkDeleteMode(false);
    announce(`${removing.length} block${removing.length === 1 ? '' : 's'} deleted`);
  }, [announce, bulkDeleteIds, commitLayers, layers, selectedId]);

  const clearAll = useCallback(() => {
    if (!layers.length) return;
    if (!window.confirm(`Clear all ${layers.length} blocks from the current editor?`)) return;
    commitLayers([]);
    setSelectedId(null);
    setSelectedImageIndex(0);
    setBulkDeleteIds([]);
    announce('All blocks cleared', 'warning');
  }, [announce, commitLayers, layers.length]);

  const showBinaryInfo = useCallback(() => {
    if (!file.bin) {
      announce('Open a BIN or ClockFaceEdit project to view file information.', 'info');
      return;
    }
    const info = [
      `Name: ${file.title}`,
      `Size: ${formatFileSize(file.bin.bytes.length)}`,
      `Format: ${file.bin.format === 'dafit-c' ? `Da Fit Type C (0x${file.bin.fileId.toString(16)})` : file.bin.compressed ? 'Compressed BIN' : 'Uncompressed BIN'}`,
      `Dimensions: ${file.width} × ${file.height}`,
      `Blocks: ${file.bin.items?.length ?? file.bin.layers?.length ?? layers.length}`,
      `Images: ${file.bin.items?.reduce((count, item) => count + item.imgCount, 0) ?? file.bin.layers?.reduce((count, layer) => count + layer.imgCount, 0) ?? layers.reduce((count, layer) => count + (layer.imgCount || 0), 0)}`,
      ...(file.bin.format === 'dafit-c' ? [] : [`Checksum: ${file.bin.checksumValid ? 'Valid' : 'Invalid; will be recalculated on export'}`]),
      ...(file.bin.format === 'dafit-c' ? [] : [`Incomplete image data: ${file.bin.truncatedItems.length ? file.bin.truncatedItems.map((item) => `${item.name} (${item.truncatedBytes} bytes)`).join(', ') : 'None'}`]),
    ].join('\n');
    window.alert(info);
  }, [announce, file, layers]);

  const alignSelectedToFace = (axis, alignment) => {
    if (!selected) return;
    const bounds = getLayerBounds(selected, file, previewDate);
    const offset = bounds[axis] - selected[axis];
    const faceSize = axis === 'x' ? file.width : file.height;
    const boundsSize = axis === 'x' ? bounds.width : bounds.height;
    const target = alignment === 'start'
      ? 0
      : alignment === 'center'
        ? (faceSize - boundsSize) / 2
        : faceSize - boundsSize;
    const limits = getLayerPositionLimits(selected, file, previewDate);
    const dimension = axis === 'x' ? 'minX' : 'minY';
    const maximum = axis === 'x' ? 'maxX' : 'maxY';
    updateLayer(layerKey(selected), {
      [axis]: clamp(Math.round(target - offset), limits[dimension], limits[maximum]),
    });
  };

  const handleCanvasPointerDown = (event) => {
    if (preview) return;
    const canvas = canvasRef.current;
    const point = pointOnCanvas(event, canvas);
    const hit = hitTest(layersRef.current, point, file, previewDate);
    setSelectedId(hit ? layerKey(hit) : null);
    if (!hit || hit.locked) return;
    dragRef.current = {
      pointerId: event.pointerId,
      start: point,
      origin: { x: hit.x, y: hit.y },
      layerId: layerKey(hit),
      before: layersRef.current,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
  };

  const startPanelResize = (event, dividerIndex) => {
    if (event.button !== 0) return;
    const refs = [projectPanelRef, layersPanelRef, inspectorPanelRef, assetPanelRef];
    const widths = refs.map((ref) => ref.current?.getBoundingClientRect().width ?? 0);
    if (dividerIndex === 2 && !inspectorVisible) return;
    panelResizeRef.current = { dividerIndex, startX: event.clientX, widths };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const resizePanels = (event) => {
    const drag = panelResizeRef.current;
    if (!drag) return;
    const leftMinimum = [160, 160, 210][drag.dividerIndex];
    const rightMinimum = [160, 210, 220][drag.dividerIndex];
    const pairWidth = drag.widths[drag.dividerIndex] + drag.widths[drag.dividerIndex + 1];
    const leftWidth = clamp(
      drag.widths[drag.dividerIndex] + event.clientX - drag.startX,
      leftMinimum,
      pairWidth - rightMinimum,
    );
    const nextWidths = [...drag.widths];
    nextWidths[drag.dividerIndex] = leftWidth;
    nextWidths[drag.dividerIndex + 1] = pairWidth - leftWidth;
    setPanelWidths(nextWidths);
  };

  const finishPanelResize = (event) => {
    if (!panelResizeRef.current) return;
    panelResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePanelResizeKeyDown = (event, dividerIndex) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const refs = [projectPanelRef, layersPanelRef, inspectorPanelRef, assetPanelRef];
    const widths = panelWidths || refs.map((ref) => ref.current?.getBoundingClientRect().width ?? 0);
    const leftMinimum = [160, 160, 210][dividerIndex];
    const rightMinimum = [160, 210, 220][dividerIndex];
    const pairWidth = widths[dividerIndex] + widths[dividerIndex + 1];
    const delta = event.key === 'ArrowRight' ? 8 : -8;
    const leftWidth = clamp(widths[dividerIndex] + delta, leftMinimum, pairWidth - rightMinimum);
    const nextWidths = [...widths];
    nextWidths[dividerIndex] = leftWidth;
    nextWidths[dividerIndex + 1] = pairWidth - leftWidth;
    setPanelWidths(nextWidths);
  };

  const handleCanvasPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointOnCanvas(event, canvasRef.current);
    const scale = snap ? 8 : 1;
    const layer = layersRef.current.find((item) => layerKey(item) === drag.layerId);
    if (!layer) return;
    const deltaX = Math.round((point.x - drag.start.x) / scale) * scale;
    const deltaY = Math.round((point.y - drag.start.y) / scale) * scale;
    const { position, guides } = getSmartSnappedPosition(
      layer,
      layersRef.current,
      { x: drag.origin.x + deltaX, y: drag.origin.y + deltaY },
      file,
      previewDate,
    );
    const { x: nextX, y: nextY } = position;
    setSmartGuides(guides.vertical.length || guides.horizontal.length ? guides : null);
    drag.moved ||= nextX !== drag.origin.x || nextY !== drag.origin.y;
    setLayers((current) => current.map((layer) => layerKey(layer) === drag.layerId ? { ...layer, x: nextX, y: nextY } : layer));
  };

  const finishCanvasDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      setUndoStack((stack) => [...stack.slice(-79), drag.before]);
      setRedoStack([]);
      setDirty(true);
    }
    dragRef.current = null;
    setSmartGuides(null);
  };

  useEffect(() => {
    drawFace(canvasRef.current, { ...file, mode: file.mode }, layers, selectedId, showGuides, preview, previewDate, smartGuides);
  }, [file, layers, selectedId, showGuides, preview, previewDate, expandedPreview, smartGuides]);

  useEffect(() => {
    if (!importSource) return;
    drawFace(importPreviewCanvasRef.current, importSource.file, importSource.layers, importPreviewId, false, false, previewDate);
  }, [importPreviewId, importSource, previewDate]);

  useEffect(() => {
    const timer = window.setInterval(() => setPreviewDate(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!expandedPreview || !expandedStageRef.current) return undefined;
    const stage = expandedStageRef.current;
    const updateStageSize = () => {
      const { width, height } = stage.getBoundingClientRect();
      setExpandedStageSize({ width, height });
    };
    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [expandedPreview]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && (expandedPreview || importSource)) {
        if (expandedPreview) setExpandedPreview(false);
        if (importSource) setImportSource(null);
        return;
      }
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openFile();
        return;
      }
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (event.shiftKey) exportBin();
        else saveProject();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (typing) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelected();
      } else if (event.key.startsWith('Arrow') && selected && !selected.locked && !preview) {
        event.preventDefault();
        const step = event.shiftKey ? 8 : 1;
        const delta = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[event.key];
        if (delta) {
          const limits = getLayerPositionLimits(selected, file, previewDate);
          updateLayer(layerKey(selected), {
            x: clamp(selected.x + delta[0], limits.minX, limits.maxX),
            y: clamp(selected.y + delta[1], limits.minY, limits.maxY),
          });
        }
      } else if (event.key === '+' || event.key === '=') {
        setZoom((value) => Math.min(2, +(value + 0.1).toFixed(1)));
      } else if (event.key === '-') {
        setZoom((value) => Math.max(0.5, +(value - 0.1).toFixed(1)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedPreview, exportBin, file, importSource, openFile, preview, previewDate, redo, removeSelected, saveProject, selected, undo, updateLayer]);

  useEffect(() => {
    if (!window.electronAPI?.onMenuCommand) return undefined;
    const unsubscribe = window.electronAPI.onMenuCommand((command) => {
      if (command === 'open') openFile();
      else if (command === 'save-project') saveProject();
      else if (command === 'export-bin') exportBin();
      else if (command === 'new-project') newProject();
      else if (command === 'undo') undo();
      else if (command === 'redo') redo();
      else if (command === 'toggle-guides') setShowGuides((value) => !value);
      else if (command === 'toggle-inspector') setInspectorVisible((value) => !value);
    });
    return unsubscribe;
  }, [exportBin, newProject, openFile, redo, saveProject, undo]);

  const layerCountLabel = useMemo(() => `${visibleCount} of ${layers.length} visible`, [visibleCount, layers.length]);

  const handleBrowserFile = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    const selectedFile = selectedFiles.find((candidate) => !candidate.name.toLowerCase().endsWith('.png'));
    event.target.value = '';
    if (!selectedFile) return;
    try {
      const assets = {};
      await Promise.all(selectedFiles.map(async (candidate) => {
        const match = candidate.name.match(/^(\d+)\.png$/i);
        if (match) assets[Number(match[1])] = new Uint8Array(await candidate.arrayBuffer());
      }));
      await openPayload({ name: selectedFile.name, bytes: new Uint8Array(await selectedFile.arrayBuffer()), assets });
    } catch (error) {
      announce(error.message || 'Could not open this file.', 'error');
    }
  };

  const fileName = `${file.title}${dirty ? ' •' : ''}`;
  const canvasWidth = Math.max(1, file.width);
  const canvasHeight = Math.max(1, file.height);
  const layerSize = Math.min(300, Math.max(190, Math.round(280 * zoom)));
  const expandedScale = Math.max(0.01, Math.min(
    (expandedStageSize.width - 48) / canvasWidth,
    (expandedStageSize.height - 48) / canvasHeight,
    760 / Math.max(canvasWidth, canvasHeight),
  ));
  const imageThumbnails = useMemo(() => selectedImages.map((pixels) => {
    if (!selected?.width || !selected?.height) return '';
    const canvas = document.createElement('canvas');
    canvas.width = selected.width;
    canvas.height = selected.height;
    canvas.getContext('2d').putImageData(new ImageData(
      applyBlackTransparency(pixels, !(selected.blackIsTransparent ?? !selected.copyImage)),
      selected.width,
      selected.height,
    ), 0, 0);
    return canvas.toDataURL('image/png');
  }), [selected, selectedImages]);
  const displayedLayers = useMemo(() => {
    if (file.mode !== 'bin') return [...layers].reverse();
    if (file.bin?.format === 'dafit-c') return [...layers].reverse();
    return [
      ...layers.filter((layer) => layer.id >= 1 && layer.id <= 3).reverse(),
      ...layers.filter((layer) => !isFixedStackItem(layer)).reverse(),
      ...layers.filter((layer) => layer.id === 17),
    ];
  }, [file.mode, layers]);

  const watchCanvas = (
    <canvas
      ref={canvasRef}
      className={`watch-canvas watch-canvas-${file.shape} ${preview ? 'is-preview' : ''}`}
      width={canvasWidth}
      height={canvasHeight}
      style={{ width: '100%', height: '100%' }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={finishCanvasDrag}
      onPointerCancel={finishCanvasDrag}
      aria-label={`Watch preview, ${file.width} by ${file.height} pixels. Drag a visible unlocked block to move it.`}
    />
  );

  return (
    <div className="app-shell">
      <input ref={inputRef} className="visually-hidden" type="file" accept=".bin,.wfproj,.json,.png" multiple aria-hidden="true" tabIndex={-1} onChange={handleBrowserFile} />
      <input ref={importInputRef} className="visually-hidden" type="file" accept=".bin,.wfproj,.json,.png" multiple aria-hidden="true" tabIndex={-1} onChange={handleElementImportFile} />
      <input ref={assetInputRef} className="visually-hidden" type="file" accept="image/png,.png" aria-hidden="true" tabIndex={-1} onChange={handleAssetFile} />
      <header className="toolbar">
        <div className="brand-lockup">
          <div className="brand-mark"><img src={`${import.meta.env.BASE_URL}tick%20tack.ico`} alt="" /></div>
          <div className="brand-copy"><span className="brand-name">TICK / TACK</span><span className="brand-caption">WATCHFACE STUDIO</span></div>
          <span className="toolbar-divider" />
          <div className="document-title" title={fileName}>
            <span className="document-name">{fileName}</span>
            <span className={`file-kind ${file.mode === 'bin' ? 'kind-bin' : 'kind-project'}`}>{file.mode === 'bin' ? 'BIN' : 'PROJECT'}</span>
          </div>
        </div>
        <div className="toolbar-middle">
          <div className="history-actions">
            <button className="icon-button" type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!undoStack.length} onClick={undo}><Icon name="undo" /></button>
            <button className="icon-button" type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!redoStack.length} onClick={redo}><Icon name="redo" /></button>
          </div>
          <span className="toolbar-divider" />
          <button className={`mode-button ${workspaceMode === 'Design' ? 'selected' : ''}`} type="button" aria-pressed={workspaceMode === 'Design'} onClick={() => { setWorkspaceMode('Design'); setPreview(false); }}>Design</button>
          <button className={`mode-button ${workspaceMode === 'Preview' ? 'selected' : ''}`} type="button" aria-pressed={workspaceMode === 'Preview'} onClick={() => { setWorkspaceMode('Preview'); setPreview(true); }}>Preview</button>
        </div>
        <div className="toolbar-actions">
          <button className="toolbar-button secondary-action new-project-button" type="button" title="Create a new project" onClick={newProject}><Icon name="plus" /><span>New</span></button>
          <button className="toolbar-button secondary-action" type="button" title="Open BIN or project (Ctrl+O)" onClick={openFile}><Icon name="open" /><span>Open</span></button>
          <button className="toolbar-button secondary-action" type="button" title="Save project (Ctrl+S)" onClick={saveProject}><Icon name="save" /><span>Save project</span></button>
          <button className="toolbar-button primary-action" type="button" title={hasUnexportableDuplicates ? 'Remove duplicate element types before BIN export' : canExportBin ? 'Export edited BIN (Ctrl+Shift+S)' : file.bin ? 'Add image frames to empty elements before exporting' : 'Open a BIN file to enable export'} onClick={exportBin} disabled={!canExportBin}><Icon name="export" /><span>Export BIN</span></button>
          <button className={`icon-button inspector-toggle ${inspectorVisible ? 'is-active' : ''}`} type="button" title="Toggle inspector" aria-label="Toggle inspector" onClick={() => setInspectorVisible((value) => !value)}><Icon name="crosshair" /></button>
        </div>
      </header>

      <div className={`workspace ${inspectorVisible ? '' : 'inspector-hidden'}`} style={panelWidths ? {
        gridTemplateColumns: inspectorVisible
          ? `${panelWidths[0]}px 7px ${panelWidths[1]}px 7px ${panelWidths[2]}px 7px minmax(220px, 1fr)`
          : `${panelWidths[0]}px 7px ${panelWidths[1]}px 7px minmax(220px, 1fr)`,
      } : undefined}>
        <aside ref={projectPanelRef} className="project-panel" aria-label="Watch-face project">
          <div className="panel-heading"><div><span className="eyebrow">DEVICE</span><h2>{deviceProfile?.name || 'Watch face'}</h2></div><button className="small-outline" type="button" onClick={() => {
            const profile = deviceProfile || { name: 'Custom watch', width: file.width, height: file.height };
            setProfileDraft({ name: profile.name, width: profile.width, height: profile.height });
            setProfileDialogOpen(true);
          }}>Edit</button></div>
          <div className="project-controls">
            <label className="item-type-picker"><span>Device profile</span><select value={activeProfileId} onChange={(event) => {
              const profileId = event.target.value;
              setActiveProfileId(profileId);
              if (file.mode === 'bin' || profileId === 'auto') return;
              const profile = customProfile?.id === profileId ? customProfile : DEVICE_PROFILES.find((item) => item.id === profileId);
              if (!profile) return;
              setFile((current) => ({
                ...current,
                width: profile.width,
                height: profile.height,
                shape: defaultFaceShape(profile.width, profile.height),
              }));
              setDirty(true);
            }} aria-label="Device profile">
              <option value="auto">Auto · BIN dimensions</option>
              {DEVICE_PROFILES.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
              {customProfile && <option value={customProfile.id}>{customProfile.name}</option>}
            </select></label>
            <div className="screen-dimensions"><span>{file.mode === 'bin' ? 'BIN screen' : 'Canvas size'}</span><strong>{file.width} × {file.height}</strong></div>
            <button className="project-side-button" type="button" onClick={showBinaryInfo}>BIN information…</button>
            <button className="project-side-button destructive-side-button" type="button" onClick={clearAll}>Clear all…</button>
            <label className="watch-name-field"><span>Watch-face name</span><input value={file.title} maxLength={120} onChange={(event) => {
              setFile((current) => ({ ...current, title: event.target.value }));
              setDirty(true);
            }} /></label>
            <div className="mini-preview-heading"><span>Watch preview</span><button type="button" className="small-outline expand-preview-button" onClick={() => { setZoom(1); setExpandedPreview(true); }}>Expand</button></div>
            <div className="mini-preview-frame">
              {!expandedPreview && <div className={`watch-bezel watch-bezel-${file.shape} ${file.mode === 'demo' ? 'demo-bezel' : ''}`} style={{ width: `${layerSize}px`, aspectRatio: `${canvasWidth} / ${canvasHeight}` }}>{watchCanvas}</div>}
            </div>
            <p className="panel-footnote">Drag blocks to reposition. Magenta smart guides appear when edges or centers align with the face or another block.</p>
            <label className="face-shape-picker project-shape-picker"><span>Preview shape</span><select aria-label="Watch face shape" value={file.shape} onChange={(event) => {
              setFile((current) => ({ ...current, shape: event.target.value }));
              setDirty(true);
            }}><option value="circle">Circle</option><option value="rounded">Rounded</option></select></label>
            <div className="project-display-meta">{file.mode === 'bin' ? file.bin?.format === 'dafit-c' ? 'Da Fit Type C' : file.bin?.compressed ? 'Compressed BIN' : 'Uncompressed BIN' : 'Editable project'} · {dirty ? 'Unsaved' : 'Saved'}</div>
          </div>
        </aside>
        <div className="panel-resizer" role="separator" aria-label="Resize device and project contents panels" aria-orientation="vertical" tabIndex={0}
          onPointerDown={(event) => startPanelResize(event, 0)} onPointerMove={resizePanels} onPointerUp={finishPanelResize} onPointerCancel={finishPanelResize} onKeyDown={(event) => handlePanelResizeKeyDown(event, 0)} />

        <aside ref={layersPanelRef} className="layers-panel" aria-label="Block list">
          <div className="panel-heading"><div><span className="eyebrow">PROJECT CONTENTS</span><h2>List of blocks</h2></div><button className="icon-button subtle" type="button" title="Add watch element" aria-label="Add watch element" onClick={addEmptyBinaryItem} disabled={file.mode === 'bin' && !availableItemTypes.length}><Icon name="plus" /></button></div>
          <div className="layers-summary"><span>{layerCountLabel}</span></div>
          <div className="layers-add-actions">
            {file.mode === 'bin' ? (
              file.bin?.format === 'dafit-c'
                ? <p className="panel-footnote">Da Fit Type C layers are defined by device type codes. Import an element from another BIN or project to add a layer.</p>
                : <>
                  <label className="item-type-picker"><span>Element type</span><select value={newItemType} onChange={(event) => setNewItemType(Number(event.target.value))} disabled={!availableItemTypes.length}>{availableItemTypes.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}{!availableItemTypes.length && <option value="">All element types added</option>}</select></label>
                  <button className="add-watch-item add-watch-item-primary" type="button" disabled={!availableItemTypes.length} onClick={addEmptyBinaryItem}>
                    <Icon name="plus" size={14} />Add element
                  </button>
                  <button className="asset-import-button" type="button" disabled={!availableItemTypes.length} onClick={() => {
                    const item = ITEM_CATALOG.find((candidate) => candidate.id === newItemType);
                    if (item) startAssetImport({ kind: 'new-bin', id: item.id, imgCount: item.imgCount });
                  }}>Add element with PNG</button>
                </>
            ) : <div className="quick-add">
              <button type="button" onClick={() => addLayer('label')}>Label</button>
              <button type="button" onClick={() => addLayer('image')}>Image frame</button>
              <button type="button" onClick={() => addLayer('icon')}>Icon</button>
              <button type="button" onClick={() => startAssetImport({
                kind: 'new-project-image',
                id: `project-image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              })}>Logo / image</button>
            </div>}
            <label className="bulk-mode-toggle"><input type="checkbox" checked={bulkDeleteMode} onChange={(event) => { setBulkDeleteMode(event.target.checked); setBulkDeleteIds([]); }} />Select blocks to delete</label>
          </div>
          <div className="layer-list" role="list" aria-label="Watch-face blocks" aria-description="Drag blocks to change their preview stacking order. Top rows draw in front; backgrounds and clock hands keep their device-defined order.">
            {displayedLayers.map((layer) => {
              const isSelected = layerKey(layer) === selectedId;
              return (
                <div
                  key={layerKey(layer)}
                  role="listitem"
                  className={`layer-row ${isSelected ? 'selected' : ''} ${layer.visible === false ? 'hidden-layer' : ''} ${dropTargetId === layerKey(layer) ? 'drop-target' : ''}`}
                  draggable={!bulkDeleteMode && !isFixedStackItem(layer)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(layerKey(layer)));
                  }}
                  onDragEnd={() => setDropTargetId(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (dropTargetId !== layerKey(layer)) setDropTargetId(layerKey(layer));
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setDropTargetId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const placeAbove = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2;
                    reorderLayer(event.dataTransfer.getData('text/plain'), layerKey(layer), placeAbove);
                    setDropTargetId(null);
                  }}
                  onClick={() => {
                    setSelectedId(layerKey(layer));
                    if (bulkDeleteMode) setBulkDeleteIds((current) => current.includes(layerKey(layer)) ? current.filter((id) => id !== layerKey(layer)) : [...current, layerKey(layer)]);
                  }}
                  tabIndex={0}
                  aria-label={`${watchfaceName(layer)}${layer.visible === false ? ', hidden' : ''}${layer.locked ? ', locked' : ''}`}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  {bulkDeleteMode && <input className="bulk-select" type="checkbox" checked={bulkDeleteIds.includes(layerKey(layer))} disabled={layer.locked} aria-label={`Select ${watchfaceName(layer)} for deletion`} onClick={(event) => event.stopPropagation()} onChange={() => setBulkDeleteIds((current) => current.includes(layerKey(layer)) ? current.filter((id) => id !== layerKey(layer)) : [...current, layerKey(layer)])} />}
                  <span className={`layer-glyph glyph-${layer.type || 'bitmap'}`} aria-hidden="true">{layer.id === 17 ? <Icon name="watch" size={16} /> : <Icon name="grid" size={15} />}</span>
                  <span className="layer-name">{watchfaceName(layer)}</span>
                  {layer.locked && <Icon name="lock" size={13} className="layer-lock" />}
                  <button className="layer-action" type="button" title={layer.visible === false ? 'Show block' : 'Hide block'} aria-label={layer.visible === false ? `Show ${watchfaceName(layer)}` : `Hide ${watchfaceName(layer)}`} onClick={(event) => { event.stopPropagation(); updateLayer(layerKey(layer), { visible: layer.visible === false }); }}><Icon name={layer.visible === false ? 'eyeOff' : 'eye'} size={15} /></button>
                </div>
              );
            })}
            {layers.length === 0 && <div className="empty-layers">No blocks in this project.</div>}
          </div>
          <div className="panel-bottom block-actions">
            <button className="small-outline delete-selected-button" type="button" onClick={removeBulkSelected} disabled={!bulkDeleteMode || !bulkDeleteIds.length}>Delete selected</button>
            <button className="delete-button" type="button" onClick={removeSelected} disabled={!selected || selected.locked}>Delete block</button>
            <button className="asset-import-button import-elements-button" type="button" onClick={openElementImport}>Import from BIN / project…</button>
            <p className="panel-footnote import-elements-note">Choose a watch-face BIN or project, preview its layers, then select one or more to add here.</p>
            {hasUnexportableDuplicates && <p className="duplicate-export-note">Duplicate element types are project-only. Remove duplicates to export a BIN.</p>}
          </div>
        </aside>
        <div className="panel-resizer" role="separator" aria-label="Resize project contents and block properties panels" aria-orientation="vertical" tabIndex={0}
          onPointerDown={(event) => startPanelResize(event, 1)} onPointerMove={resizePanels} onPointerUp={finishPanelResize} onPointerCancel={finishPanelResize} onKeyDown={(event) => handlePanelResizeKeyDown(event, 1)} />

        {inspectorVisible && <aside ref={inspectorPanelRef} className="inspector-panel" aria-label="Block properties">
          <div className="panel-heading inspector-heading"><div><span className="eyebrow">BLOCK PROPERTIES</span><h2>Edit</h2></div><span className="inspector-target"><Icon name="crosshair" size={15} /></span></div>
          {selected ? <>
            <div className="selection-card"><div className={`selection-icon glyph-${selected.type || 'bitmap'}`}><Icon name={selected.id === 17 ? 'watch' : 'grid'} size={18} /></div><div className="selection-title"><strong>{watchfaceName(selected)}</strong><span>{selected.id >= 0 ? `Block type · ${selected.id}` : `Project element · ${selected.type}`}</span></div></div>
            <div className="inspector-section"><div className="section-title"><span>{selected.type !== 'dafit' && selected.id >= 1 && selected.id <= 3 ? 'HAND PIVOT AND SIZE' : 'POSITION AND SIZE'}</span><span className="section-subtitle">PX</span></div>
              <div className="property-grid">
                <label className="property-field"><span>{selected.type !== 'dafit' && selected.id >= 1 && selected.id <= 3 ? 'Pivot X' : 'X'}</span><div className="number-field"><input type="number" min="0" max="65535" value={selected.x} aria-label={selected.type !== 'dafit' && selected.id >= 1 && selected.id <= 3 ? 'Pivot X position' : 'X position'} disabled={selected.locked} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 65535) updateLayer(layerKey(selected), { x: value }); }} /></div></label>
                <label className="property-field"><span>{selected.type !== 'dafit' && selected.id >= 1 && selected.id <= 3 ? 'Pivot Y' : 'Y'}</span><div className="number-field"><input type="number" min="0" max="65535" value={selected.y} aria-label={selected.type !== 'dafit' && selected.id >= 1 && selected.id <= 3 ? 'Pivot Y position' : 'Y position'} disabled={selected.locked} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 65535) updateLayer(layerKey(selected), { y: value }); }} /></div></label>
                <label className="property-field"><span>Width</span><div className="number-field read-only"><output>{selected.width}</output></div></label>
                <label className="property-field"><span>Height</span><div className="number-field read-only"><output>{selected.height}</output></div></label>
              </div>
                <div className="alignment-row"><span>Align to face</span></div>
                <div className="alignment-controls" role="group" aria-label="Align selected block to watch face">
                  <button type="button" title="Align left" aria-label="Align left" onClick={() => alignSelectedToFace('x', 'start')} disabled={selected.locked}>Left</button>
                  <button type="button" title="Center horizontally" aria-label="Center horizontally" onClick={() => alignSelectedToFace('x', 'center')} disabled={selected.locked}>Center H</button>
                  <button type="button" title="Align right" aria-label="Align right" onClick={() => alignSelectedToFace('x', 'end')} disabled={selected.locked}>Right</button>
                  <button type="button" title="Align top" aria-label="Align top" onClick={() => alignSelectedToFace('y', 'start')} disabled={selected.locked}>Top</button>
                  <button type="button" title="Center vertically" aria-label="Center vertically" onClick={() => alignSelectedToFace('y', 'center')} disabled={selected.locked}>Center V</button>
                  <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => alignSelectedToFace('y', 'end')} disabled={selected.locked}>Bottom</button>
                </div>
            </div>
            {selected.animationSpeed != null && <div className="inspector-section"><div className="section-title"><span>ANIMATION</span></div><label className="property-field"><span>AnimationSpeed</span><div className="number-field"><input type="number" step="any" value={selected.animationSpeed} disabled={selected.locked} onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value)) return;
              const clockFaceProperties = selected.clockFaceProperties ? { ...selected.clockFaceProperties, AnimationSpeed: value } : selected.clockFaceProperties;
              updateLayer(layerKey(selected), { animationSpeed: value, clockFaceProperties });
            }} /></div></label><p className="panel-footnote">Kept in the editable project; this BIN field is not present in the verified format.</p></div>}
            {selected.clockHandsInfo && [1, 2, 3].some((index) => selected.clockHandsInfo[index]) && <div className="inspector-section"><div className="section-title"><span>HAND PIVOT</span></div><div className="property-grid">
              {['ArrowFullLength', 'ArrowLengthToCenter', 'ArrowWidth'].map((name, offset) => <label className="property-field" key={name}><span>{name}</span><div className="number-field"><input type="number" min="0" max="255" value={selected.clockHandsInfo[offset + 1]} disabled={selected.locked} onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isInteger(value) || value < 0 || value > 255) return;
                const clockHandsInfo = [...selected.clockHandsInfo];
                clockHandsInfo[offset + 1] = value;
                const info = selected.clockFaceProperties?.ArrowInfo;
                const clockFaceProperties = selected.clockFaceProperties ? { ...selected.clockFaceProperties, ArrowInfo: { ...info, [name]: value } } : undefined;
                updateLayer(layerKey(selected), { clockHandsInfo, clockFaceProperties });
              }} /></div></label>)}
            </div></div>}
            <div className="inspector-section appearance-section"><div className="section-title"><span>APPEARANCE</span></div>
              <div className="setting-row"><span>Visible in preview</span><button className={`switch ${selected.visible !== false ? 'on' : ''}`} type="button" role="switch" aria-checked={selected.visible !== false} aria-label="Block visible" onClick={() => updateLayer(layerKey(selected), { visible: selected.visible === false })}><span /></button></div>
              <div className="setting-row"><span>Locked</span><button className={`switch ${selected.locked ? 'on' : ''}`} type="button" role="switch" aria-checked={Boolean(selected.locked)} aria-label="Block locked" onClick={() => updateLayer(layerKey(selected), { locked: !selected.locked })}><span /></button></div>
              {selected.copyImage != null && selected.type !== 'dafit' && <div className="setting-row"><span>BlackIsTransparent</span><button className={`switch ${(selected.blackIsTransparent ?? !selected.copyImage) ? 'on' : ''}`} type="button" role="switch" aria-checked={Boolean(selected.blackIsTransparent ?? !selected.copyImage)} aria-label="Black is transparent" onClick={() => {
                const blackIsTransparent = !(selected.blackIsTransparent ?? !selected.copyImage);
                const clockFaceProperties = selected.clockFaceProperties ? { ...selected.clockFaceProperties, BlackIsTransparent: blackIsTransparent } : undefined;
                updateLayer(layerKey(selected), { copyImage: !blackIsTransparent, blackIsTransparent, clockFaceProperties });
              }}><span /></button></div>}
            </div>
            {selected.clockFaceProperties && <details className="unknown-properties"><summary>Preserved source properties</summary><pre>{JSON.stringify(selected.clockFaceProperties, null, 2)}</pre></details>}
          </> : <div className="inspector-empty"><strong>No block selected</strong><span>Select a block to edit its properties.</span></div>}
        </aside>}
        {inspectorVisible && <div className="panel-resizer" role="separator" aria-label="Resize block properties and image collection panels" aria-orientation="vertical" tabIndex={0}
          onPointerDown={(event) => startPanelResize(event, 2)} onPointerMove={resizePanels} onPointerUp={finishPanelResize} onPointerCancel={finishPanelResize} onKeyDown={(event) => handlePanelResizeKeyDown(event, 2)} />}

        <aside ref={assetPanelRef} className="asset-panel" aria-label="Block images">
          <div className="panel-heading"><div><span className="eyebrow">IMAGE COLLECTION</span><h2>Images</h2></div><span className="image-dimensions">{selected?.width && selected?.height ? `${selected.width}×${selected.height} px` : 'No selection'}</span></div>
          {selected ? <>
            <div className="asset-toolbar"><button type="button" onClick={() => selectedImageIndex < selectedImages.length && startAssetImport({ id: layerKey(selected), kind: 'replace-bin' })} disabled={!selectedImages.length}>Replace</button><button type="button" onClick={removeSelectedFrame} disabled={!selectedImages.length || selected.type === 'dafit'}>Delete</button><button type="button" onClick={removeAllFrames} disabled={!selectedImages.length || selected.type === 'dafit'}>Delete all</button><button type="button" onClick={() => startAssetImport({ id: layerKey(selected), kind: 'add-images' })} disabled={selected.type === 'dafit'}>Add</button></div>
            <div className="asset-toolbar asset-secondary-toolbar"><select aria-label="Copy image collection from block" value={copyImageSourceId} onChange={(event) => setCopyImageSourceId(event.target.value)}><option value="">Same as…</option>{layers.filter((layer) => layerKey(layer) !== layerKey(selected) && layer.images?.length).map((layer) => <option key={layerKey(layer)} value={String(layerKey(layer))}>{watchfaceName(layer)} · {layer.width}×{layer.height}</option>)}</select><button type="button" onClick={() => copyImagesFromBlock(copyImageSourceId)} disabled={!copyImageSourceId}>Copy all images</button></div>
            <div className="image-grid" role="list" aria-label={`${watchfaceName(selected)} image frames`}>
              {imageThumbnails.map((source, index) => <button className={`image-cell ${selectedImageIndex === index ? 'selected' : ''}`} type="button" role="listitem" key={`${selected.id}-${index}`} aria-label={`Select image ${index + 1}`} aria-pressed={selectedImageIndex === index} onClick={() => setSelectedImageIndex(index)}><span className="image-thumbnail"><img src={source} alt="" /></span><span>{index + 1}</span></button>)}
              {!selectedImages.length && <div className="empty-layers">This block has no image frames.<br />Add images with the button above.</div>}
            </div>
            <div className="asset-selected-preview">{selectedImages[selectedImageIndex] && <><div className="selected-image-name">{watchfaceName(selected)} · Image {selectedImageIndex + 1} ({selected.width}×{selected.height}px)</div><div className="selected-image-stage"><img src={imageThumbnails[selectedImageIndex]} alt={`Image ${selectedImageIndex + 1} from ${watchfaceName(selected)}`} /></div></>}</div>
            <div className="asset-panel-bottom"><button type="button" className="small-outline" onClick={() => moveSelectedFrame(-1)} disabled={selected.type === 'dafit' || selectedImageIndex <= 0}>Move to the left</button><button type="button" className="small-outline" onClick={() => moveSelectedFrame(1)} disabled={selected.type === 'dafit' || selectedImageIndex >= selectedImages.length - 1}>Move to the right</button></div>
            {selected.id === WATCH_PICKER_PREVIEW_ITEM_ID && <p className="panel-footnote preview-image-note">Used as the thumbnail when selecting watch faces; it is not drawn on the dial.</p>}
          </> : <div className="inspector-empty"><strong>No block selected</strong><span>Select a block to manage its images.</span></div>}
        </aside>
      </div>

      {expandedPreview && <div className="expanded-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedPreview(false); }}>
        <section className="expanded-preview-dialog" role="dialog" aria-modal="true" aria-label="Expanded watch preview">
          <div className="expanded-preview-toolbar">
            <div className="expanded-preview-title"><strong>{file.title || 'Watch preview'}</strong><span>{file.width} × {file.height} · {file.shape}</span></div>
            <div className="expanded-preview-actions">
              <button type="button" className="zoom-button" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, +(value - 0.1).toFixed(1)))} disabled={zoom <= 0.5}>−</button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button type="button" className="zoom-button" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((value) => Math.min(2, +(value + 0.1).toFixed(1)))} disabled={zoom >= 2}>+</button>
              <button type="button" className="small-outline" onClick={() => setZoom(1)}>Fit</button>
              <button type="button" className="small-outline" onClick={() => setExpandedPreview(false)}>Close</button>
            </div>
          </div>
          <div className="expanded-preview-stage" ref={expandedStageRef}>
            <div
              className={`watch-bezel watch-bezel-${file.shape} ${file.mode === 'demo' ? 'demo-bezel' : ''} expanded-watch-bezel`}
              style={{
                width: `${canvasWidth * expandedScale + 24}px`,
                height: `${canvasHeight * expandedScale + 24}px`,
                transform: `scale(${zoom})`,
              }}
            >{watchCanvas}</div>
          </div>
          <div className="expanded-preview-hint">{preview ? 'Preview mode · press Escape to close' : 'Drag a visible, unlocked element to reposition · press Escape to close'}</div>
        </section>
      </div>}

      {importSource && <div className="dialog-backdrop import-elements-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setImportSource(null); }}>
        <section className="import-elements-dialog" role="dialog" aria-modal="true" aria-labelledby="import-elements-title">
          <header className="import-elements-header">
            <div><span className="eyebrow">ELEMENT LIBRARY</span><h2 id="import-elements-title">Import watch elements</h2><p>Choose one or more image-backed elements from <strong>{importSource.name}</strong>.</p></div>
            <button className="icon-button" type="button" aria-label="Close element importer" onClick={() => setImportSource(null)}><Icon name="close" /></button>
          </header>
          <div className="import-elements-content">
            <div className="import-source-preview">
              <div className="import-preview-heading"><strong>Source watch preview</strong><span>{importSource.file.width} × {importSource.file.height} px</span></div>
              <div className="import-preview-stage">
                <div className={`watch-bezel watch-bezel-${importSource.file.shape}`} style={{
                  width: `min(100%, 340px, calc((min(100vw - 460px, 60vh)) * ${importSource.file.width / importSource.file.height}))`,
                  aspectRatio: `${importSource.file.width} / ${importSource.file.height}`,
                }}>
                  <canvas ref={importPreviewCanvasRef} width={importSource.file.width} height={importSource.file.height} aria-label="Source watch face with selected element highlighted" />
                </div>
              </div>
              <p className="import-preview-hint">Select an element to highlight its bounds on the source watch.</p>
            </div>
            <div className="import-element-picker">
              <div className="import-list-heading"><strong>Elements</strong><span>{importSelection.length} selected</span></div>
              <div className="import-element-list" role="list" aria-label="Source watch elements">
                {importSource.layers.map((layer) => {
                  const key = String(layerKey(layer));
                  const checked = importSelection.includes(key);
                  const duplicate = layers.some((current) => current.id === layer.id);
                  return <label key={key} className={`import-element-row ${importPreviewId === layerKey(layer) ? 'preview-selected' : ''} ${checked ? 'import-checked' : ''}`} onClick={() => setImportPreviewId(layerKey(layer))}>
                    <input type="checkbox" checked={checked} aria-label={`Import ${watchfaceName(layer)}`} onChange={() => setImportSelection((current) => checked ? current.filter((value) => value !== key) : [...current, key])} />
                    <span className="import-element-copy"><strong>{watchfaceName(layer)}</strong><span>{layer.width} × {layer.height} px · {layer.imgCount} frame{layer.imgCount === 1 ? '' : 's'}</span></span>
                    {duplicate && <span className="import-duplicate-tag">Duplicate type</span>}
                  </label>;
                })}
              </div>
              <div className="import-duplicate-warning"><Icon name="info" size={14} /><span>Duplicate types can be edited and saved in a project, but the BIN format cannot store them; resolve duplicates before BIN export.</span></div>
            </div>
          </div>
          <footer className="import-elements-footer">
            <span>{importSelection.length ? `${importSelection.length} element${importSelection.length === 1 ? '' : 's'} ready to import` : 'Select elements to preview and import.'}</span>
            <div><button className="small-outline" type="button" onClick={() => setImportSource(null)}>Cancel</button><button className="toolbar-button primary-action" type="button" disabled={!importSelection.length} onClick={importSelectedElements}>Import {importSelection.length || ''} element{importSelection.length === 1 ? '' : 's'}</button></div>
          </footer>
        </section>
      </div>}

      <div className="bottom-bar">
        <div className={`status-message ${notice.kind}`}><Icon name={notice.kind === 'error' || notice.kind === 'warning' ? 'alert' : notice.kind === 'success' ? 'check' : 'info'} size={14} /><span>{notice.text}</span></div>
        <div className="bottom-left"><span className="device-icon"><Icon name="watch" size={13} /></span><span>{deviceProfile?.name || 'Auto-detected profile'}</span><Icon name="chevron" size={13} className="bottom-chevron" /></div>
        <div className="bottom-right"><span>SNAP {snap ? 'ON · 8 PX' : 'OFF'}</span><span className="bottom-divider" /><span>{Math.round(zoom * 100)}%</span></div>
      </div>
      {profileDialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileDialogOpen(false); }}>
        <form className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" onSubmit={(event) => {
          event.preventDefault();
          const { name, width, height } = profileDraft;
          if (!name.trim() || !Number.isInteger(Number(width)) || !Number.isInteger(Number(height)) || Number(width) < 32 || Number(width) > 4096 || Number(height) < 32 || Number(height) > 4096) {
            announce('Enter a device name and screen dimensions between 32 and 4096 pixels.', 'error');
            return;
          }
          setCustomProfile({ id: 'custom', name: name.trim(), width: Number(width), height: Number(height) });
          setActiveProfileId('custom');
          if (file.mode !== 'bin') {
            setFile((current) => ({
              ...current,
              width: Number(width),
              height: Number(height),
              shape: defaultFaceShape(Number(width), Number(height)),
            }));
            setDirty(true);
          }
          setProfileDialogOpen(false);
          announce('Custom device profile saved');
        }}>
          <div className="panel-heading"><div><span className="eyebrow">DEVICE PROFILE</span><h2 id="profile-dialog-title">Edit profile</h2></div><button className="icon-button" type="button" aria-label="Close profile editor" onClick={() => setProfileDialogOpen(false)}><Icon name="close" /></button></div>
          <label className="property-field"><span>Profile name</span><input className="profile-input" required maxLength={80} value={profileDraft.name} onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <div className="property-grid">
            <label className="property-field"><span>Screen width</span><input className="profile-input" type="number" min="32" max="4096" required value={profileDraft.width} onChange={(event) => setProfileDraft((current) => ({ ...current, width: event.target.value }))} /></label>
            <label className="property-field"><span>Screen height</span><input className="profile-input" type="number" min="32" max="4096" required value={profileDraft.height} onChange={(event) => setProfileDraft((current) => ({ ...current, height: event.target.value }))} /></label>
          </div>
          <p className="panel-footnote">Profile dimensions describe the target device. Opening a BIN keeps its embedded dimensions unchanged.</p>
          <div className="dialog-actions"><button className="small-outline" type="button" onClick={() => setProfileDialogOpen(false)}>Cancel</button><button className="toolbar-button primary-action" type="submit">Save profile</button></div>
        </form>
      </div>}
    </div>
  );
}

function downloadFile(bytes, name, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default App;
