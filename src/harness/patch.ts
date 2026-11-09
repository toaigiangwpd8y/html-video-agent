import type {HarnessPatchDocument, HarnessPatchOperation, VideoProject} from "../core/types.js";
import {decodeJsonPointer, normalizeJsonPointer} from "../authoring/json-pointer.js";

function isRecord(value: unknown): value is Record<string, unknown> {return typeof value === "object" && value !== null && !Array.isArray(value);}
function clone<T>(value:T):T{return structuredClone(value);}
function equal(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b);}

function parentAndKey(root: unknown, path: string): {parent: any; key: string} {
  const parts=decodeJsonPointer(path);
  if(parts.length===0)throw new Error("Root replacement is not allowed.");
  let node:any=root;
  for(const token of parts.slice(0,-1)){
    if(Array.isArray(node)){
      if(!/^\d+$/.test(token))throw new Error(`Expected array index while traversing '${path}'.`);
      const index=Number(token); if(index<0||index>=node.length)throw new Error(`Array index ${index} is out of bounds in '${path}'.`); node=node[index];
    }else if(isRecord(node)){
      if(!(token in node))throw new Error(`Path '${path}' does not exist at '${token}'.`); node=node[token];
    }else throw new Error(`Cannot traverse '${path}' through a scalar value.`);
  }
  return {parent:node,key:parts.at(-1)!};
}

function readAt(root:unknown,path:string):unknown{
  const parts=decodeJsonPointer(path);let node:any=root;
  for(const token of parts){if(Array.isArray(node)){if(!/^\d+$/.test(token))throw new Error(`Expected array index in '${path}'.`);const i=Number(token);if(i<0||i>=node.length)throw new Error(`Path '${path}' does not exist.`);node=node[i];}else if(isRecord(node)){if(!(token in node))throw new Error(`Path '${path}' does not exist.`);node=node[token];}else throw new Error(`Path '${path}' does not exist.`);}return node;
}

function applyOperation(root:VideoProject, operation:HarnessPatchOperation):void{
  if(typeof operation.path!=="string"||!operation.path.startsWith("/"))throw new Error("Patch paths must be absolute JSON Pointers starting with '/'.");
  const path=normalizeJsonPointer(operation.path);
  if(operation.oldValue!==undefined){const current=readAt(root,path);if(!equal(current,operation.oldValue))throw new Error(`Stale oldValue at '${path}'.`);}
  const {parent,key}=parentAndKey(root,path);
  if(Array.isArray(parent)){
    if(operation.op==="add"){
      if(key==="-"){parent.push(clone(operation.value));return;}
      if(!/^\d+$/.test(key))throw new Error(`Add path '${path}' requires an array index or '-'.`);const index=Number(key);if(index<0||index>parent.length)throw new Error(`Array add index ${index} is out of bounds.`);parent.splice(index,0,clone(operation.value));return;
    }
    if(!/^\d+$/.test(key))throw new Error(`Patch path '${path}' requires an array index.`);const index=Number(key);if(index<0||index>=parent.length)throw new Error(`Array index ${index} is out of bounds.`);
    if(operation.op==="remove")parent.splice(index,1);else parent[index]=clone(operation.value);return;
  }
  if(!isRecord(parent))throw new Error(`Patch parent for '${path}' is not an object or array.`);
  if(operation.op==="remove"){if(!(key in parent))throw new Error(`Remove path '${path}' does not exist.`);delete parent[key];return;}
  if(operation.op==="replace"&&!(key in parent))throw new Error(`Replace path '${path}' does not exist.`);
  parent[key]=clone(operation.value);
}

export function parsePatchDocument(value:unknown):HarnessPatchDocument{
  if(!isRecord(value)||!Number.isInteger(value.baseRevision)||Number(value.baseRevision)<1||!Array.isArray(value.operations))throw new Error("Patch must be {baseRevision: integer>=1, operations: []}.");
  const operations=value.operations.map((item,index)=>{if(!isRecord(item)||!(["add","replace","remove"] as unknown[]).includes(item.op)||typeof item.path!=="string")throw new Error(`operations[${index}] is invalid.`);if(item.op!=="remove"&&!("value" in item))throw new Error(`operations[${index}] requires value.`);return {op:item.op,path:item.path,value:item.value,oldValue:item.oldValue} as HarnessPatchOperation;});
  return {baseRevision:Number(value.baseRevision),operations};
}

export function applyHarnessPatch(project:VideoProject, document:HarnessPatchDocument, currentRevision:number):VideoProject{
  if(document.baseRevision!==currentRevision)throw new Error(`Patch baseRevision ${document.baseRevision} does not match current revision ${currentRevision}.`);
  const next=clone(project);for(const op of document.operations)applyOperation(next,op);return next;
}
