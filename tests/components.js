/* Тест v2.7.0: node tests/components.js <сайт> <фикстуры>. Ставит компоненты «Шумоподавление» и «Распознавание речи», затем без сети грузит шумоподавление и распознаёт речь. */
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const root=process.argv[2], fx=process.argv[3];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{let f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});r.end(d)})}).listen(8792,async()=>{
 const b=await chromium.launch(); const c=await b.newContext({locale:'ru-RU'}); const p=await c.newPage(); let bad=0; const ok=(x,m)=>{console.log((x?'ok   ':'FAIL ')+m);if(!x)bad++};
 await p.addInitScript(()=>{localStorage.setItem('aspect-video-onboarded','1')});
 p.on('pageerror',e=>console.log('PAGEERR',e.message));
 await p.goto('http://localhost:8792/index.html'); await p.waitForSelector('#uploadBtn'); await p.waitForFunction(()=>navigator.serviceWorker.controller,null,{timeout:20000}).catch(()=>{});
 await p.setInputFiles('#fileInput',path.join(fx,'speech.webm')); await p.waitForSelector('#previewCard:not([hidden])');
 await p.click('#settingsTabs [data-tab="components"]'); await p.waitForSelector('#compList .comp-row');
 for (const i of [1,2]) { const row=p.locator('#compList .comp-row').nth(i); await row.locator('button:has-text("Скачать")').click();
   await p.waitForFunction(n=>/Скачать заново/.test(document.querySelectorAll('#compList .comp-row')[n].textContent),i,{timeout:240000}).catch(()=>{});
   const t=await row.textContent(); ok(/Скачать заново/.test(t),'компонент '+i+' установлен: '+t.replace(/\s+/g,' ').slice(0,90)); }
 await c.setOffline(true);
 const r=await p.evaluate(async()=>{ try{ const M=await AV.loadDenoise(); const w=await fetch('vendor/whisper/models/Xenova/whisper-tiny/config.json'); return {dn:!!M._rnnoise_create, cfg:w.status}; }catch(e){return {err:e.message}} });
 ok(r.dn&&r.cfg===200,'офлайн: шумоподавление и файлы модели отдаются из хранилища '+JSON.stringify(r));
 await p.click('#settingsTabs [data-tab="wm"]'); await p.selectOption('#capLang','en'); await p.click('#capAuto');
 await p.waitForFunction(()=>document.querySelector('#progress').hidden===false,null,{timeout:10000}).catch(()=>{});
 await p.waitForFunction(()=>document.querySelector('#progress').hidden,null,{timeout:240000});
 const n=await p.evaluate(()=>window.AVApp.Q()[0].caps.length); ok(n>=1,'офлайн: подписи распознаны ('+n+')');
 console.log(bad?'FAILED':'ALL OK'); await b.close(); srv.close();});
