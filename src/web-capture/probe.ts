import type {CaptureAppConfig} from "./types.js";
import {launchCaptureSession} from "./app-session.js";
import {attachBorrowedSession} from "../browser-session/attach.js";
import {resolveSession} from "../browser-session/registry.js";

/** Read visible headings and control labels without clicking or reading field values. */
export async function probeCaptureApp(root:string,app:CaptureAppConfig):Promise<Record<string,unknown>>{
  const session=app.session?await attachBorrowedSession(await resolveSession(app.session.handle),app):await launchCaptureSession(root,app);
  let output:Record<string,unknown>|undefined;
  try{
    const page=session.page;
    const details=await page.evaluate(()=>{
      const visible=(element:Element)=>{const style=getComputedStyle(element);return style.visibility!=="hidden"&&style.display!=="none"&&(element as HTMLElement).getClientRects().length>0;};
      const headings=Array.from(document.querySelectorAll("h1,h2,h3")).filter(visible).slice(0,20).map((element)=>({tag:element.tagName.toLowerCase(),text:(element.textContent??"").trim().replace(/\s+/g," ").slice(0,160)}));
      const controls=Array.from(document.querySelectorAll("button,input,textarea,select,a,[role='button'],[role='textbox'],[data-testid]")).filter(visible).slice(0,100).map((element)=>{
        const html=element as HTMLElement,tag=element.tagName.toLowerCase(),id=element.id,label=element.getAttribute("aria-label")||element.getAttribute("title")||(id?document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent:null)||html.closest("label")?.textContent||((tag==="button"||tag==="a")?html.innerText:"");
        const inferredRole=element.getAttribute("role")||(tag==="button"?"button":tag==="a"?"link":tag==="input"||tag==="textarea"?"textbox":tag);
        return {role:inferredRole,name:(label??"").trim().replace(/\s+/g," ").slice(0,160)||undefined,testId:element.getAttribute("data-testid")||undefined,tag,...(tag==="input"?{inputType:(element as HTMLInputElement).type}:{}),disabled:(element as HTMLButtonElement).disabled};
      });
      return {headings,controls};
    });
    const url=new URL(page.url());url.username="";url.password="";url.search="";url.hash="";
    output={ok:true,url:url.href,clock:session.clockEnabled?"enabled":"disabled",session:{ownership:session.ownership,...(session.sessionBinding?{appId:session.sessionBinding.appId,contextId:session.sessionBinding.contextId,role:session.sessionBinding.role}:{}),...(app.session?{networkPolicy:app.session.networkPolicy}:{}),viewport:session.viewport,deviceScaleFactor:session.deviceScaleFactor,...(session.borrowedViewport?{borrowedViewport:{...session.borrowedViewport,restored:false}}:{})},...details,limitations:["Read-only DOM labels only; no field values, clicks, or screenshots are collected.","Confirm selectors against demo/seed data before creating a capture recipe.",...(session.borrowedViewport?["Shared capture uses the registered target; viewport changes are restored when the borrower disconnects."]:[])]};
    return output;
  }finally{await session.close();if(session.borrowedViewport){const metadata=output?.session as {borrowedViewport?:{before:{width:number;height:number};after:{width:number;height:number};restored:boolean}}|undefined;if(metadata?.borrowedViewport)metadata.borrowedViewport.restored=session.borrowedViewportRestored?.()??false;}}
}
