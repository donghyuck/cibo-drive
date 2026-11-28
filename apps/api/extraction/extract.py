"""Read one immutable original from stdin; stdout is a bounded JSON result."""
import os
import io
import json
import resource
import sys
import zipfile

# -I excludes the script directory; only load sibling modules from this installation.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ebook import chapters
from defusedxml import ElementTree as ET
from pypdf import PdfReader

MAX_INPUT = 30 * 1024 * 1024
MAX_XML = 8 * 1024 * 1024


class DocumentError(Exception):
    pass


def locations(data, extension):
    if extension == ".epub":
        yield from chapters(data)
    elif extension == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise DocumentError("암호화된 PDF입니다.")
        for number, page in enumerate(reader.pages, 1):
            yield "page", number, page.extract_text() or ""
    elif extension == ".docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_XML:
                raise DocumentError("DOCX 본문 크기 제한을 초과했습니다.")
            with archive.open(info) as source:
                root = ET.fromstring(source.read(MAX_XML + 1), forbid_dtd=True)
        namespace = root.tag.partition("}")[0] + "}"
        if namespace not in {
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}",
            "{http://purl.oclc.org/ooxml/wordprocessingml/main}",
        } or root.tag != namespace + "document":
            raise DocumentError("DOCX 본문 형식을 확인하세요.")
        body = root.find(namespace + "body")
        if body is None:
            raise DocumentError("DOCX 본문을 찾을 수 없습니다.")
        for number, para in enumerate(body.iter(namespace + "p"), 1):
            parts = []
            for node in para.iter():
                if node.tag == namespace + "t":
                    parts.append(node.text or "")
                elif node.tag == namespace + "tab":
                    parts.append("\t")
                elif node.tag in (namespace + "br", namespace + "cr"):
                    parts.append("\n")
            yield "paragraph", number, "".join(parts)
    elif extension in (".txt", ".md"):
        encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            text = data.decode("cp949")
        if "\x00" in text:
            raise DocumentError("지원하지 않는 텍스트 인코딩입니다.")
        for number, line in enumerate(text.splitlines(), 1):
            yield "line", number, line
    else:
        raise DocumentError("지원하지 않는 파일 형식입니다.")


def extract(data, extension):
    segments = []
    chars = 0
    for unit, number, raw, *source in locations(data, extension):
        value = raw.replace("\x00", "")
        if not value.strip():
            continue
        chars += len(value)
        if chars > 2_000_000:
            raise DocumentError("추출 가능한 본문 분량을 초과했습니다.")
        for offset in range(0, len(value), 3200):
            piece = value[offset:offset + 3200]
            prev = segments[-1] if segments else None
            if (unit == "line" and prev and number == prev["end"] + 1
                    and len(prev["text"]) + 1 + len(piece) <= 3200):
                prev["text"] += "\n" + piece
                prev["end"] = number
            else:
                if len(segments) >= 8192:
                    raise DocumentError("추출 가능한 출처 구간 수를 초과했습니다.")
                segments.append(dict(unit=unit, start=number, end=number, text=piece, **(source[0] if source else {})))
    return {"status": "ready" if segments else "empty", "segments": segments}


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (160 << 20, 160 << 20))
    try:
        data = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(data) > MAX_INPUT:
            raise DocumentError("원본 크기 제한을 초과했습니다.")
        if "--thumbnail" in sys.argv:
            from thumbnail import thumbnail
            result = {"image": thumbnail(data, sys.argv[1])}
        else:
            result = extract(data, sys.argv[1])
    except DocumentError as error:
        result = {"status": "failed", "reason": str(error)}
    except Exception:
        result = {"status": "failed", "reason": "원본 형식 또는 인코딩을 읽을 수 없습니다."}
    json.dump(result, sys.stdout, ensure_ascii=False)
