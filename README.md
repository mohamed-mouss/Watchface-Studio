![image](https://github.com/mohamed-mouss/Watchface-Studio/images/watchface-studio.png)

# Credits and Attribution

This project is based on the original work by [janaboy74](https://github.com/janaboy74).

Original repository: [wfeditormk66](https://github.com/janaboy74/wfeditormk66)

This version includes significant modifications, new features, enhancements, and bug fixes.

## Major Improvements

- Added new features and functionality
- Improved performance and code quality
- Enhanced user interface and user experience
- Fixed bugs and optimized existing functionality


![image](https://github.com/mohamed-mouss/Watchface-Studio/images/app.png)


# Summary
This project Open-source watch face editor for GloryFit or GloryFitpro compatible .bin watch faces, with support for multiple devices and compression versions.
- A React / Electron desktop interface is also available for editing supported BIN watch faces.
- This software comes with no warranty. Use it at own risk.
- I am not responsible of any damage on the device.

## Supported watch faces.
- Kieslect Kr Pro (verified)
- kieslect K11
- MK66
- MK68
- QX11
- P32D

## React / Electron editor
The desktop editor supports the MK66 / QX11 / P32D BIN format used by the C++ application, including its supported compressed watch-face data. It also opens and exports the supplied Da Fit Type C (`0x81` / `0x84`) BIN format as a separate format path.

From the repository root:

```sh
npm install
npm run dev
```

`npm run build` creates the renderer in `dist`; run `npm start` after building to launch the Electron window. `npm test` runs the watch-face format tests.

The editor supports repositioning existing BIN elements, replacing PNG sprites, adding supported element types, deleting elements, saving editable `.wfproj` projects, and exporting `.bin` files. Add an empty watch element from Project Contents, select it, then use **Add** in Image Collection to import one or more same-sized PNG frames (use Ctrl-click or Shift-click to multi-select). **Add element with PNG** is also available for a single image or vertical sprite sheet. **Import from BIN / project…** opens a source watch preview and lets you select multiple image-backed elements from another BIN, Watchface Studio project, or ClockFaceEdit JSON project. Imported elements retain their image frames, dimensions, positions, and transparency. Duplicate element types can be edited and saved in `.wfproj` projects, but the MK66 BIN format identifies blocks by a unique type ID; MK66 BIN export stays disabled until duplicates are removed. Use **Same as…** and **Copy all images** to copy an element's complete image collection. Background elements default to opaque black in the editor; other imported items preserve their source transparency setting. Change **BlackIsTransparent** in Block Properties if needed. Position-only edits retain the original BIN payload and compression. When editing image data or the item table of a compressed BIN, the editor recompresses the item types supported by the source format; other item types remain raw. The checksum is recalculated.

Da Fit Type C files use a 240 × 240 round preview, RGB565 image decoding, and the Type C layer/blob tables. Positions can be edited and exported while unchanged image blobs and their RLE/raw encodings are retained. Replacing an image frame writes it back using that frame's source encoding; Type C element families have fixed frame counts, so individual frames cannot be added, deleted, or reordered. The editor recognizes the four Type C sample BINs in `bin-dafit/`; unknown single-frame layer codes are preserved, but device-specific animation behavior and unsupported multi-frame codes are not interpreted. Adding elements to a Type C BIN is supported only from another Type C BIN/project.

The interface uses the SF Pro system font when available, with native system font fallbacks on Windows and other platforms; Apple does not permit redistribution of SF fonts with this project.

Square BIN dimensions default to a circular preview; other dimensions default to a rounded preview. Change the **Preview shape** selector in the device panel to override the preview shape. Canvas pixel dimensions and aspect ratio are read from the BIN header. The preview shape is editor-only and does not change the BIN's dimensions or mask.

On startup and when choosing **New**, the editor loads `Default/Default screen.bin`, the included 466 × 466 Kieslect-compatible starter face. Selecting a device profile resizes non-BIN canvases; opened BINs and the starter retain their embedded dimensions. While dragging a block, magenta smart guides snap its edges or center to the watch-face bounds and other visible blocks. Use the six **Align to face** controls to align a selected block to the left, horizontal center, right, top, vertical center, or bottom of the canvas.

The **Import from BIN / project…** helper opens another watch face or project, previews its layers, and lets you choose which elements to add to the current face.

The ClockFaceEdit preview follows the original renderer's layer order and element behavior: analog hands rotate around their stored hand pivots, date/time digits use the current local time, and selection bounds and dragging follow the transformed hand position. Health, activity, and battery values use the sample defaults from the original renderer because live watch data is unavailable in the editor.

The four editor panels start wider to give the device preview, block list, properties, and image collection more room. Drag the vertical dividers between Device, Project Contents, Block Properties, and Image Collection to resize the panels; dividers also support the left and right arrow keys when focused. Drag blocks in Project Contents to change their preview stacking order. This order is saved in `.wfproj` projects; the watch BIN format uses device-defined rendering order and does not store custom layer order.

Use **Expand** beside the device-panel watch preview to open a large editing canvas. Drag elements on the enlarged face, zoom in or out, choose **Fit** to fit it to the window, and press Escape or **Close** to return to the panels.

Incomplete uncompressed sprite data is recovered with missing pixels shown as transparent black; the status bar reports affected items, and exporting rebuilds a complete BIN. Compressed data that cannot be decoded remains an error rather than being silently repaired. `.json` files import either Watchface Studio projects (`format: "wfeditormk66-project"`, `version: 1`, and a `layers` array) or ClockFaceEdit `_WatchFace.json` projects with their numbered PNG assets beside the JSON; importing the latter creates an editable, exportable BIN. Other JSON project formats are not currently supported. The built-in sample is a project mockup, not a valid watch-face BIN.

## Usage
Menu:
| Item | Description |
| :---: | :---: |
| Load bin | Load the watch face bin file |
| Sace bin | Save the watch face bin file |
| Quit | Quit application |
| About | About the program |

Toolbar #1:
| Item | Description |
| :---: | :---: |
| Item Types | Watchface item types |
| Load | Load the item png file |
| Sace | Save the item png file |
| New Item Types | New watchface item types |
| Add | Add new watchface item type |
| Del | Delete old watchface item type |
| X pos | X position of the item |
| Y Pos | Y position of the item |
| Shift | Item list vertical shift |

Toolbar #2:
| Item | Description |
| :---: | :---: |
| Delta height | Delta height for item images |
| Add height | Add the delta height for item images |
| Default value | Default value for the item preview |

Keys:
| Key | Description |
| :---: | :---: |
| Esc | Clear item parameters |
| F1 | Preview mode |
| F2 | Details mode |
| q | Previous file in the Watchfaces subfolder. |
| w | Next file in the Watchfaces subfolder. |
| c | Create preview image. |
| d | Switch debug mode( the preview contains IDs instead of test values ). |
| numpad - | spin button sub ( shift -> accel ) |
| numpad + | spin button add ( shift -> accel ) |
| page down | fast spin button sub |
| page up | fast spin button add |
| cursors | moving the selected item ( shift -> accel ) |
| shift + mouse | drag the selected item |

---
### Upload the watchface
#### Prerequisites for the android devices
- Glory Fit
- A file manager
#### Steps
- Download watchface(s) with Glory Fit.
- Use the file manager to download the watchfaces /Android/data/com.yc.gloryfit/files in the Main Storage to your pc ( you need to add permissions for the file manager to the gloryfit folder ).
- Edit the watchface with the editor.
- Replace an existing watchface with the edited one.
- Sync the watchface with the Glory Fit application.
- Done.

I have not found other way to upload custom watchface to the MK66.<br />
If someone has a better solution please share it with me and I will publish it.

---
### Brief compilation instructions:
- The compilation requires cmake and gtkmm3.
- For windows I have used MSys: https://www.msys2.org
- You need to install for both windows and for linux development packages as well.
---
János
---
It took 3 days until the editor was fully functional + an addition day until I found the right checksum routine waht is stored in the file.<br>
I invested around an additional week for refinements and rework until its final usable state.<br>
It took another day to implement the decompression of compressed watchfaces.
