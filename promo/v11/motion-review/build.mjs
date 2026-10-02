import {copyFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const v10 = resolve(dir, '../../v10');
mkdirSync(resolve(dir, 'assets'), {recursive: true});
for (const name of ['source-components.js', 'source-components.css', 'gsap.min.js', 'NotoSansCJKsc-Regular.otf', 'NotoSerifCJKsc-SemiBold.otf']) {
  copyFileSync(resolve(v10, 'assets', name), resolve(dir, 'assets', name));
}
for (const name of ['motion.js', 'motion.css']) copyFileSync(resolve(dir, '..', name), resolve(dir, 'assets', name));
mkdirSync(resolve(dir, 'jxl-assets/icons'), {recursive: true});
copyFileSync(resolve(v10, 'jxl-assets/icons/icon.svg'), resolve(dir, 'jxl-assets/icons/icon.svg'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '29', '-i', resolve(v10, 'private.nosync/model-working.mov'), '-t', '16', '-vf', 'crop=2160:1376:0:64,scale=1740:1108,pad=1740:1130:0:11:white', '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-g', '30', '-keyint_min', '30', '-movflags', '+faststart', '-y', resolve(dir, 'assets/model-demo-final.mp4')], {stdio: 'inherit'});
