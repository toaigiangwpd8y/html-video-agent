#!/usr/bin/env python3
"""Build tests/fixtures/pptx/sample-deck.pptx: a tiny, license-free PresentationML deck.

Standard library only (zipfile/zlib/struct), deterministic timestamps. It exercises what the
slide-source extractor reads from OOXML:
  slide 1  title + subtitle placeholders WITHOUT xfrm (geometry inherited from the layout) + speaker notes
  slide 2  title, multi-level bullets with explicit font sizes, a PNG picture with alt text + notes
  slide 3  a scaled group of two labeled boxes, a connector, and a 2x2 table
  slide 4  hidden slide (show="0")
Run:  python3 tests/fixtures/pptx/build-sample-deck.py   (Python >= 3.12)
"""
import struct, zipfile, zlib
from pathlib import Path

OUT = Path(__file__).with_name("sample-deck.pptx")
EMU = 12700  # per point
NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"


def png(width, height, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def xfrm(x, y, w, h, tag="a:xfrm"):
    return f'<{tag}><a:off x="{x*EMU}" y="{y*EMU}"/><a:ext cx="{w*EMU}" cy="{h*EMU}"/></{tag}>'


def para(text, lvl=0, sz=None, bold=False):
    rpr = f'<a:rPr lang="en-US"{f" sz=\"{sz*100}\"" if sz else ""}{" b=\"1\"" if bold else ""}/>'
    ppr = f'<a:pPr lvl="{lvl}"/>' if lvl else ""
    return f"<a:p>{ppr}<a:r>{rpr}<a:t>{text}</a:t></a:r></a:p>"


def sp(sid, name, paras, ph=None, geom=None, prst="rect"):
    nvpr = f'<p:nvPr><p:ph type="{ph[0]}"{f" idx=\"{ph[1]}\"" if ph[1] is not None else ""}/></p:nvPr>' if ph else "<p:nvPr/>"
    sppr = f"<p:spPr>{xfrm(*geom) if geom else ''}{'' if ph else f'<a:prstGeom prst=\"{prst}\"><a:avLst/></a:prstGeom>'}</p:spPr>"
    body = f'<p:txBody><a:bodyPr/><a:lstStyle/>{"".join(paras)}</p:txBody>' if paras is not None else ""
    return f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr/>{nvpr}</p:nvSpPr>{sppr}{body}</p:sp>'


def tree(content):
    return ('<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            f"{content}</p:spTree></p:cSld>")


def slide(content, hidden=False):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {NS}{" show=\"0\"" if hidden else ""}>'
            f"{tree(content)}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")


def rels(items):
    body = "".join(f'<Relationship Id="{i}" Type="{REL}/{t}" Target="{target}"/>' for i, t, target in items)
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{PKG}">{body}</Relationships>'


def notes(slide_no, text):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes {NS}>'
            + tree(sp(2, "Slide Image", None, ph=("sldImg", None)) + sp(3, "Notes", [para(text)], ph=("body", "1")))
            + "</p:notes>")


TITLE_GEOM = (48, 30, 624, 80)
BODY_GEOM = (48, 130, 624, 360)
layout = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout {NS} type="title">'
          + tree(sp(2, "Title Placeholder", [para("Title")], ph=("title", None), geom=TITLE_GEOM)
                 + sp(3, "Body Placeholder", [para("Body")], ph=("body", "1"), geom=BODY_GEOM))
          + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')
master = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster {NS}>'
          + tree(sp(2, "Title Placeholder", [para("Title")], ph=("title", None), geom=TITLE_GEOM)
                 + sp(3, "Body Placeholder", [para("Body")], ph=("body", "1"), geom=BODY_GEOM))
          + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" '
            'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
          + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>')
colors = "".join(f'<a:{n}><a:srgbClr val="{v}"/></a:{n}>' for n, v in [("dk1", "000000"), ("lt1", "FFFFFF"), ("dk2", "1F2937"), ("lt2", "F3F4F6"),
    ("accent1", "2563EB"), ("accent2", "16A34A"), ("accent3", "DC2626"), ("accent4", "CA8A04"), ("accent5", "7C3AED"),
    ("accent6", "0891B2"), ("hlink", "2563EB"), ("folHlink", "7C3AED")])
font = '<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/>'
fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
line = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
theme = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture">'
         f'<a:themeElements><a:clrScheme name="Fixture">{colors}</a:clrScheme><a:fontScheme name="Fixture"><a:majorFont>{font}</a:majorFont><a:minorFont>{font}</a:minorFont></a:fontScheme>'
         f'<a:fmtScheme name="Fixture"><a:fillStyleLst>{fill*3}</a:fillStyleLst><a:lnStyleLst>{line*3}</a:lnStyleLst>'
         '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
         f'<a:bgFillStyleLst>{fill*3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>')

slides = [
    slide(sp(2, "Title 1", [para("Fixture Deck")], ph=("ctrTitle", None))
          + sp(3, "Subtitle 2", [para("A tiny deck for extraction tests")], ph=("subTitle", "1"))),
    slide(sp(2, "Title 1", [para("Why Tests Matter", sz=36, bold=True)], ph=("title", None))
          + sp(3, "Content 2", [para("Tests catch regressions early", sz=24), para("Unit tests check one function", lvl=1, sz=18),
                                  para("Tests document intent", sz=24)], ph=("body", "1"))
          + '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" descr="A red square"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
            '<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            f'<p:spPr>{xfrm(500, 300, 160, 120)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'),
    slide(sp(2, "Title 1", [para("Pipeline")], ph=("title", None))
          + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group 9"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            '<p:grpSpPr><a:xfrm><a:off x="1270000" y="2540000"/><a:ext cx="5080000" cy="1270000"/>'
            '<a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="635000"/></a:xfrm></p:grpSpPr>'
          + sp(11, "Box A", [para("Build", sz=20)], geom=(0, 0, 50, 50)) + sp(12, "Box B", [para("Test", sz=20)], geom=(150, 0, 50, 50))
          + "</p:grpSp>"
          + '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="13" name="Arrow 12"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>'
            f'<p:spPr>{xfrm(200, 225, 200, 0)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>'
          + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="14" name="Table 13"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
          + xfrm(100, 330, 400, 80, tag="p:xfrm")
          + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="2540000"/><a:gridCol w="2540000"/></a:tblGrid>'
          + "".join('<a:tr h="508000">' + "".join(f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{para(c)}</a:txBody><a:tcPr/></a:tc>' for c in row) + "</a:tr>"
                    for row in [("Stage", "Owner"), ("Test", "Developer")])
          + "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"),
    slide(sp(2, "Title 1", [para("Hidden Backup Slide")], ph=("title", None)), hidden=True),
]
slide_rels = [
    [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), ("rId2", "notesSlide", "../notesSlides/notesSlide1.xml")],
    [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), ("rId2", "notesSlide", "../notesSlides/notesSlide2.xml"), ("rId3", "image", "../media/image1.png")],
    [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")],
    [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")],
]
notes_text = {1: "Welcome to the fixture deck.", 2: "Explain why tests matter before showing the picture."}

ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      '<Default Extension="png" ContentType="image/png"/>'
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + "".join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(1, 5))
      + "".join(f'<Override PartName="/ppt/notesSlides/notesSlide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' for i in notes_text)
      + "</Types>")
presentation = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation {NS}>'
                '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>'
                + "".join(f'<p:sldId id="{255+i}" r:id="rId{i+1}"/>' for i in range(1, 5))
                + f'</p:sldIdLst><p:sldSz cx="{720*EMU}" cy="{540*EMU}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>')
core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture Deck</dc:title><dc:creator>video harness tests</dc:creator></cp:coreProperties>')

parts = {
    "[Content_Types].xml": ct,
    "_rels/.rels": rels([("rId1", "officeDocument", "ppt/presentation.xml")]).replace(f'Type="{REL}/officeDocument"', f'Type="{REL}/officeDocument"')
                   .replace("</Relationships>", '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    "docProps/core.xml": core,
    "ppt/presentation.xml": presentation,
    "ppt/_rels/presentation.xml.rels": rels([("rId1", "slideMaster", "slideMasters/slideMaster1.xml"), ("rId6", "theme", "theme/theme1.xml")]
                                            + [(f"rId{i+1}", "slide", f"slides/slide{i}.xml") for i in range(1, 5)]),
    "ppt/slideMasters/slideMaster1.xml": master,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), ("rId2", "theme", "../theme/theme1.xml")]),
    "ppt/slideLayouts/slideLayout1.xml": layout,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]),
    "ppt/theme/theme1.xml": theme,
    "ppt/media/image1.png": png(40, 30, (220, 38, 38)),
}
for i, (xml, r) in enumerate(zip(slides, slide_rels), start=1):
    parts[f"ppt/slides/slide{i}.xml"] = xml
    parts[f"ppt/slides/_rels/slide{i}.xml.rels"] = rels(r)
for i, text in notes_text.items():
    parts[f"ppt/notesSlides/notesSlide{i}.xml"] = notes(i, text)
    parts[f"ppt/notesSlides/_rels/notesSlide{i}.xml.rels"] = rels([("rId1", "slide", f"../slides/slide{i}.xml")])

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in parts.items():
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data if isinstance(data, bytes) else data.encode("utf-8"))
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
