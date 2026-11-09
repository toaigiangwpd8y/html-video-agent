/**
 * Minimal, dependency-free XML reader for the well-formed machine-generated XML
 * this module consumes (OOXML parts, poppler -xml / -bbox-layout output).
 * It keeps element order, attributes, and text (text segments are `#text` children, `text` holds a node's direct text); it ignores comments, PIs and DOCTYPE.
 */
export interface XmlNode {name:string;attrs:Record<string,string>;children:XmlNode[];text:string;}

const ENTITIES:Record<string,string>={amp:"&",lt:"<",gt:">",quot:"\"",apos:"'",nbsp:" "};
export function decodeEntities(value:string):string{
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,(whole,body:string)=>{
    if(body[0]==="#"){const code=body[1]==="x"||body[1]==="X"?parseInt(body.slice(2),16):parseInt(body.slice(1),10);return Number.isFinite(code)?String.fromCodePoint(code):whole;}
    return ENTITIES[body]??whole;
  });
}

function addText(node:XmlNode,value:string):void{if(!value)return;node.text+=value;node.children.push({name:"#text",attrs:{},children:[],text:value});}

export function parseXml(source:string):XmlNode{
  const root:XmlNode={name:"#document",attrs:{},children:[],text:""};const stack:XmlNode[]=[root];let index=0;
  const attrPattern=/([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  while(index<source.length){
    const lt=source.indexOf("<",index);
    const top=stack[stack.length-1];
    if(lt<0){addText(top,decodeEntities(source.slice(index)));break;}
    if(lt>index)addText(top,decodeEntities(source.slice(index,lt)));
    if(source.startsWith("<!--",lt)){const end=source.indexOf("-->",lt);index=end<0?source.length:end+3;continue;}
    if(source.startsWith("<![CDATA[",lt)){const end=source.indexOf("]]>",lt);addText(top,source.slice(lt+9,end<0?source.length:end));index=end<0?source.length:end+3;continue;}
    if(source.startsWith("<?",lt)){const end=source.indexOf("?>",lt);index=end<0?source.length:end+2;continue;}
    if(source.startsWith("<!",lt)){const end=source.indexOf(">",lt);index=end<0?source.length:end+1;continue;}
    const gt=source.indexOf(">",lt);if(gt<0)break;
    const raw=source.slice(lt+1,gt);index=gt+1;
    if(raw.startsWith("/")){if(stack.length>1)stack.pop();continue;}
    const selfClosing=raw.endsWith("/");const body=selfClosing?raw.slice(0,-1):raw;
    const nameMatch=/^([^\s/>]+)/.exec(body);if(!nameMatch)continue;
    const node:XmlNode={name:nameMatch[1],attrs:{},children:[],text:""};
    attrPattern.lastIndex=0;let match:RegExpExecArray|null;
    while((match=attrPattern.exec(body.slice(nameMatch[1].length)))!==null)node.attrs[match[1]]=decodeEntities(match[3]??match[4]??"");
    top.children.push(node);
    if(!selfClosing)stack.push(node);
  }
  return root;
}

/** Local name without namespace prefix. */
export function local(name:string):string{const i=name.indexOf(":");return i<0?name:name.slice(i+1);}
export function child(node:XmlNode|undefined,name:string):XmlNode|undefined{return node?.children.find(c=>c.name===name||local(c.name)===name);}
export function children(node:XmlNode|undefined,name:string):XmlNode[]{return node?node.children.filter(c=>c.name===name||local(c.name)===name):[];}
export function path(node:XmlNode|undefined,...names:string[]):XmlNode|undefined{let current=node;for(const name of names)current=child(current,name);return current;}
export function descendants(node:XmlNode|undefined,name:string,out:XmlNode[]=[]):XmlNode[]{if(!node)return out;for(const c of node.children){if(c.name===name||local(c.name)===name)out.push(c);descendants(c,name,out);}return out;}
/** Concatenated text content of a node and its descendants, in document order. */
export function textContent(node:XmlNode|undefined):string{if(!node)return "";if(node.name==="#text")return node.text;let out="";for(const c of node.children)out+=textContent(c);return out;}
