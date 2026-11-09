declare module "node:fs/promises" {
  export interface Stats { dev: number; ino: number; mode: number; size: number; mtimeMs: number; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean; }
  export function open(path: string | URL, flags: number): Promise<{stat(): Promise<Stats>; readFile(): Promise<Buffer>; close(): Promise<void>}>;
  export function readFile(path: string | URL, encoding: string): Promise<string>;
  export function readFile(path: string | URL): Promise<Buffer>;
  export function realpath(path: string | URL): Promise<string>;
  export function lstat(path: string | URL): Promise<Stats>;
  export function rename(oldPath: string | URL, newPath: string | URL): Promise<void>;
  export function writeFile(path: string | URL, data: string | Uint8Array, encoding?: string): Promise<void>;
  export function writeFile(path: string | URL, data: string | Uint8Array, options?: {encoding?: string; flag?: string}): Promise<void>;
  export function mkdir(path: string | URL, options?: {recursive?: boolean}): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readdir(path: string | URL, options?: {withFileTypes?: boolean}): Promise<any[]>;
  export function stat(path: string | URL): Promise<Stats>;
  export function rm(path: string | URL, options?: {recursive?: boolean; force?: boolean}): Promise<void>;
  export function cp(source: string | URL, destination: string | URL, options?: {recursive?: boolean; force?: boolean}): Promise<void>;
  export function copyFile(source: string | URL, destination: string | URL): Promise<void>;
  export function symlink(target: string | URL, path: string | URL, type?: string): Promise<void>;
}
declare module "node:fs" {
  export const constants: {O_RDONLY: number; O_NOFOLLOW?: number};
  export interface FSWatcher { close(): void; on?(event: string, listener: (error?: any) => void): this; }
  export function watch(filename: string, options: any, listener?: (eventType: string, filename: string | null) => void): FSWatcher;
  export function watch(filename: string, listener?: (eventType: string, filename: string | null) => void): FSWatcher;
  export function existsSync(path: string): boolean;
  export function readdirSync(path:string,options:{withFileTypes:true}):Array<{name:string;isDirectory():boolean}>;
  export function createReadStream(path: string, options?: any): any;
  export function createWriteStream(path:string,options?:any):any;
}
declare module "node:stream/promises" {export function pipeline(...streams:any[]):Promise<void>;}
declare module "node:http" {
  export interface IncomingMessage {
    url?: string;
    method?: string;
    headers: Record<string, any>;
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, any>): this;
    writeHead(statusCode: number, statusMessage?: string, headers?: Record<string, any>): this;
    setHeader(name: string, value: any): this;
    write(chunk: any): boolean;
    end(chunk?: any): this;
  }
  export interface Server {
    listen(port: number, callback?: () => void): this;
    listen(port: number, hostname: string, callback?: () => void): this;
    close(callback?: (err?: any) => void): this;
    address(): any;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
  }
  export function createServer(requestListener?: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
declare module "node:path" {export const sep:string;export function join(...paths:string[]):string;export function dirname(path:string):string;export function resolve(...paths:string[]):string;export function basename(path:string,suffix?:string):string;export function relative(from:string,to:string):string;export function isAbsolute(path:string):boolean;export function extname(path:string):string;export const posix:{join(...paths:string[]):string;dirname(path:string):string;basename(path:string):string;normalize(path:string):string};}
declare module "node:url" {export function fileURLToPath(url:string|URL):string;export function pathToFileURL(path:string):URL;}
declare module "node:child_process" {export function execFile(file:string,args:string[],options:any,callback:(error:any,stdout:string,stderr:string)=>void):void;export function exec(command:string,callback?:(error:any,stdout:string,stderr:string)=>void):void;export function spawn(file:string,args?:string[],options?:any):any;}
declare module "node:net" {export function createServer():{once(event:string,listener:(error?:any)=>void):any;on(event:string,listener:(error?:any)=>void):any;listen(port?:number,host?:string,callback?:()=>void):any;address():any;close(callback?:(error?:any)=>void):any;};}
declare module "node:util" {export function promisify(fn:(...args:any[])=>void):(...args:any[])=>Promise<any>;}
declare module "node:assert/strict" {const assert:any;export default assert;}
declare module "node:test" {export interface TestOptions {skip?:boolean|string;timeout?:number;} export interface TestContext {skip(reason?:string):never;} export default function test(name:string,fn:(context:TestContext)=>any|Promise<any>):void; export default function test(name:string,options:TestOptions,fn:(context:TestContext)=>any|Promise<any>):void;}
declare namespace NodeJS {type ProcessEnv=Record<string,string|undefined>;}
declare const process:{argv:string[];env:Record<string,string|undefined>;versions:{node:string};cwd():string;exitCode?:number;platform:string;execPath:string;pid:number;on(event:string,listener:(...args:any[])=>void):void;kill(pid:number,signal?:string):boolean;exit(code?:number):never;};
declare function fetch(input:string,init?:any):Promise<any>;
declare function structuredClone<T>(value:T):T;

declare module "node:crypto" {export function createHash(algorithm:string):{update(data:string|Uint8Array):any;digest(encoding:"hex"):string};export function randomUUID():string;}
declare module "node:os" {export function tmpdir():string;}
declare module "node:module" {export function createRequire(url:string|URL):(id:string)=>any;}
interface Buffer extends Uint8Array {readUInt32LE(offset:number):number;readUInt16LE(offset:number):number;readUInt32BE(offset:number):number;readUInt16BE(offset:number):number;subarray(start?:number,end?:number):Buffer;toString(encoding?:string,start?:number,end?:number):string;}
declare const Buffer:{from(value:string|Uint8Array,encoding?:string):Buffer;concat(list:Uint8Array[]):Buffer;isBuffer(value:unknown):value is Buffer;};
declare module "node:zlib" {export function inflateRawSync(data:Uint8Array):Buffer;}
declare module "pdfjs-dist/legacy/build/pdf.mjs" {export const getDocument:any;export const Util:any;export const version:string;}
/** Node 22+ runtime API; the ES2022 lib target predates it. */
declare interface PromiseConstructor {withResolvers<T>():{promise:Promise<T>;resolve:(value:T|PromiseLike<T>)=>void;reject:(reason?:unknown)=>void};}
