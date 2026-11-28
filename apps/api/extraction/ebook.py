"""Read packaged EPUB resources only; never resolve URLs outside the book."""
import io
from html.entities import name2codepoint
import posixpath
import re
import zipfile
from urllib.parse import unquote, urlsplit
from defusedxml import ElementTree as ET

def resolve(base, href):
    url = urlsplit(href)
    path = unquote(url.path)
    if url.scheme or url.netloc or path.startswith("/") or "\\" in path:
        raise ValueError("external resource")
    result = posixpath.normpath(posixpath.join(posixpath.dirname(base), path)) if path else base
    if result == ".." or result.startswith("../"):
        raise ValueError("invalid resource path")
    return result, unquote(url.fragment)

def tag(node):
    return node.tag.rsplit("}", 1)[-1]

class Book:
    def __init__(self, archive):
        self.archive = archive
        self.remaining = 48 << 20
        root = self.xml("META-INF/container.xml").find(".//{*}rootfile")
        self.opf, _ = resolve("", root.attrib["full-path"])
        package = self.xml(self.opf)
        self.items = {item.attrib["id"]: item for item in package.findall("./{*}manifest/{*}item")}
        self.spine = package.find("./{*}spine")
        self.meta = package.find("./{*}metadata")

    def read(self, path):
        info = self.archive.getinfo(path)
        if info.file_size > min(8 << 20, self.remaining):
            raise ValueError("ebook too large")
        self.remaining -= info.file_size
        return self.archive.read(info)

    def xml(self, path):
        raw = self.read(path)
        # XHTML books often use named HTML entities from an external DTD.
        # Resolve known character names locally; never load that DTD.
        def entity(match):
            name = match[1].decode("ascii")
            number = name2codepoint.get(name)
            if number and name not in ("amp", "lt", "gt", "quot"):
                return f"&#{number};".encode("ascii")
            return match[0]
        raw = re.sub(rb"&([A-Za-z][A-Za-z0-9]{1,31});", entity, raw)
        return ET.fromstring(raw, forbid_entities=True, forbid_external=True)

    def item_path(self, item):
        return resolve(self.opf, item.attrib["href"])[0]

    def cover(self):
        for item in self.items.values():
            if "cover-image" in item.get("properties", "").split():
                return self.read(self.item_path(item))
        for meta in self.meta.findall("{*}meta") if self.meta is not None else []:
            if meta.get("name") == "cover" and meta.get("content") in self.items:
                return self.read(self.item_path(self.items[meta.get("content")]))
        return None

    def toc(self):
        labels = {}
        nav = next((i for i in self.items.values() if "nav" in i.get("properties","").split()), None)
        ncx = self.items.get(self.spine.get("toc"))
        if nav is not None:
            path = self.item_path(nav)
            for node in self.xml(path).iterfind(".//{*}nav"):
                if "toc" not in node.get("{http://www.idpf.org/2007/ops}type","").split():
                    continue
                for link in node.iterfind(".//{*}a"):
                    self.add_label(labels,path,link.get("href",""),"".join(link.itertext()))
        elif ncx is not None:
            path = self.item_path(ncx)
            for point in self.xml(path).iterfind(".//{*}navPoint"):
                link = point.find("{*}content")
                title = point.findtext("{*}navLabel/{*}text")
                if link is not None and title:
                    self.add_label(labels,path,link.get("src",""),title)
        return labels

    @staticmethod
    def add_label(labels, path, href, title):
        if not href or not title.strip(): return
        try: target = resolve(path,href)
        except ValueError: return
        labels.setdefault(target, " ".join(title.split())[:300])

    def sections(self):
        labels = self.toc()
        for ref in self.spine.findall("{*}itemref"):
            item = self.items[ref.attrib["idref"]]
            if item.get("media-type") not in ("application/xhtml+xml","text/html"): continue
            path = self.item_path(item)
            root = self.xml(path)
            body = root.find(".//{*}body")
            if body is None: continue
            heading = next((n for n in body.iter() if tag(n) in ("h1","h2")),None)
            title = labels.get((path,"")) or ("".join(heading.itertext()) if heading is not None else "") or root.findtext(".//{*}title") or posixpath.basename(path)
            parts = []
            anchor = ""
            def walk(n):
                nonlocal title, anchor, parts
                kind = tag(n)
                if kind in ("script","style","svg","iframe","object","nav","head","noscript") or "hidden" in n.attrib: return
                ident = n.get("id")
                if ident and (path,ident) in labels:
                    previous = "".join(parts).strip()
                    if previous: yield title, path + ("#"+anchor if anchor else ""), previous
                    parts = []
                    title, anchor = labels[(path,ident)], ident
                if kind in ("p","div","section","li","br","tr","h1","h2","h3","h4","h5","h6"): parts.append("\n")
                parts.append(n.text or "")
                for child in n:
                    yield from walk(child)
                    parts.append(child.tail or "")
                if kind in ("p","li","tr","div","section"): parts.append("\n")
            yield from walk(body)
            value = "".join(parts).strip()
            if value: yield title,path+("#"+anchor if anchor else ""),value

def chapters(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for number,(title,href,content) in enumerate(Book(archive).sections(),1):
            text = "\n".join(line.strip() for line in content.splitlines() if line.strip())
            yield "chapter",number,text,{"chapterTitle":" ".join(title.split())[:300],"href":href[:1024]}
