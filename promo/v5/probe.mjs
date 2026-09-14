import puppeteer from '../node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--allow-file-access-from-files']});
const page=await browser.newPage();await page.setViewport({width:2560,height:1440,deviceScaleFactor:1});
await page.goto(new URL('index.html',import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
for(const t of [1.15,1.25,1.45,31.1,72,78,78.3]){
 const data=await page.evaluate(t=>{window.__timelines.mochiV4.seek(t,false);const b=document.querySelector('#quiz-page .choices button');const r=b.getBoundingClientRect();return {t,button:{x:(r.x+r.width/2)/1.3333333333,y:(r.y+r.height/2)/1.3333333333},introEye:document.querySelector('#intro .expressive-orb__eye').getAttribute('ry'),endEye:document.querySelector('#mo-final .expressive-orb__eye').getAttribute('ry'),guide:getComputedStyle(document.querySelector('#thread-layer')).display};},t);console.log(JSON.stringify(data));
}
await browser.close();
