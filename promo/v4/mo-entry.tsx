import {renderToStaticMarkup} from 'react-dom/server';
import {writeFileSync} from 'node:fs';
import {OrbCompanion} from '../../client-plugins/jxl-brand/src/OrbCompanion';
writeFileSync('promo/v4/assets/mo.html',renderToStaticMarkup(<OrbCompanion state="idle" size={260} label="Mo"/>));
