import {resolve} from "node:path";
import type {Locator,Page} from "playwright-core";
import type {CaptureDirector,CaptureTimeline,Viewport} from "./types.js";
import {WebCaptureError} from "./types.js";

export function createCaptureDirector(page:Page,options:{root:string;fps:number;viewport:Viewport;dpr:number;recordVideo:boolean;clockEnabled:boolean;maxFrames:number;maxRunBytes:number}):CaptureDirector{
  let activePage=page,frame=0,frameBytes=0,cursor={x:options.viewport.width/2,y:options.viewport.height/2};
  const cursorKeys:Array<{frame:number;x:number;y:number}>=[{frame:0,...cursor}],clicks:Array<{frame:number;x:number;y:number}>=[],markers:Array<{frame:number;name:string}>=[];
  const recordCursorKey=(at:number,position:{x:number;y:number})=>{const last=cursorKeys[cursorKeys.length-1];if(last?.frame===at){last.x=position.x;last.y=position.y;return;}cursorKeys.push({frame:at,...position});};
  const frameMs=1000/options.fps,framesDir=resolve(options.root,"frames");
  const shot=async()=>{
    if(!options.recordVideo)return;
    if(frame>=options.maxFrames)throw new WebCaptureError("CAPTURE_LIMIT","Capture reached app.maxFrames; increase the limit or shorten the recipe.");
    const file=resolve(framesDir,`frame-${String(frame).padStart(5,"0")}.png`),buffer=await activePage.screenshot({path:file});
    frameBytes+=buffer.length;if(frameBytes>options.maxRunBytes)throw new WebCaptureError("CAPTURE_LIMIT","Captured PNG frames exceeded app.maxRunBytes.");
    frame++;
    if(options.clockEnabled)await activePage.clock.runFor(frameMs);
  };
  const hold=async(count:number)=>{for(let index=0;index<count;index++)await shot();};
  const moveTo=async(locator:Locator,count=8)=>{
    await locator.scrollIntoViewIfNeeded();
    const bounds=await locator.boundingBox();if(!bounds)throw new WebCaptureError("TARGET_NOT_FOUND","Capture target is not visible in the browser viewport.");
    const target={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    if(!options.recordVideo){await activePage.mouse.move(target.x,target.y);cursor=target;return target;}
    if(count<=0){
      await activePage.mouse.move(target.x,target.y);
      if(frame===0)recordCursorKey(0,target);
      else{
        const last=cursorKeys[cursorKeys.length-1];if(last?.frame===frame)cursorKeys.pop();
        const holdFrame=frame-1,previous=cursorKeys[cursorKeys.length-1];
        if(previous?.frame===holdFrame){previous.x=cursor.x;previous.y=cursor.y;}else cursorKeys.push({frame:holdFrame,...cursor});
        cursorKeys.push({frame,...target});
      }
      cursor=target;return target;
    }
    const start={...cursor},startFrame=frame;recordCursorKey(startFrame,start);
    for(let index=1;index<=count;index++){
      const ratio=index/count,next={x:start.x+(target.x-start.x)*ratio,y:start.y+(target.y-start.y)*ratio};
      await activePage.mouse.move(next.x,next.y);await shot();
    }
    cursor=target;recordCursorKey(frame,cursor);
    return target;
  };
  const scroll=async(deltaY:number,count:number)=>{
    if(!options.recordVideo||count<=1){await activePage.evaluate((delta:number)=>window.scrollBy(0,delta),deltaY);return;}
    const start=await activePage.evaluate(()=>window.scrollY);
    for(let index=1;index<=count;index++){
      const position=start+deltaY*(index/count);await activePage.evaluate((next:number)=>window.scrollTo(0,next),position);await shot();
    }
  };
  return {
    get frame(){return frame;},get frameBytes(){return frameBytes;},setPage(nextPage){activePage=nextPage;},shot,hold,moveTo,
    scroll,
    marker(name){markers.push({frame,name});},
    click(x,y){clicks.push({frame,x,y});},
    timeline(sourceWidth,sourceHeight,outputWidth,outputHeight,cursorOverlay=false):CaptureTimeline{return {version:"1",fps:options.fps,viewport:options.viewport,deviceScaleFactor:options.dpr,sourceWidth,sourceHeight,outputWidth,outputHeight,frames:frame,durationSeconds:frame/options.fps,clock:options.clockEnabled?"enabled":"disabled",cameraKeys:[{frame:0,scale:1,fx:options.viewport.width/2,fy:options.viewport.height/2}],cursorKeys,clicks,markers,limitations:[cursorOverlay?"Cutroom composited the synthetic cursor and click ripples into the MP4; no camera movement was rendered.":"The MP4 contains raw browser viewport frames; cursor and camera tracks are metadata only and are not composited into the clip.","App/network state and real-time services may vary between runs even when the optional page clock is enabled."]};},
  };
}
