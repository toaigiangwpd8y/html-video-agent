import {createServer} from "node:http";

const port=Number(process.argv[2]??41973);
const html=`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task library fixture</title>
<style>body{font:16px system-ui,sans-serif;margin:40px;background:#f5f7fb;color:#172033}main{max-width:680px;margin:auto;padding:28px;background:white;border:1px solid #d8dfeb;border-radius:14px}form{display:flex;gap:12px;margin:20px 0}input,button{font:inherit;padding:12px;border:1px solid #b8c3d5;border-radius:8px}input{flex:1}button{background:#2558d8;color:white;border:0;cursor:pointer}li{padding:8px 0}</style></head>
<body><main><h1>Task library</h1><p>Create a task in this local fixture.</p><form><label for="task-name">Task name</label><input id="task-name" name="task" aria-label="Task name"><button type="submit">Create task</button></form><h2>Saved tasks</h2><ul aria-label="Saved tasks" id="tasks"></ul></main>
<script>document.querySelector("form").addEventListener("submit",event=>{event.preventDefault();const input=document.querySelector("#task-name");if(!input.value.trim())return;const item=document.createElement("li");item.textContent=input.value.trim();document.querySelector("#tasks").append(item);input.value="";});</script></body></html>`;
const server=createServer((request,response)=>{
  if(request.url==="/health"){response.writeHead(200,{"content-type":"text/plain"});response.end("ready");return;}
  response.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});response.end(html);
});
server.listen(port,"127.0.0.1");
