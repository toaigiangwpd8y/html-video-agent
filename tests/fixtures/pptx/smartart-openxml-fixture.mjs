import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

// Build the attributed regression deck from the small two-slide P7 example.
// The second slide is otherwise untouched; slide 1 gets one native, two-node
// SmartArt data model and its generated drawing part.
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const input = new URL('./two-slides.pptx', import.meta.url);
const output = new URL('./smartart.pptx', import.meta.url);
const zip = await JSZip.loadAsync(await readFile(input));

const slidePath = 'ppt/slides/slide1.xml';
const slide = await zip.file(slidePath).async('string');
const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="SmartArt Process"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="4572000" y="1371600"/><a:ext cx="3657600" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId5" r:lo="rId6" r:qs="rId7" r:cs="rId8"/></a:graphicData></a:graphic></p:graphicFrame>`;
zip.file(slidePath, slide.replace('</p:spTree>', `${frame}</p:spTree>`));

const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
let rels = await zip.file(relsPath).async('string');
rels = rels.replace('</Relationships>', '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout" Target="../diagrams/layout1.xml"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle" Target="../diagrams/quickStyle1.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors" Target="../diagrams/colors1.xml"/><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/></Relationships>');
zip.file(relsPath, rels);

const data = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"><dgm:ptLst><dgm:pt modelId="0" type="doc"><dgm:prSet/><dgm:spPr/></dgm:pt><dgm:pt modelId="1" type="node"><dgm:prSet/><dgm:spPr/><dgm:t><a:p><a:r><a:t>SMARTART_ALPHA</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt modelId="2" type="node"><dgm:prSet/><dgm:spPr/><dgm:t><a:p><a:r><a:t>SMARTART_BETA</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c1" type="parOf" srcId="0" destId="1"/><dgm:cxn modelId="c2" type="parOf" srcId="0" destId="2"/></dgm:cxnLst><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="{B4E7D9D8-8B9A-4E7E-9F8D-7F3A5E8B6C11}"><dsp:dataModelExt relId="rId9"/></a:ext></dgm:extLst></dgm:dataModel>`;
zip.file('ppt/diagrams/data1.xml', data);
zip.file('ppt/diagrams/_rels/data1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="drawing1.xml"/></Relationships>`);

const shape = (id, name, x, y, text, fill) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1371600" cy="914400"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
zip.file('ppt/diagrams/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:drawing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shape(2, 'Process 1', 0, 0, 'SMARTART_ALPHA', '5B9BD5')}${shape(3, 'Process 2', 1828800, 0, 'SMARTART_BETA', '70AD47')}</p:spTree></p:drawing>`);

let types = await zip.file('[Content_Types].xml').async('string');
types = types.replace('</Types>', '<Override PartName="/ppt/diagrams/data1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml"/><Override PartName="/ppt/diagrams/drawing1.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/><Override PartName="/ppt/diagrams/layout1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml"/><Override PartName="/ppt/diagrams/quickStyle1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml"/><Override PartName="/ppt/diagrams/colors1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml"/></Types>');
zip.file('[Content_Types].xml', types);
for (const [name, root] of [['layout1.xml', 'layoutDef'], ['quickStyle1.xml', 'styleDef'], ['colors1.xml', 'colorsDef']]) {
  zip.file(`ppt/diagrams/${name}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:${root} xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>`);
}
await writeFile(output, await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
console.log(`Wrote ${output.pathname}`);
