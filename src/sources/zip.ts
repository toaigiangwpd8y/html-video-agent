import {inflateRawSync} from "node:zlib";

/** Minimal read-only ZIP reader (stored + deflate entries) sufficient for OOXML packages. */
export interface ZipArchive {names():string[];has(name:string):boolean;read(name:string):Buffer;readText(name:string):string;}

export function openZip(bytes:Buffer):ZipArchive{
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw new Error("Not a ZIP archive (end of central directory not found).");
  const count=bytes.readUInt16LE(eocd+10);let offset=bytes.readUInt32LE(eocd+16);
  const entries=new Map<string,{method:number;compressedSize:number;localOffset:number}>();
  for(let n=0;n<count;n++){
    if(bytes.readUInt32LE(offset)!==0x02014b50)throw new Error("Corrupt ZIP central directory.");
    const method=bytes.readUInt16LE(offset+10),compressedSize=bytes.readUInt32LE(offset+20),nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32),localOffset=bytes.readUInt32LE(offset+42);
    const name=bytes.subarray(offset+46,offset+46+nameLength).toString("utf8");
    entries.set(name,{method,compressedSize,localOffset});offset+=46+nameLength+extraLength+commentLength;
  }
  const read=(name:string):Buffer=>{
    const entry=entries.get(name.replace(/^\//,""));if(!entry)throw new Error(`ZIP entry not found: ${name}`);
    const lo=entry.localOffset;if(bytes.readUInt32LE(lo)!==0x04034b50)throw new Error(`Corrupt ZIP local header: ${name}`);
    const start=lo+30+bytes.readUInt16LE(lo+26)+bytes.readUInt16LE(lo+28),data=bytes.subarray(start,start+entry.compressedSize);
    if(entry.method===0)return Buffer.from(data);if(entry.method===8)return inflateRawSync(data);
    throw new Error(`Unsupported ZIP compression method ${entry.method} for ${name}`);
  };
  return {names:()=>[...entries.keys()],has:name=>entries.has(name.replace(/^\//,"")),read,readText:name=>read(name).toString("utf8")};
}
