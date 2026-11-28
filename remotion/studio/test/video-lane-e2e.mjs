import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {ensureBrowser} from '@remotion/renderer';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const url='/video-lane-fixture.html';
const server=await createServer({root,configFile:`${root}vite.config.ts`,server:{host:'127.0.0.1',port:0},plugins:[{
  name:'video-lane-fixture', configureServer(vite){
    vite.middlewares.use(async (req,res,next)=>{
      if(req.url?.split('?')[0]!==url) return next();
      res.setHeader('Content-Type','text/html');
      res.end(await vite.transformIndexHtml(url,'<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/test/video-lane-fixture.jsx"></script></body></html>'));
    });
  }
}]});
await server.listen();
let browser;
try {
  const status=await ensureBrowser();
  assert.ok('path' in status,JSON.stringify(status));
  browser=await chromium.launch({executablePath:status.path,args:['--no-sandbox']});
  const base=`http://127.0.0.1:${server.httpServer.address().port}${url}`;
  const withPage=async (fn,query='',options={})=>{
    const page=await browser.newPage({viewport:{width:440,height:600},...options});
    page.setDefaultTimeout(2500);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try {await page.goto(base+query);await fn(page);assert.deepEqual(errors,[]);}
    finally {await page.close();}
  };
  await test('video spans share the ruler scale and touch without gaps',()=>withPage(async page=>{
    const clips=page.locator('[data-video-clip-id]');
    await clips.last().waitFor();
    assert.equal(await clips.count(),3);
    const [first,second,third]=await Promise.all([0,1,2].map(i=>clips.nth(i).boundingBox()));
    assert.equal(first.x,(await page.locator('.timeline-ruler').boundingBox()).x);
    assert.equal(first.width,240);
    assert.equal(second.width,120);
    assert.equal(first.x+first.width,second.x);
    assert.equal(second.x+second.width,third.x);
    assert.equal(await page.getByText('Legacy.mp4',{exact:true}).count(),0);
  }));
  await test('legacy video lane is preserved when edits are absent',()=>withPage(async page=>{
    await page.getByText('Legacy.mp4',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-video-clip-id]').count(),0);
  },'?legacy'));
  await test('drag crossing a neighbor previews a ripple reorder and commits only on release',()=>withPage(async page=>{
    const clips=page.locator('[data-video-clip-id]');
    const first=page.locator('[data-video-clip-id="a"]');
    const {x,y,height}=await first.boundingBox();
    await page.mouse.move(x+100,y+height/2);
    await page.mouse.down();
    await page.mouse.move(x+175,y+height/2,{steps:5});
    assert.deepEqual(await page.evaluate(()=>window.calls),[]);
    assert.deepEqual(await clips.evaluateAll(els=>els.map(el=>el.dataset.videoClipId)),['b','a','c']);
    const secondBox=await clips.nth(0).boundingBox();
    assert.equal(secondBox.x+secondBox.width,(await first.boundingBox()).x);
    await page.mouse.move(x+175,y+height+20);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(()=>window.calls),[['move','a',1]]);
    assert.equal(await page.getByRole('slider').inputValue(),'30','Reorder does not seek');
  }));
  await test('trimming an edge previews downstream ripple and commits source frames once',()=>withPage(async page=>{
    const first=page.locator('[data-video-clip-id="a"]');
    const second=page.locator('[data-video-clip-id="b"]');
    const handle=page.getByRole('button',{name:'Cắt cuối Alfa.mp4',exact:true});
    await handle.waitFor();
    const {x,y,width,height}=await handle.boundingBox();
    const before=await first.boundingBox();
    await page.mouse.move(x+width/2,y+height/2);
    await page.mouse.down();
    await page.mouse.move(x+width/2-32,y+height/2,{steps:4});
    assert.deepEqual(await page.evaluate(()=>window.calls),[]);
    const after=await first.boundingBox();
    assert.equal(after.width,before.width-32);
    assert.equal(after.x+after.width,(await second.boundingBox()).x);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(()=>window.calls),[['trim','a',10,62]]);
  }));
  await test('split uses the global playhead and rejects clip boundaries',()=>withPage(async page=>{
    const split=page.getByRole('button',{name:'Tách tại đầu phát',exact:true});
    await split.click();
    assert.deepEqual(await page.evaluate(()=>window.calls),[['split','a',30]]);
    const ruler=page.locator('.timeline-ruler');
    const {x,y,height}=await ruler.boundingBox();
    await page.mouse.click(x+240,y+height/2);
    await page.locator('[data-video-clip-id="b"]').getByRole('button',{name:'Bravo.mp4',exact:true}).click();
    assert.equal(await split.isDisabled(),true);
    assert.equal(await page.getByRole('slider').inputValue(),'60');
  }));
  await test('precise trimming only commits when applying valid source bounds',()=>withPage(async page=>{
    const start=page.getByRole('spinbutton',{name:'Khung đầu'});
    const end=page.getByRole('spinbutton',{name:'Khung cuối'});
    const apply=page.getByRole('button',{name:'Áp dụng cắt'});
    await start.fill('15');
    await end.fill('15');
    assert.equal(await apply.isDisabled(),true);
    await end.fill('61');
    assert.deepEqual(await page.evaluate(()=>window.calls),[]);
    await apply.click();
    assert.deepEqual(await page.evaluate(()=>window.calls),[['trim','a',15,61]]);
  }));
  await test('missing clips stay selectable and relink by media ID; mute and delete use clip ID',()=>withPage(async page=>{
    const missing=page.locator('[data-video-clip-id="b"]');
    await missing.getByText('Thiếu nguồn').waitFor();
    await missing.getByRole('button',{name:'Bravo.mp4',exact:true}).click();
    await page.locator('input[data-video-media-id="media-b"]').setInputFiles({name:'replacement.mp4',mimeType:'video/mp4',buffer:Buffer.from('test')});
    await missing.getByText('Thiếu nguồn').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Tắt tiếng clip',exact:true}).click();
    await page.getByRole('button',{name:'Bật tiếng clip',exact:true}).waitFor();
    await page.getByRole('button',{name:'Xóa clip',exact:true}).click();
    await missing.waitFor({state:'detached'});
    assert.deepEqual(await page.evaluate(()=>window.calls),[['relink','media-b','replacement.mp4',4],['mute','b',true],['delete','b']]);
  }));
  await test('one-frame clips do not overlap their neighbors and remain selectable on mobile',()=>withPage(async page=>{
    const clip=page.locator('[data-video-clip-id="a"]');
    const button=clip.getByRole('button',{name:'Alfa.mp4',exact:true});
    await button.waitFor();
    assert.equal((await clip.boundingBox()).width,4);
    assert.equal((await button.boundingBox()).width,4);
    const picker=page.getByRole('combobox',{name:'Clip video',exact:true});
    await picker.selectOption('a');
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    assert.ok((await picker.boundingBox()).height>=44);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  },'?tiny',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}));
  await test('touch cancellation rolls back a drag preview in the panned viewport',()=>withPage(async page=>{
    const viewport=page.locator('.timeline-viewport');
    const clips=page.locator('[data-video-clip-id]');
    const first=page.locator('[data-video-clip-id="a"]');
    await first.waitFor();
    assert.equal(await viewport.evaluate(el=>{el.scrollLeft=40;return el.scrollLeft;}),40);
    const {x,y,height}=await first.boundingBox();
    const cdp=await page.context().newCDPSession(page);
    const touch=(type,offset)=>cdp.send('Input.dispatchTouchEvent',{
      type,touchPoints:offset===undefined?[]:[{x:x+100+offset,y:y+height/2}],
    });
    await touch('touchStart',0);
    await touch('touchMove',75);
    await page.waitForFunction(()=>document.querySelector('[data-video-clip-id]')?.dataset.videoClipId==='b');
    await touch('touchCancel');
    await page.waitForFunction(()=>document.querySelector('[data-video-clip-id]')?.dataset.videoClipId==='a');
    assert.deepEqual(await clips.evaluateAll(els=>els.map(el=>el.dataset.videoClipId)),['a','b','c']);
    assert.deepEqual(await page.evaluate(()=>window.calls),[]);
  },'',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}));
} finally {
  await browser?.close();
  await server.close();
}
