// Run from remotion/: node studio/update-web-match-assets.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const publicFiles={
  css:'src/styles/aurora.css',
  gsap:'src/vendor/gsap.min.js',
  sections:'src/js/sections.js',
  aurora:'src/js/aurora-bg.js',
  clock:'src/js/clock.js',
  animations:'src/js/animations.js',
  timings:'src/js/word-timings.js',
  parser:'src/js/lrc-parser.js',
  lyrics:'src/js/lyrics.data.js',
  words:'src/js/words.data.js',
  emphasis:'src/js/emphasis.js',
  app:'src/js/app.js',
};
export const publicPlayerAsset=new URL('./assets/web-match/public-player.txt',import.meta.url);
export async function webMatchAssets(){
  return Object.fromEntries(await Promise.all(Object.entries(publicFiles).map(async ([name,file])=>{
    const bytes=await readFile(new URL(`../../${file}`,import.meta.url));
    const mime=name==='css'?'text/css':'text/javascript';
    return [name,`data:${mime};base64,${bytes.toString('base64')}`];
  })));
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
  await writeFile(publicPlayerAsset,`${JSON.stringify(await webMatchAssets(),null,2)}\n`);
}
