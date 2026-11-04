# Third-party browser libraries

- `xlsx.full.min.js`: SheetJS Community Edition 0.20.3, Apache License 2.0. See `SHEETJS-APACHE-2.0.txt`.
- `qrcode.min.js`: qrcodejs 1.0.0, MIT License. See `qrcodejs-LICENSE.txt`.
- `lame.min.js`: lamejs 1.2.1 (a JavaScript port of the LAME MP3 encoder, https://github.com/zhuker/lamejs), **GNU Lesser General Public License v3.0 (LGPL-3.0)**. Used unmodified, exactly as published in the npm package `lamejs@1.2.1` (SHA-256 `15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4`). The package's own licence note is in `lamejs-LICENSE.txt`. LAME is acknowledged here: http://lame.sourceforge.net. The full licence texts are bundled next to the library: `LGPL-3.0.txt` and `GPL-3.0.txt` (the LGPL incorporates the GPL), fetched unchanged from https://www.gnu.org/licenses/lgpl-3.0.txt and https://www.gnu.org/licenses/gpl-3.0.txt. The matching unmodified source and build scripts from the same package are bundled in [lamejs-src/](./lamejs-src/), including the [unminified browser build](./lamejs-src/lame.all.js).
  - How it is used: `music-worker.js` loads it as a separate file with `importScripts`, so it can be replaced by another build of the same library without changing the site. It is only used in the admin music settings, to encode a song the customer provides to MP3. It is never loaded on guest pages.

The QR and spreadsheet libraries are served locally so generated invitation credentials and export data are not sent to third-party script CDNs.
