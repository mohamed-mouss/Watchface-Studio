export const DEVICE_PROFILES = [
  {
    id: 'kieslect-kr-pro',
    name: 'Kieslect Kr Pro',
    width: 466,
    height: 466,
    format: 'ClockFaceEdit / MK66-compatible BIN',
  },
];

export function matchDeviceProfile(width, height) {
  return DEVICE_PROFILES.find((profile) => profile.width === width && profile.height === height) || null;
}
