import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {startStudioServer} from '../server.mjs';

const scratch=await mkdtemp(join(tmpdir(),'remain-media-lifetime-'));
let server,browser;
try {
  const fixture=color=>{
    const file=join(scratch,`${color}.mp4`);
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`color=${color}:s=160x90:r=30:d=1`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',file]);
    return file;
  };
  const red=fixture('red'),blue=fixture('blue');
  server=await startStudioServer({port:0,bindHost:'127.0.0.1',dev:true});
  const status=await ensureBrowser();
  assert.ok('path' in status,JSON.stringify(status));
  browser=await chromium.launch({executablePath:status.path,args:['--no-sandbox']});
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    window.revokedVideos=[];
    const revoke=URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL=url=>{
      const inUse=[...document.querySelectorAll('.stage video')].some(video=>[video.src,video.currentSrc].some(src=>src.split('#')[0]===url));
      window.revokedVideos.push({url,inUse});
      revoke(url);
    };
    window.storedClipNames=()=>new Promise((resolve,reject)=>{
      const open=indexedDB.open('remain-studio');
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const db=open.result;
        const request=db.transaction('media').objectStore('media').getAll();
        request.onsuccess=()=>{db.close();resolve(request.result.map(entry=>entry.name).sort());};
        request.onerror=()=>{db.close();reject(request.error);};
      };
    });
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const button=(name,target=page)=>target.getByRole('button',{name,exact:true});
  const importClip=(file,target=page)=>target.locator('#video-clips-file').setInputFiles(file);
  const playable=async (target=page)=>{
    const media=await target.waitForFunction(()=>{
      const video=document.querySelector('.stage video');
      return video?.readyState>=2 && video.currentSrc.split('#')[0];
    });
    return media.jsonValue();
  };
  const saved=async (names,target=page)=>{
    const deadline=Date.now()+3500;
    let actual;
    do {
      actual=await target.evaluate(()=>window.storedClipNames());
      if(JSON.stringify(actual)===JSON.stringify(names))return;
      await new Promise(resolve=>setTimeout(resolve,50));
    } while(Date.now()<deadline);
    assert.deepEqual(actual,names,'IndexedDB must retain only the saved snapshot’s video blobs');
  };
  await button('Project video mới').click();
  await importClip(red);
  const redUrl=await playable();
  await saved(['red.mp4']);
  await page.locator('.video-edit-clip-select').click();
  await button('Xóa clip').click();
  await saved([]);
  assert.equal(await page.evaluate(url=>fetch(url).then(response=>response.ok),redUrl),true,'Undo must retain the removed clip’s live attachment');
  await button('Hoàn tác').click();
  assert.equal(await playable(),redUrl);
  await button('Hoàn tác').click();
  await page.locator('.stage video').waitFor({state:'detached'});
  await saved([]);
  assert.equal(await page.evaluate(url=>window.revokedVideos.some(entry=>entry.url===url),redUrl),false,'redo must retain the URL');
  await button('Làm lại').click();
  assert.equal(await playable(),redUrl);
  await button('Hoàn tác').click();
  await importClip(blue);
  assert.notEqual(await playable(),redUrl);
  assert.equal(await button('Làm lại').isDisabled(),true);
  await saved(['blue.mp4']).catch(async error=>assert.fail(`The discarded redo blob must be deleted; stored ${JSON.stringify(await page.evaluate(()=>window.storedClipNames()))}: ${error.message}`));
  await page.waitForFunction(url=>window.revokedVideos.some(entry=>entry.url===url),redUrl,{timeout:3500}).catch(async error=>assert.fail(`Expected revoke of ${redUrl}; got ${JSON.stringify(await page.evaluate(()=>window.revokedVideos))}: ${error.message}`));
  assert.deepEqual(await page.evaluate(url=>window.revokedVideos.filter(entry=>entry.url===url),redUrl),[{url:redUrl,inUse:false}]);
  await page.reload();
  const restoredBlue=await playable();
  assert.equal(await button('Xuất MP4').isEnabled(),true);

  // The origin has one durable project, but a second tab replacing it must
  // neither break this tab's player nor let a stale, unedited tab erase it on hide.
  const second=await context.newPage();
  second.on('pageerror',error=>errors.push(error.message));
  await second.goto(page.url());
  const secondBlue=await playable(second);
  second.once('dialog',dialog=>dialog.accept());
  await button('Project video mới',second).click();
  await importClip(red,second);
  await playable(second);
  await saved(['red.mp4'],second);
  assert.deepEqual(await second.evaluate(url=>window.revokedVideos.filter(entry=>entry.url===url),secondBlue),[{url:secondBlue,inUse:false}]);
  assert.equal(await playable(),restoredBlue);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.deepEqual(await page.evaluate(()=>window.storedClipNames()),['red.mp4'],'hiding an unchanged tab must not overwrite a newer save');

  // A rejected blob still plays in this tab. On reload the saved clip is
  // marked missing, and choosing the source again must persist it normally.
  await second.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(this.name==='media' && String(key).startsWith('clip:') && value.name==='blue.mp4')throw new DOMException('Injected quota','QuotaExceededError');
      return put.call(this,value,key);
    };
  });
  await importClip(blue,second);
  await second.getByRole('tab',{name:'Project',exact:true}).click();
  await second.getByText(/Không lưu được media/).waitFor();
  assert.equal(await button('Xuất MP4',second).isEnabled(),true);
  await saved(['red.mp4'],second);
  await second.reload();
  await second.locator('.video-edit-clip-select').filter({hasText:'blue.mp4'}).click();
  assert.equal(await button('Xuất MP4',second).isDisabled(),true);
  await second.locator('[data-video-media-id]').setInputFiles(blue);
  await second.locator('[data-video-media-id]').waitFor({state:'detached'});
  await saved(['blue.mp4','red.mp4'],second);
  assert.equal(await button('Xuất MP4',second).isEnabled(),true);

  assert.deepEqual(errors,[]);
  console.log('Verified playable Undo/Redo, orphan blob removal, safe URL revocation, reload, same-origin tab isolation, and quota/relink.');
} finally {
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
