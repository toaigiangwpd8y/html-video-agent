import net from "node:net";

// Restricts TCP listeners started by the local Remotion Studio process to loopback.
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){
  const first=args[0];
  if(typeof first==="number"){
    if(typeof args[1]==="string")args[1]="127.0.0.1";
    else args.splice(1,0,"127.0.0.1");
  }else if(first&&typeof first==="object"&&!first.path&&("port" in first||"host" in first)){
    args[0]={...first,host:"127.0.0.1"};
  }
  return listen.apply(this,args);
};
