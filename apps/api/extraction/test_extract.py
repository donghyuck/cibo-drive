import io
import unittest
import zipfile
from pypdf import PdfWriter
from pypdf.generic import NameObject, DecodedStreamObject, DictionaryObject
from extract import extract


def pdf(operations):
    writer = PdfWriter()
    for data in operations:
        page = writer.add_blank_page(width=320, height=320)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        stream = DecodedStreamObject()
        stream.set_data(data)
        page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class SourceTests(unittest.TestCase):
    def test_pdf_page_numbers_include_non_text_pages(self):
        graphic = b"0 0 100 100 re f"
        result = extract(pdf([graphic, b"BT /F1 12 Tf (page two) Tj ET"]), ".pdf")
        self.assertEqual(result["segments"], [dict(unit="page", start=2, end=2, text="page two")])
        self.assertEqual(extract(pdf([graphic]), ".pdf")["status"], "empty")

    def test_docx_body_paragraph_numbers_include_blanks_and_tables(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>본문</w:t><w:tab/><w:t>둘</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
        self.assertEqual(extract(buf.getvalue(), ".docx")["segments"], [dict(unit="paragraph",start=2,end=2,text="본문\t둘")])

    def test_epub2_ncx_spine_order_and_safe_text(self):
        book = io.BytesIO()
        with zipfile.ZipFile(book, "w") as archive:
            archive.writestr("META-INF/container.xml", '<container><rootfile full-path="OPS/package.opf"/></container>')
            archive.writestr("OPS/package.opf", '<package><metadata/><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="toc.ncx"/></manifest><spine toc="toc"><itemref idref="b"/><itemref idref="a"/></spine></package>')
            archive.writestr("OPS/toc.ncx", '<ncx><navPoint><navLabel><text>첫 장</text></navLabel><content src="b.xhtml#one"/></navPoint></ncx>')
            archive.writestr("OPS/b.xhtml", '<html><body><p id="one">첫&nbsp;본문</p><script>hidden</script></body></html>')
            archive.writestr("OPS/a.xhtml", '<html><body><h1>다음</h1><p>둘</p></body></html>')
        parts = extract(book.getvalue(), ".epub")["segments"]
        self.assertEqual([(s["start"],s["chapterTitle"],s["href"]) for s in parts], [(1,"첫 장","OPS/b.xhtml#one"),(2,"다음","OPS/a.xhtml")])
        self.assertEqual(parts[0]["text"], "첫\xa0본문")

    def test_text_and_markdown_line_ranges(self):
        for extension, encoding in [(".txt","utf-16"),(".md","utf-8-sig")]:
            sections = extract("\r\n# 제목\r\n한글\r\n\r\n끝".encode(encoding),extension)["segments"]
            self.assertEqual([(s["start"],s["end"],s["text"]) for s in sections], [(2,3,"# 제목\n한글"),(5,5,"끝")])


if __name__ == "__main__":
    unittest.main()
