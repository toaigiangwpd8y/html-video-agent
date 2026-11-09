/** Stops a detached loopback preview process while preserving its HTML project. */
export function stopLocalPlayer(state:{previewPid?:number}|undefined):void {
  if(!state?.previewPid)return;
  try{process.kill(process.platform==="win32"?state.previewPid:-state.previewPid,"SIGTERM");}catch{/* The local preview process group may already have exited. */}
}
